/**
 * GSTD NaaS — Gas-Less RPC Proxy
 *
 * Unified endpoint for all supported blockchains.
 * Users pay in GSTD, proxy routes to the appropriate chain node.
 *
 * Endpoint: POST /rpc/:chain
 * Auth: X-GSTD-Key header
 *
 * Example:
 *   POST /rpc/eth
 *   X-GSTD-Key: gstd_key_XXXXX
 *   Body: { "jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1 }
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { logActivity } from '../gateway/server.js';

// ─── Chain → Local RPC port mapping ─────────────────────────────
const CHAIN_PORTS: Record<string, { port: number; host: string; path?: string }> = {
    btc:    { port: 8332, host: 'localhost' },
    ltc:    { port: 9332, host: 'localhost' },
    ton:    { port: 8080, host: 'localhost', path: '/rpc' },
    eth:    { port: 8545, host: 'localhost' },
    matic:  { port: 8545, host: 'localhost' },
    polygon:{ port: 8545, host: 'localhost' },
    avax:   { port: 9650, host: 'localhost', path: '/ext/bc/C/rpc' },
    bnb:    { port: 8575, host: 'localhost' }, // offset to avoid conflict with eth
    sol:    { port: 8899, host: 'localhost' },
    dot:    { port: 9944, host: 'localhost' },
    near:   { port: 3030, host: 'localhost' },
    atom:   { port: 1317, host: 'localhost' },
    arb:    { port: 8547, host: 'localhost' },
    op:     { port: 8548, host: 'localhost' },
    xlm:    { port: 11626, host: 'localhost' },
    ada:    { port: 1337, host: 'localhost' },
};

// ─── GSTD Pricing (per request, in nanoGSTD) ────────────────────
const LIGHT_METHODS  = new Set(['eth_blockNumber','eth_chainId','net_version','eth_getBalance','sol_getBalance']);
const HEAVY_METHODS  = new Set(['eth_getLogs','eth_call','trace_block','debug_traceTransaction']);

function getPriceNano(method: string): number {
    if (HEAVY_METHODS.has(method)) return 50_000;  // 0.00005 GSTD
    if (LIGHT_METHODS.has(method)) return 1_000;   // 0.000001 GSTD
    return 5_000;                                   // 0.000005 GSTD (default)
}

// ─── Auth & Balance Check (calls GSTD Platform API) ─────────────
async function checkAndDeductBalance(apiKey: string, priceNano: number): Promise<boolean> {
    try {
        const resp = await fetch('https://api.gstdtoken.com/api/v1/rpc/charge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ amount_nano: priceNano }),
            signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
            const data: any = await resp.json();
            return data.success === true;
        }
        return false;
    } catch {
        // If payment API is unreachable, allow request but log it
        logActivity(`RPC Proxy: payment API unreachable — allowing free request`, 'warn');
        return true;
    }
}

// ─── Forward request to local chain node ────────────────────────
async function forwardToChain(
    chain: string,
    body: string,
    requestId: string
): Promise<{ status: number; data: any }> {
    const cfg = CHAIN_PORTS[chain];
    if (!cfg) {
        return {
            status: 400,
            data: { error: { code: -32000, message: `Chain '${chain}' not supported by this node` } }
        };
    }

    const url = `http://${cfg.host}:${cfg.port}${cfg.path || ''}`;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(10_000),
        });
        const data = await resp.json();
        return { status: resp.status, data };
    } catch (e: any) {
        return {
            status: 503,
            data: {
                jsonrpc: '2.0',
                error: { code: -32603, message: `Chain node unavailable: ${e.message}` },
                id: requestId
            }
        };
    }
}

// ─── Read request body ───────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; if (data.length > 65536) reject(new Error('Body too large')); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

// ─── RPC Proxy Server ────────────────────────────────────────────
export class GSTDRPCProxy {
    private server: ReturnType<typeof createServer>;
    private port: number;
    private requestCount = 0;
    private totalGSTDEarned = 0;

    constructor(port = 9000) {
        this.port = port;
        this.server = createServer(this.handleRequest.bind(this));
    }

    private async handleRequest(req: IncomingMessage, res: ServerResponse) {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-GSTD-Key');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        // Health check
        if (req.url === '/health') {
            res.writeHead(200);
            res.end(JSON.stringify({
                status: 'ok',
                requests: this.requestCount,
                gstd_earned: this.totalGSTDEarned,
                chains: Object.keys(CHAIN_PORTS),
            }));
            return;
        }

        // Parse /rpc/:chain
        const match = req.url?.match(/^\/rpc\/([a-z]+)/i);
        if (!match) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Use /rpc/:chain (e.g. /rpc/eth)' }));
            return;
        }

        const chain  = match[1].toLowerCase();
        const apiKey = (req.headers['x-gstd-key'] as string) || '';

        if (!apiKey) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Missing X-GSTD-Key header. Get one at gstdtoken.com' }));
            return;
        }

        let body = '';
        try {
            body = await readBody(req);
        } catch {
            res.writeHead(413);
            res.end(JSON.stringify({ error: 'Request body too large' }));
            return;
        }

        const parsed = JSON.parse(body || '{}');
        const method = parsed.method || '';
        const price  = getPriceNano(method);

        // Deduct GSTD
        const paid = await checkAndDeductBalance(apiKey, price);
        if (!paid) {
            res.writeHead(402);
            res.end(JSON.stringify({ error: 'Insufficient GSTD balance. Top up at gstdtoken.com' }));
            return;
        }

        // Forward to chain
        const { status, data } = await forwardToChain(chain, body, parsed.id);

        this.requestCount++;
        this.totalGSTDEarned += price / 1_000_000_000;

        res.writeHead(status);
        res.end(JSON.stringify(data));

        if (this.requestCount % 100 === 0) {
            logActivity(`RPC Proxy: ${this.requestCount} requests | ${this.totalGSTDEarned.toFixed(6)} GSTD earned`, 'success');
        }
    }

    start(): void {
        this.server.listen(this.port, () => {
            logActivity(`🌐 GSTD Multi-Chain RPC Proxy listening on :${this.port}`, 'success');
            logActivity(`   Supported chains: ${Object.keys(CHAIN_PORTS).join(', ')}`);
            logActivity(`   Docs: https://gstdtoken.com/rpc`);
        });
    }

    stop(): void {
        this.server.close();
    }

    getStats() {
        return {
            requests: this.requestCount,
            gstd_earned: this.totalGSTDEarned,
            supported_chains: Object.keys(CHAIN_PORTS),
        };
    }
}
