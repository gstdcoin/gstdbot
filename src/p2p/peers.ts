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

function resolvePublicUrl(configured: string): string {
    // Prefer tunnel file (updated live by tunnel.sh) over static config
    try {
        const fromFile = readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
        if (fromFile.startsWith('http')) return fromFile;
    } catch { /* file may not exist yet */ }
    return configured;
}

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
        const seedUrls = (process.env.GSTD_SEED_PEERS || '')
            .split(',').map(s => s.trim()).filter(s => s.startsWith('http'));
        for (const url of seedUrls) {
            if (url !== this.selfInfo.url) {
                this.peers.set(url, this.placeholder(url));
            }
        }

        // 2. Ping all known peers immediately
        await this.pingAll();

        // 3. Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.heartbeatAll(), HEARTBEAT_INTERVAL);

        console.log(`[Peers] Started. Known peers: ${this.peers.size} | Self: ${this.selfInfo.url}`);
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
        };
        this.peers.set(payload.nodeId, peer);
        this.saveToDisk();
        this.emit('peer:seen', peer);

        // Gossip: share our peer table back to this peer
        this.sendHeartbeatTo(payload.url).catch(() => {});
    }

    // ─── Register peer via GET /api/peers (simple registration) ─────

    registerPeer(nodeId: string, url: string, capabilities: string[]): void {
        if (nodeId === this.selfInfo.nodeId) return;
        const existing = this.peers.get(nodeId);
        this.peers.set(nodeId, {
            nodeId, url, capabilities,
            version: '?', cpuCores: 0, ramGb: 0,
            uptime: 0, tasksHandled: 0,
            lastSeen: Date.now(),
            latencyMs: existing?.latencyMs || 999,
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
        return {
            ...this.selfInfo,
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
                    if (p.nodeId && p.url) this.peers.set(p.nodeId, p);
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
        };
    }
}
