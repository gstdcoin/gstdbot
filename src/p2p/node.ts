/**
 * GSTD SuperNode — libp2p Mesh Network
 *
 * TRUE DECENTRALIZATION: Nodes find each other across the internet —
 * no central server required for peer connectivity.
 *
 * Discovery layers:
 *   1. mDNS        — instant LAN discovery (home / data-center)
 *   2. Bootstrap   — known peers for WAN / first-contact (GSTD_BOOTSTRAP_PEERS)
 *   3. Platform    — registry fallback via GSTD API
 *
 * Encryption: Noise protocol (Ed25519 keys)
 * Multiplexing: Yamux
 * Protocols: /gstd/heartbeat/1.0.0 · /gstd/task/1.0.0 · /gstd/mesh/1.0.0
 */

import { EventEmitter } from 'events';
import { z } from 'zod';

// ─── Well-known GSTD bootstrap nodes ─────────────────────────────
// Add your node's multiaddr to GSTD_BOOTSTRAP_PEERS env var to
// contribute to bootstrap infrastructure.
const GSTD_DEFAULT_BOOTSTRAP: string[] = (
    process.env.GSTD_BOOTSTRAP_PEERS || ''
).split(',').map(s => s.trim()).filter(Boolean);

// ─── Protocol IDs ─────────────────────────────────────────────────
const PROTOCOL_HEARTBEAT = '/gstd/heartbeat/1.0.0';
const PROTOCOL_TASK      = '/gstd/task/1.0.0';
const PROTOCOL_MESH_INFO = '/gstd/mesh/1.0.0';
const PROTOCOL_PEER_SYNC = '/gstd/peers/1.0.0';

// ═══════════════════════════════════════════════════════════════════
// ZOD SCHEMAS — Runtime validation for all P2P messages
// ═══════════════════════════════════════════════════════════════════

const HeartbeatSchema = z.object({
    type: z.literal('heartbeat'),
    nodeId: z.string().min(1).max(128),
    walletAddress: z.string().max(128),
    timestamp: z.number().int().positive(),
    version: z.string().max(32),
    capabilities: z.array(z.string().max(32)).max(20),
    uptime: z.number().nonnegative(),
    cpuCores: z.number().int().min(1).max(1024),
    ramGb: z.number().nonnegative().max(16384),
    gpuAvailable: z.boolean(),
    multiaddrs: z.array(z.string().max(256)).max(10).optional(),
});

const TaskRequestSchema = z.object({
    type: z.literal('task_request'),
    taskId: z.string().uuid(),
    model: z.string().min(1).max(128),
    prompt: z.string().min(1).max(32768),
    maxTokens: z.number().int().min(1).max(65536),
    senderNodeId: z.string().min(1).max(128),
    rewardGstd: z.number().nonnegative().max(1_000_000),
});

const TaskResponseSchema = z.object({
    type: z.literal('task_response'),
    taskId: z.string().uuid(),
    nodeId: z.string().min(1).max(128),
    response: z.string().max(131072),
    model: z.string().max(128),
    tokens: z.number().int().nonnegative(),
    latencyMs: z.number().nonnegative(),
});

export const MeshInfoSchema = z.object({
    type: z.literal('mesh_info'),
    nodeId: z.string().min(1).max(128),
    connectedPeers: z.number().int().nonnegative(),
    knownPeers: z.array(z.string().max(128)).max(200),
    totalTasksProcessed: z.number().int().nonnegative(),
    totalGstdEarned: z.number().nonnegative(),
    multiaddrs: z.array(z.string().max(256)).max(10).optional(),
});

const PeerSyncSchema = z.object({
    type: z.literal('peer_sync'),
    peers: z.array(z.object({
        nodeId: z.string().max(128),
        multiaddrs: z.array(z.string().max(256)).max(10),
        walletAddress: z.string().max(128).optional(),
        capabilities: z.array(z.string().max(32)).max(20).optional(),
    })).max(50),
});

export type P2PHeartbeat    = z.infer<typeof HeartbeatSchema>;
export type P2PTaskRequest  = z.infer<typeof TaskRequestSchema>;
export type P2PTaskResponse = z.infer<typeof TaskResponseSchema>;
export type P2PMeshInfo     = z.infer<typeof MeshInfoSchema>;
export type P2PPeerSync     = z.infer<typeof PeerSyncSchema>;

export interface P2PNodeConfig {
    nodeId: string;
    walletAddress: string;
    listenPort: number;
    bootstrapPeers: string[];
    enableMdns: boolean;
    version: string;
    announceIp?: string; // external IP for nodes behind NAT
}

const DEFAULT_P2P_CONFIG: P2PNodeConfig = {
    nodeId: '',
    walletAddress: '',
    listenPort: parseInt(process.env.GSTD_P2P_PORT || '4001'),
    bootstrapPeers: GSTD_DEFAULT_BOOTSTRAP,
    enableMdns: process.env.GSTD_P2P_MDNS !== 'false',
    version: '3.5.0',
    announceIp: process.env.GSTD_P2P_ANNOUNCE_IP,
};

// ─── Connected peer record ─────────────────────────────────────────
interface PeerRecord {
    nodeId: string;
    walletAddress: string;
    lastSeen: number;
    capabilities: string[];
    multiaddrs: string[];
    latencyMs: number;
}

// ─── P2P Mesh Node ─────────────────────────────────────────────────
export class GstdP2PNode extends EventEmitter {
    private node: any = null;
    private config: P2PNodeConfig;
    private peers = new Map<string, PeerRecord>();
    private stats = {
        messagesReceived: 0,
        messagesSent: 0,
        messagesRejected: 0,
        tasksRelayed: 0,
        heartbeatsExchanged: 0,
        peersDiscovered: 0,
        bootstrapConnections: 0,
    };
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private peerSyncInterval: NodeJS.Timeout | null = null;

    constructor(config: Partial<P2PNodeConfig> = {}) {
        super();
        this.config = { ...DEFAULT_P2P_CONFIG, ...config };
        // Merge bootstrap peers from env + constructor config
        const merged = new Set([
            ...GSTD_DEFAULT_BOOTSTRAP,
            ...(config.bootstrapPeers || []),
        ]);
        this.config.bootstrapPeers = Array.from(merged).filter(Boolean);
    }

    // ─── Start ──────────────────────────────────────────────────────
    async start(): Promise<string> {
        const { createLibp2p } = await import('libp2p');
        const { tcp }          = await import('@libp2p/tcp');
        const { noise }        = await import('@chainsafe/libp2p-noise');
        const { yamux }        = await import('@chainsafe/libp2p-yamux');
        const { identify }     = await import('@libp2p/identify');

        const peerDiscovery: any[] = [];

        // Layer 1: mDNS (LAN)
        if (this.config.enableMdns) {
            try {
                const { mdns } = await import('@libp2p/mdns');
                peerDiscovery.push(mdns({ interval: 20_000 }));
                console.log('    🔍 Discovery: mDNS (LAN)');
            } catch {
                console.log('    ⚠ mDNS unavailable');
            }
        }

        // Layer 2: Bootstrap (WAN)
        if (this.config.bootstrapPeers.length > 0) {
            try {
                const { bootstrap } = await import('@libp2p/bootstrap');
                peerDiscovery.push(bootstrap({
                    list: this.config.bootstrapPeers,
                    timeout: 10_000,
                    tagName: 'gstd-bootstrap',
                    tagValue: 50,
                    tagTTL: 300_000,
                }));
                console.log(`    🌐 Bootstrap: ${this.config.bootstrapPeers.length} known peer(s)`);
            } catch {
                console.log('    ⚠ Bootstrap unavailable');
            }
        }

        // Announce addresses: include external IP if configured
        const listenAddrs = [`/ip4/0.0.0.0/tcp/${this.config.listenPort}`];
        const announceAddrs: string[] = [];
        if (this.config.announceIp) {
            announceAddrs.push(`/ip4/${this.config.announceIp}/tcp/${this.config.listenPort}`);
        }

        this.node = await createLibp2p({
            addresses: {
                listen:   listenAddrs,
                announce: announceAddrs.length > 0 ? announceAddrs : undefined,
            },
            transports:          [tcp()],
            connectionEncrypters:[noise()],
            streamMuxers:        [yamux()],
            peerDiscovery:       peerDiscovery.length > 0 ? peerDiscovery : undefined,
            services:            { identify: identify() },
        });

        await this.registerProtocols();
        this.bindEvents();

        // Periodic tasks
        this.heartbeatInterval = setInterval(() => this.broadcastHeartbeat().catch(() => {}), 60_000);
        this.peerSyncInterval  = setInterval(() => this.syncPeerAddresses().catch(() => {}), 5 * 60_000);

        const peerId = this.node.peerId.toString();
        const addrs  = this.node.getMultiaddrs().map((a: any) => a.toString());

        console.log(`    🌐 P2P Node: ${peerId.slice(0, 16)}...`);
        console.log(`    📡 Listen:   :${this.config.listenPort}/tcp`);
        if (addrs.length > 0) {
            console.log(`    📍 Multiaddr: ${addrs[0]}`);
        }
        console.log(`    🔒 Noise/Yamux · mDNS:${this.config.enableMdns} · Bootstrap:${this.config.bootstrapPeers.length}`);

        // Broadcast initial heartbeat after connections settle
        setTimeout(() => this.broadcastHeartbeat().catch(() => {}), 5_000);

        return peerId;
    }

    // ─── Event handlers ─────────────────────────────────────────────
    private bindEvents(): void {
        this.node.addEventListener('peer:discovery', (evt: any) => {
            const peerId = evt.detail.id.toString();
            this.stats.peersDiscovered++;
            this.emit('peer:discovered', peerId);
            // Attempt connection immediately
            this.node.dial(evt.detail).catch(() => {});
        });

        this.node.addEventListener('peer:connect', (evt: any) => {
            const peerId = evt.detail.toString();
            this.stats.bootstrapConnections++;
            this.emit('peer:connected', peerId);
            // Send heartbeat to new peer
            setTimeout(() => this.sendHeartbeatTo(peerId).catch(() => {}), 1_000);
        });

        this.node.addEventListener('peer:disconnect', (evt: any) => {
            const peerId = evt.detail.toString();
            // Keep the peer record on disconnect — staleness is already tracked
            // via lastSeen + heartbeat TTL elsewhere, nothing to update here.
            this.emit('peer:disconnected', peerId);
        });
    }

    // ─── Protocol registration ──────────────────────────────────────
    private async registerProtocols(): Promise<void> {
        if (!this.node) return;

        // Heartbeat
        await this.node.handle(PROTOCOL_HEARTBEAT, async ({ stream }: any) => {
            try {
                const data = await this.readStream(stream);
                const raw = JSON.parse(data);
                const r = HeartbeatSchema.safeParse(raw);
                if (r.success) {
                    this.handleHeartbeat(r.data);
                } else {
                    this.stats.messagesRejected++;
                }
            } catch { /* malformed */ }
        });

        // Task delegation
        await this.node.handle(PROTOCOL_TASK, async ({ stream }: any) => {
            try {
                const data = await this.readStream(stream);
                const raw = JSON.parse(data);
                const r = TaskRequestSchema.safeParse(raw);
                if (r.success) {
                    this.stats.tasksRelayed++;
                    this.stats.messagesReceived++;
                    this.emit('task:received', r.data);
                } else {
                    this.stats.messagesRejected++;
                }
            } catch { /* malformed */ }
        });

        // Mesh info (request/response)
        await this.node.handle(PROTOCOL_MESH_INFO, async ({ stream }: any) => {
            const info = this.getMeshInfo();
            try {
                const enc = new TextEncoder().encode(JSON.stringify(info));
                await stream.sink([enc]);
            } catch { /* peer disconnected */ }
        });

        // Peer sync — exchange known peer multiaddrs
        await this.node.handle(PROTOCOL_PEER_SYNC, async ({ stream }: any) => {
            try {
                const data = await this.readStream(stream);
                const raw = JSON.parse(data);
                const r = PeerSyncSchema.safeParse(raw);
                if (r.success) {
                    // Connect to newly learned peers
                    for (const peer of r.data.peers) {
                        if (peer.nodeId === this.config.nodeId) continue;
                        for (const ma of peer.multiaddrs) {
                            this.node.dial(ma).catch(() => {});
                        }
                    }
                }
            } catch { /* malformed */ }
        });
    }

    // ─── Heartbeat handlers ─────────────────────────────────────────
    private handleHeartbeat(data: P2PHeartbeat): void {
        this.stats.heartbeatsExchanged++;
        this.stats.messagesReceived++;
        this.peers.set(data.nodeId, {
            nodeId: data.nodeId,
            walletAddress: data.walletAddress,
            lastSeen: Date.now(),
            capabilities: data.capabilities,
            multiaddrs: data.multiaddrs || [],
            latencyMs: 0,
        });
        this.emit('heartbeat:received', data);
    }

    async broadcastHeartbeat(): Promise<void> {
        if (!this.node) return;
        const os = await import('os');
        const hb: P2PHeartbeat = {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            walletAddress: this.config.walletAddress,
            timestamp: Date.now(),
            version: this.config.version,
            capabilities: this.getCapabilities(),
            uptime: process.uptime(),
            cpuCores: os.cpus().length,
            ramGb: Math.round(os.totalmem() / (1024 ** 3)),
            gpuAvailable: false,
            multiaddrs: this.node.getMultiaddrs().map((a: any) => a.toString()),
        };

        const connections = this.node.getConnections();
        for (const conn of connections) {
            try {
                const stream = await conn.newStream(PROTOCOL_HEARTBEAT);
                const enc = new TextEncoder().encode(JSON.stringify(hb));
                await stream.sink([enc]);
                this.stats.messagesSent++;
            } catch { /* peer may have disconnected */ }
        }
    }

    private async sendHeartbeatTo(peerId: string): Promise<void> {
        if (!this.node) return;
        const os = await import('os');
        const hb: P2PHeartbeat = {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            walletAddress: this.config.walletAddress,
            timestamp: Date.now(),
            version: this.config.version,
            capabilities: this.getCapabilities(),
            uptime: process.uptime(),
            cpuCores: os.cpus().length,
            ramGb: Math.round(os.totalmem() / (1024 ** 3)),
            gpuAvailable: false,
            multiaddrs: this.node.getMultiaddrs().map((a: any) => a.toString()),
        };
        try {
            const conn = this.node.getConnections(peerId as any)?.[0];
            if (!conn) return;
            const stream = await conn.newStream(PROTOCOL_HEARTBEAT);
            const enc = new TextEncoder().encode(JSON.stringify(hb));
            await stream.sink([enc]);
            this.stats.messagesSent++;
        } catch { /* silent */ }
    }

    // ─── Peer sync — gossip known peers to each other ───────────────
    private async syncPeerAddresses(): Promise<void> {
        if (!this.node) return;
        const livePeers = this.getLivePeers();
        if (livePeers.length === 0) return;

        const msg: P2PPeerSync = {
            type: 'peer_sync',
            peers: livePeers.map(p => ({
                nodeId: p.nodeId,
                multiaddrs: p.multiaddrs,
                walletAddress: p.walletAddress,
                capabilities: p.capabilities,
            })),
        };
        const enc = new TextEncoder().encode(JSON.stringify(msg));

        for (const conn of this.node.getConnections()) {
            try {
                const stream = await conn.newStream(PROTOCOL_PEER_SYNC);
                await stream.sink([enc]);
            } catch { /* silent */ }
        }
    }

    // ─── Direct connect to a multiaddr ──────────────────────────────
    async connectToPeer(multiaddr: string): Promise<boolean> {
        if (!this.node) return false;
        try {
            await this.node.dial(multiaddr);
            return true;
        } catch {
            return false;
        }
    }

    // ─── Send a task request to specific peer ───────────────────────
    async sendTask(peerId: string, task: Omit<P2PTaskRequest, 'type'>): Promise<boolean> {
        if (!this.node) return false;
        const msg: P2PTaskRequest = { type: 'task_request', ...task };
        try {
            const conn = this.node.getConnections(peerId as any)?.[0];
            if (!conn) return false;
            const stream = await conn.newStream(PROTOCOL_TASK);
            const enc = new TextEncoder().encode(JSON.stringify(msg));
            await stream.sink([enc]);
            this.stats.messagesSent++;
            return true;
        } catch {
            return false;
        }
    }

    // ─── Capability detection ────────────────────────────────────────
    private getCapabilities(): string[] {
        const caps = ['inference', 'relay'];
        try {
            const os = require('os');
            const ram = os.totalmem() / (1024 ** 3);
            if (ram >= 4)  caps.push('model-3b');
            if (ram >= 8)  caps.push('model-7b');
            if (ram >= 16) caps.push('model-13b');
            if (ram >= 32) caps.push('model-30b');
            if (process.env.GSTD_NAAS_ENABLED === 'true') caps.push('naas');
            if (process.env.GSTD_STORAGE) caps.push('storage');
        } catch { /* ignore */ }
        return caps;
    }

    // ─── Accessors ──────────────────────────────────────────────────
    getMeshInfo(): P2PMeshInfo {
        const live = this.getLivePeers();
        return {
            type: 'mesh_info',
            nodeId: this.config.nodeId,
            connectedPeers: live.length,
            knownPeers: live.map(p => p.nodeId),
            totalTasksProcessed: this.stats.tasksRelayed,
            totalGstdEarned: 0,
            multiaddrs: this.node?.getMultiaddrs()?.map((a: any) => a.toString()) || [],
        };
    }

    getStats() {
        return {
            ...this.stats,
            connectedPeers: this.getLivePeers().length,
            totalKnownPeers: this.peers.size,
            peerId: this.node?.peerId?.toString() || 'not_started',
            peerIdShort: this.node?.peerId?.toString().slice(0, 16) || 'not_started',
            addresses: this.node?.getMultiaddrs()?.map((a: any) => a.toString()) || [],
            bootstrapConfigured: this.config.bootstrapPeers.length,
            protocols: [PROTOCOL_HEARTBEAT, PROTOCOL_TASK, PROTOCOL_MESH_INFO, PROTOCOL_PEER_SYNC],
        };
    }

    getPeers() {
        return this.getLivePeers().map(p => ({
            ...p,
            peerIdShort: p.nodeId.slice(0, 16),
            alive: true,
        }));
    }

    /** Return your node's multiaddrs for sharing with other nodes */
    getMultiaddrs(): string[] {
        return this.node?.getMultiaddrs()?.map((a: any) => a.toString()) || [];
    }

    private getLivePeers(): PeerRecord[] {
        const cutoff = Date.now() - 2 * 60_000; // 2 min TTL
        return Array.from(this.peers.values()).filter(p => p.lastSeen > cutoff);
    }

    // ─── Stream utility ──────────────────────────────────────────────
    private async readStream(stream: any): Promise<string> {
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream.source) {
            chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray?.() || chunk));
            if (chunks.reduce((s, c) => s + c.length, 0) > 65536) break; // 64KB max
        }
        const merged = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        const text = new TextDecoder().decode(merged);
        // Strip any leading control-byte framing (protocol garbage, not user input)
        // eslint-disable-next-line no-control-regex
        return text.replace(/^[ -]+/, '');
    }

    // ─── Graceful stop ───────────────────────────────────────────────
    async stop(): Promise<void> {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.peerSyncInterval)  clearInterval(this.peerSyncInterval);
        if (this.node) {
            try { await this.node.stop(); } catch { /* already stopped */ }
            this.node = null;
        }
        console.log('    🛑 P2P Node stopped');
    }
}
