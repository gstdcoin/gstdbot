/**
 * GSTD Traffic Relay — DePIN bandwidth monetization
 *
 * Routes HTTP requests through this node, measuring bandwidth.
 * Every GB relayed earns 0.005 GSTD (split 50/30/20 like all fees).
 *
 * Modes:
 *   /relay/proxy?url=<target> — forward requests to external URL
 *   /relay/rpc/:chain         — forward JSON-RPC to local validator node
 *   /relay/stats              — relay metrics
 *
 * Security: blocks SSRF (metadata endpoints, RFC-1918 ranges, dangerous RPC methods).
 */

import type { Application, Request, Response } from 'express';
import { lookup as dnsLookup } from 'dns/promises';
import { logActivity } from '../gateway/server.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const REQUEST_TIMEOUT   = 30_000;
const BLOCKED_HOSTS     = new Set([
    '169.254.169.254', '100.100.100.200',
    'metadata.google.internal',
    'localhost', '127.0.0.1', '::1', '0.0.0.0',
]);
const DANGEROUS_RPC = new Set([
    'personal_importRawKey', 'personal_unlockAccount',
    'eth_sendTransaction', 'miner_start', 'debug_setHead', 'admin_addPeer',
]);

function isPrivateIpString(host: string): boolean {
    if (BLOCKED_HOSTS.has(host)) return true;
    if (host.startsWith('10.')) return true;
    if (host.startsWith('192.168.')) return true;
    if (host.startsWith('172.')) {
        const n = parseInt(host.split('.')[1]);
        if (n >= 16 && n <= 31) return true;
    }
    // Block decimal/hex/octal loopback representations and link-local
    if (host.startsWith('127.')) return true;
    if (host.startsWith('169.254.')) return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // IPv6 ULA
    return false;
}

// Resolves hostname via DNS before checking — prevents DNS rebinding attacks
// where a hostname passes string checks but resolves to a private IP.
// Fails closed: DNS resolution failures are treated as blocked.
async function isSsrfTarget(hostname: string): Promise<boolean> {
    if (isPrivateIpString(hostname)) return true;
    try {
        const { address } = await dnsLookup(hostname, { family: 4 });
        if (isPrivateIpString(address)) return true;
    } catch {
        return true; // DNS failed — block rather than allow
    }
    return false;
}

export class TrafficRelay {
    private nodeId: string;
    private revenue: any  = null;
    private feeLedger: any = null;
    private bytesRelayed = 0;
    private requestsRelayed = 0;
    private _enabled = false;

    private rpcTargets = new Map<string, string>([
        ['eth',  process.env.ETH_RPC_URL  || 'http://127.0.0.1:8545'],
        ['btc',  process.env.BTC_RPC_URL  || 'http://127.0.0.1:8332'],
        ['ton',  process.env.TON_RPC_URL  || 'http://127.0.0.1:43677'],
    ]);

    constructor(nodeId: string) {
        this.nodeId    = nodeId;
        this._enabled  = process.env.GSTD_RELAY_ENABLED !== 'false';
    }

    setRevenueEngine(revenue: any): void  { this.revenue    = revenue; }
    setFeeLedger(feeLedger: any): void    { this.feeLedger  = feeLedger; }

    async init(): Promise<void> {
        if (this._enabled) {
            logActivity('Traffic Relay ready — /relay/proxy and /relay/rpc/:chain active', 'success');
        } else {
            console.log('    Traffic Relay: disabled (GSTD_RELAY_ENABLED=false)');
        }
    }

    isEnabled(): boolean { return this._enabled; }

    getStats() {
        return {
            enabled:          this._enabled,
            bytes_relayed:    this.bytesRelayed,
            requests_relayed: this.requestsRelayed,
            mb_relayed:       Math.round(this.bytesRelayed / (1024 * 1024) * 100) / 100,
            rpc_chains:       Array.from(this.rpcTargets.keys()),
        };
    }

    mountRoutes(app: Application): void {
        if (!this._enabled) return;

        // ── HTTP proxy ─────────────────────────────────────────────────
        app.all('/relay/proxy', async (req: Request, res: Response) => {
            const targetUrl = req.query.url as string;
            if (!targetUrl) return res.status(400).json({ error: 'url query param required' });

            let parsed: URL;
            try { parsed = new URL(targetUrl); } catch {
                return res.status(400).json({ error: 'Invalid target URL' });
            }

            if (!ALLOWED_PROTOCOLS.has(parsed.protocol))
                return res.status(400).json({ error: 'Only http/https allowed' });
            if (await isSsrfTarget(parsed.hostname))
                return res.status(403).json({ error: 'Target host not allowed' });

            try {
                const body = (req.method !== 'GET' && req.method !== 'HEAD')
                    ? JSON.stringify(req.body) : undefined;

                const upstream = await fetch(targetUrl, {
                    method:  req.method,
                    headers: {
                        'Content-Type':  'application/json',
                        'User-Agent':    `GSTD-Relay/1.0 node=${this.nodeId.slice(0, 8)}`,
                        'X-Forwarded-By': this.nodeId,
                    },
                    body,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
                });

                const buf   = Buffer.from(await upstream.arrayBuffer());
                const bytes = buf.length + (body?.length || 0);
                this.bytesRelayed    += bytes;
                this.requestsRelayed += 1;
                this.feeLedger?.chargeRelay(bytes);

                res.status(upstream.status)
                   .setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
                   .setHeader('X-Relay-Node', this.nodeId)
                   .setHeader('X-Bytes-Relayed', bytes.toString())
                   .send(buf);
            } catch (e: any) {
                res.status(502).json({ error: 'Relay failed', detail: e.message });
            }
        });

        // ── Blockchain JSON-RPC relay ───────────────────────────────────
        app.post('/relay/rpc/:chain', async (req: Request, res: Response) => {
            const chain   = req.params.chain.toLowerCase();
            const rpcUrl  = this.rpcTargets.get(chain);
            if (!rpcUrl) {
                return res.status(404).json({
                    error:     `Unknown chain: ${chain}`,
                    available: Array.from(this.rpcTargets.keys()),
                });
            }

            const body = req.body;
            if (!body?.method || typeof body.method !== 'string')
                return res.status(400).json({ error: 'JSON-RPC method required' });
            if (DANGEROUS_RPC.has(body.method))
                return res.status(403).json({ error: `Method '${body.method}' not allowed via relay` });

            try {
                const bodyStr = JSON.stringify(body);
                const upstream = await fetch(rpcUrl, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    bodyStr,
                    signal:  AbortSignal.timeout(REQUEST_TIMEOUT),
                });

                const data   = await upstream.json();
                const bytes  = JSON.stringify(data).length + bodyStr.length;
                this.bytesRelayed    += bytes;
                this.requestsRelayed += 1;
                this.feeLedger?.chargeRelay(bytes);

                res.setHeader('X-Relay-Node', this.nodeId)
                   .setHeader('X-Chain', chain)
                   .json(data);
            } catch (e: any) {
                const offline = (e as NodeJS.ErrnoException).code === 'ECONNREFUSED';
                res.status(offline ? 503 : 502).json({
                    jsonrpc: '2.0', id: body?.id || null,
                    error: { code: -32603, message: offline ? `${chain} validator not running` : e.message },
                });
            }
        });

        // ── Relay stats ────────────────────────────────────────────────
        app.get('/relay/stats', (_req: Request, res: Response) => {
            res.json(this.getStats());
        });

        logActivity('Relay routes mounted: /relay/proxy, /relay/rpc/:chain', 'info');
    }

    async stop(): Promise<void> {
        logActivity(
            `Traffic Relay stopped. Relayed: ${(this.bytesRelayed / (1024 * 1024)).toFixed(2)} MB over ${this.requestsRelayed} requests`,
            'info',
        );
    }
}
