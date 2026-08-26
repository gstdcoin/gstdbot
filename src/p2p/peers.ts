/**
 * GSTD HTTP Peer Manager
 *
 * Fully decentralized node coordination over plain HTTP.
 * No Redis, no Upstash, no central server.
 *
 * How it works:
 *   - Each node maintains a peer table in memory + peers.json on disk
 *   - On startup: load peers.json, ping all known peers to check liveness
 *   - Every 30s: broadcast own heartbeat to all live peers
 *   - On heartbeat receive: store peer, share our peer table with them (gossip)
 *   - On task request: route to best peer if local node is busy/lacks model
 *
 * Bootstrap: set GSTD_SEED_PEERS=https://node1.example.com,https://node2.example.com
 * Those seed nodes gossip the rest of the network to you on first connect.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

const PEER_TTL_MS    = 5 * 60_000;   // peer considered dead after 5 min no heartbeat
const HEARTBEAT_INTERVAL = 30_000;    // broadcast to all peers every 30s
const PEERS_FILE   = join(process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot', 'peers.json');
const TUNNEL_URL_FILE = '/tmp/gstd_tunnel_url.txt';

export function resolvePublicUrl(configured: string): string {
    // Prefer tunnel file (updated live by tunnel.sh) over static config
    try {
        const fromFile = readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
        if (fromFile.startsWith('http')) return fromFile;
    } catch { /* file may not exist yet */ }
    return configured;
}

export type PeerSource = 'p2p-mesh' | 'http-gossip' | 'kv-fallback';

export interface PeerInfo {
    nodeId:       string;
    url:          string;   // public HTTP URL, e.g. https://abc123.lhr.life
    capabilities: string[]; // e.g. ['llama3.2:3b', 'llama3.1:8b']
    version:      string;
    cpuCores:     number;
    ramGb:        number;
    uptime:       number;
    tasksHandled: number;
    lastSeen:     number;   // Date.now()
    latencyMs:    number;   // measured round-trip
    source:       PeerSource; // which discovery layer found this peer -- honest visibility, not routing logic
}

export interface HeartbeatPayload {
    nodeId:       string;
    url:          string;
    capabilities: string[];
    version:      string;
    cpuCores:     number;
    ramGb:        number;
    uptime:       number;
    tasksHandled: number;
    peers?:       Array<{ nodeId: string; url: string; capabilities: string[] }>; // gossip
}

export class PeerManager extends EventEmitter {
    private peers = new Map<string, PeerInfo>();
    private selfInfo: Omit<PeerInfo, 'lastSeen' | 'latencyMs'>;
    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(self: Omit<PeerInfo, 'lastSeen' | 'latencyMs'>) {
        super();
        this.selfInfo = self;
        this.loadFromDisk();
    }

    // ─── Startup ─────────────────────────────────────────────────────

    async start(): Promise<void> {
        // 1. Seed peers from env
        const envSeeds = (process.env.GSTD_SEED_PEERS || '')
            .split(',').map(s => s.trim()).filter(s => s.startsWith('http'));

        // 2. Also fetch seed URL from GitHub (Pi bootstrap node publishes its tunnel URL there)
        const githubSeeds: string[] = [];
        try {
            const resp = await fetch(
                `https://raw.githubusercontent.com/gstdcoin/ai/main/gstd-seed-peers.txt?t=${Math.floor(Date.now() / 60000)}`,
                { signal: AbortSignal.timeout(4000) }
            );
            if (resp.ok) {
                const urls = (await resp.text()).split('\n').map(s => s.trim()).filter(s => s.startsWith('http'));
                githubSeeds.push(...urls);
            }
        } catch { /* GitHub unavailable — use env seeds */ }

        const allSeeds = [...new Set([...envSeeds, ...githubSeeds])];
        for (const url of allSeeds) {
            if (url !== this.selfInfo.url) {
                this.peers.set(url, this.placeholder(url));
            }
        }

        // 2.5. Last resort: central registry, ONLY if env + GitHub seeding found nothing.
        // This is deliberately the bottom of the fallback chain, not a routine source --
        // logged clearly so an operator can see the network degraded to it.
        if (allSeeds.length === 0 && this.peers.size === 0) {
            console.log('[Peers] No env/GitHub seeds found — falling back to central registry (app.gstdtoken.com)');
            try {
                const apiBase = process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com';
                const resp = await fetch(`${apiBase}/api/v1/nodes/list`, { signal: AbortSignal.timeout(8000) });
                if (resp.ok) {
                    const data: any = await resp.json();
                    const nodes: any[] = Array.isArray(data) ? data : (data.nodes || []);
                    let added = 0;
                    for (const n of nodes) {
                        const url = n.node_url || n.url;
                        const nodeId = n.node_id || n.id;
                        if (url && nodeId && url !== this.selfInfo.url && nodeId !== this.selfInfo.nodeId && !this.peers.has(nodeId)) {
                            this.peers.set(nodeId, { ...this.placeholder(url, nodeId, n.capabilities || []), source: 'kv-fallback' });
                            added++;
                        }
                    }
                    console.log(`[Peers] Central registry fallback added ${added} peer(s)`);
                }
            } catch (e: any) {
                console.log(`[Peers] Central registry fallback failed: ${e.message} — starting with 0 peers, relying on P2P discovery`);
            }
        }

        // 3. Ping all known peers immediately
        await this.pingAll();

        // 4. Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.heartbeatAll(), HEARTBEAT_INTERVAL);

        console.log(`[Peers] Started. Known peers: ${this.peers.size} (${githubSeeds.length} from GitHub) | Self: ${this.selfInfo.url}`);
    }

    stop(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    // ─── Incoming heartbeat (called by server.ts POST /api/peers/heartbeat) ─

    receiveHeartbeat(payload: HeartbeatPayload, measuredLatency = 0): void {
        if (payload.nodeId === this.selfInfo.nodeId) return;

        const existing = this.peers.get(payload.nodeId);
        const peer: PeerInfo = {
            nodeId:       payload.nodeId,
            url:          payload.url,
            capabilities: payload.capabilities,
            version:      payload.version,
            cpuCores:     payload.cpuCores,
            ramGb:        payload.ramGb,
            uptime:       payload.uptime,
            tasksHandled: payload.tasksHandled,
            lastSeen:     Date.now(),
            latencyMs:    measuredLatency || existing?.latencyMs || 999,
            source:       existing?.source === 'p2p-mesh' ? 'p2p-mesh' : 'http-gossip',
        };
        this.peers.set(payload.nodeId, peer);
        this.saveToDisk();
        this.emit('peer:seen', peer);

        // Gossip: share our peer table back to this peer
        this.sendHeartbeatTo(payload.url).catch(() => {});
    }

    // ─── Register peer via GET /api/peers (simple registration) ─────

    registerPeer(nodeId: string, url: string, capabilities: string[], source: PeerSource = 'http-gossip', touch: boolean = true): void {
        if (nodeId === this.selfInfo.nodeId) return;
        const existing = this.peers.get(nodeId);
        this.peers.set(nodeId, {
            nodeId, url, capabilities,
            version:      existing?.version ?? '?',
            cpuCores:     existing?.cpuCores ?? 0,
            ramGb:        existing?.ramGb ?? 0,
            uptime:       existing?.uptime ?? 0,
            tasksHandled: existing?.tasksHandled ?? 0,
            lastSeen:     touch ? Date.now() : (existing?.lastSeen ?? 0),
            latencyMs:    existing?.latencyMs || 999,
            source,
        });
        this.saveToDisk();
    }

    // ─── Routing: find best peer for a given model ────────────────────

    getBestPeer(model: string): PeerInfo | null {
        const now = Date.now();
        const live = Array.from(this.peers.values())
            .filter(p => now - p.lastSeen < PEER_TTL_MS && p.url !== this.selfInfo.url);

        if (!live.length) return null;

        // Score: capability match + low latency + high uptime
        const scored = live.map(p => {
            const modelNorm = model.replace(/[^a-z0-9]/gi, '').toLowerCase();
            const hasModel = p.capabilities.some(c =>
                c.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(modelNorm) ||
                modelNorm.includes(c.replace(/[^a-z0-9]/gi, '').toLowerCase())
            );
            const score = (hasModel ? 1000 : 0)
                + Math.max(0, 2000 - p.latencyMs)
                + Math.min(p.uptime / 3600, 100); // uptime bonus, max 100
            return { peer: p, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.peer || null;
    }

    // ─── Forward inference task to a peer ────────────────────────────

    async forwardToPeer(
        peer: PeerInfo,
        model: string,
        messages: any[],
        maxTokens: number,
        temperature: number
    ): Promise<{ content: string; model: string; tokens: number }> {
        const start = Date.now();
        const resp = await fetch(`${peer.url.replace(/\/$/, '')}/v1/ollama/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens, temperature }),
            signal: AbortSignal.timeout(90_000),
        });
        if (!resp.ok) throw new Error(`Peer ${peer.nodeId} returned ${resp.status}`);
        const data: any = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (!content) throw new Error('Empty response from peer');

        // Update latency measurement
        peer.latencyMs = Date.now() - start;
        peer.lastSeen = Date.now();

        return {
            content,
            model: data.model || model,
            tokens: data.usage?.completion_tokens || 0,
        };
    }

    // ─── Accessors ────────────────────────────────────────────────────

    getLivePeers(): PeerInfo[] {
        const cutoff = Date.now() - PEER_TTL_MS;
        return Array.from(this.peers.values()).filter(p => p.lastSeen > cutoff);
    }

    getAllPeers(): PeerInfo[] {
        return Array.from(this.peers.values());
    }

    getSelfPayload(): HeartbeatPayload {
        const livePeers = this.getLivePeers().slice(0, 20);
        const { source: _source, ...selfWithoutSource } = this.selfInfo;
        return {
            ...selfWithoutSource,
            url: resolvePublicUrl(this.selfInfo.url), // always fresh from tunnel file
            peers: livePeers.map(p => ({
                nodeId: p.nodeId,
                url: p.url,
                capabilities: p.capabilities,
            })),
        };
    }

    getSelfUrl(): string {
        return resolvePublicUrl(this.selfInfo.url);
    }

    // ─── Internal: heartbeat to all live peers ────────────────────────

    private async heartbeatAll(): Promise<void> {
        const live = this.getLivePeers();
        await Promise.allSettled(live.map(p => this.sendHeartbeatTo(p.url)));
        this.saveToDisk();
    }

    private async pingAll(): Promise<void> {
        const all = Array.from(this.peers.values());
        await Promise.allSettled(all.map(p => this.sendHeartbeatTo(p.url)));
    }

    private async sendHeartbeatTo(url: string): Promise<void> {
        if (!url || url === this.selfInfo.url) return;
        const start = Date.now();
        try {
            const payload = this.getSelfPayload();
            const resp = await fetch(`${url.replace(/\/$/, '')}/api/peers/heartbeat`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
                signal:  AbortSignal.timeout(10_000),
            });
            if (!resp.ok) return;
            const data: any = await resp.json().catch(() => ({}));
            const latency = Date.now() - start;

            // The peer may send us peers we don't know about
            if (data.peers) {
                for (const p of data.peers) {
                    if (p.nodeId && p.url && p.nodeId !== this.selfInfo.nodeId && !this.peers.has(p.nodeId)) {
                        this.peers.set(p.nodeId, this.placeholder(p.url, p.nodeId, p.capabilities));
                    }
                }
            }

            // Update latency for this peer
            for (const peer of this.peers.values()) {
                if (peer.url === url) {
                    peer.latencyMs = latency;
                    peer.lastSeen = Date.now();
                }
            }
        } catch {
            // Peer unreachable — don't remove, just let TTL expire
        }
    }

    // ─── Disk persistence ─────────────────────────────────────────────

    private loadFromDisk(): void {
        try {
            if (!existsSync(PEERS_FILE)) return;
            const raw = JSON.parse(readFileSync(PEERS_FILE, 'utf-8'));
            if (Array.isArray(raw)) {
                for (const p of raw) {
                    if (p.nodeId && p.url) this.peers.set(p.nodeId, { ...p, source: p.source || 'http-gossip' });
                }
            }
        } catch { /* ignore corrupt file */ }
    }

    private saveToDisk(): void {
        try {
            const data = JSON.stringify(Array.from(this.peers.values()), null, 2);
            writeFileSync(PEERS_FILE, data, 'utf-8');
        } catch { /* ignore */ }
    }

    private placeholder(url: string, nodeId?: string, capabilities?: string[]): PeerInfo {
        return {
            nodeId:       nodeId || url,
            url,
            capabilities: capabilities || [],
            version:      '?',
            cpuCores:     0,
            ramGb:        0,
            uptime:       0,
            tasksHandled: 0,
            lastSeen:     0, // will be updated on first successful ping
            latencyMs:    9999,
            source:       'http-gossip',
        };
    }
}
