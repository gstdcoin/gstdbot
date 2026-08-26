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
//
// DEFAULT_BOOTSTRAP_PEERS ships hardcoded (compiled into the software,
// never fetched from a live service) so a brand-new node can join the
// DHT with zero configuration. It is EMPTY today: populating it requires
// a stable DNS record pointing at a project-run node's current address
// (the current bootstrap candidate uses a Cloudflare tunnel URL that
// changes on every restart -- a hardcoded multiaddr needs something
// stable to point at first). See docs/superpowers/specs/2026-08-25-decentralized-discovery-design.md
// section 2 and this plan's Task 6. DO NOT populate this with a
// tunnel URL or any other non-stable address -- an empty list here is
// honest; a stale one silently breaks bootstrap for every new node.
export const DEFAULT_BOOTSTRAP_PEERS: string[] = [];

const GSTD_DEFAULT_BOOTSTRAP: string[] = [
    ...DEFAULT_BOOTSTRAP_PEERS,
    ...(process.env.GSTD_BOOTSTRAP_PEERS || '').split(',').map(s => s.trim()).filter(Boolean),
];

// ─── Protocol IDs ─────────────────────────────────────────────────
const PROTOCOL_HEARTBEAT      = '/gstd/heartbeat/1.0.0';
const PROTOCOL_TASK           = '/gstd/task/1.0.0';
const PROTOCOL_MESH_INFO      = '/gstd/mesh/1.0.0';
const PROTOCOL_PEER_SYNC      = '/gstd/peers/1.0.0';
const PROTOCOL_TASK_RESPONSE  = '/gstd/task-response/1.0.0';
const PROTOCOL_ATTESTATION    = '/gstd/attestation/1.0.0';

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
    // Public HTTP URL (the same tunnel URL PeerManager already tracks) --
    // lets a peer discovered purely via libp2p/DHT become routable over
    // PeerManager's HTTP-based forwardToPeer(). Absent for nodes with no
    // public HTTP endpoint.
    httpUrl: z.string().max(256).optional(),
});

const TaskRequestSchema = z.object({
    type: z.literal('task_request'),
    taskId: z.string().uuid(),
    model: z.string().min(1).max(128),
    prompt: z.string().min(1).max(32768),
    maxTokens: z.number().int().min(1).max(65536),
    senderNodeId: z.string().min(1).max(128),
    rewardGstd: z.number().nonnegative().max(1_000_000),
    // Peer IDs of the other nodes this SAME task was also dispatched to, for
    // redundant-execution quorum verification (see docs/P2P_SETTLEMENT_RFC.md
    // §3). Empty/absent = single-node "best-effort" tier, no quorum expected.
    coExecutors: z.array(z.string().max(128)).max(8).optional(),
    quorumThreshold: z.number().int().min(1).max(8).optional(),
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

// One node's signed commitment to a task result — exchanged directly between
// co-executors, not through a central coordinator. `resultHash`/`signature`
// use the exact same encoding SettlementMaster.tact's verifyQuorum() expects
// (see src/p2p/attestation.ts) so a collected set of these can be submitted
// on-chain without any reformatting.
const AttestationSchema = z.object({
    type: z.literal('attestation'),
    taskId: z.string().uuid(),
    nodeId: z.string().min(1).max(128),
    workerAddr: z.string().min(1).max(128), // TON address (friendly form) this attestor would be paid at
    resultHash: z.string().regex(/^[0-9a-fA-F]{1,64}$/), // hex-encoded uint256
    pubkeyHex: z.string().length(64),
    signatureHex: z.string().length(128),
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
export type P2PAttestation  = z.infer<typeof AttestationSchema>;

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
    httpUrl?: string;
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
        const { kadDHT }       = await import('@libp2p/kad-dht');
        const { ping }         = await import('@libp2p/ping');

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
        } else {
            console.log('    ⚠ Bootstrap: 0 known peers (DEFAULT_BOOTSTRAP_PEERS is empty -- see src/p2p/node.ts)');
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
            services:            {
                identify: identify(),
                ping: ping(),
                dht: kadDHT({ clientMode: false }),
            },
        });
        console.log('    🕸️  DHT: enabled (Kademlia, server mode)');

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
        await this.node.handle(PROTOCOL_HEARTBEAT, async (stream: any, _connection: any) => {
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
        await this.node.handle(PROTOCOL_TASK, async (stream: any, _connection: any) => {
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

        // Task response — completes the previously-declared-but-unused
        // TaskResponseSchema path: lets an executor send its result back to
        // whoever dispatched the task.
        await this.node.handle(PROTOCOL_TASK_RESPONSE, async (stream: any, _connection: any) => {
            try {
                const data = await this.readStream(stream);
                const raw = JSON.parse(data);
                const r = TaskResponseSchema.safeParse(raw);
                if (r.success) {
                    this.stats.messagesReceived++;
                    this.emit('task:result', r.data);
                } else {
                    this.stats.messagesRejected++;
                }
            } catch { /* malformed */ }
        });

        // Attestation — co-executors exchange signed result commitments
        // directly with each other for quorum verification.
        await this.node.handle(PROTOCOL_ATTESTATION, async (stream: any, _connection: any) => {
            try {
                const data = await this.readStream(stream);
                if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] attestation handler raw data:', data.slice(0, 200));
                const raw = JSON.parse(data);
                const r = AttestationSchema.safeParse(raw);
                if (r.success) {
                    this.stats.messagesReceived++;
                    this.emit('attestation:received', r.data);
                } else {
                    if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] attestation schema REJECTED:', r.error?.message);
                    this.stats.messagesRejected++;
                }
            } catch (e) {
                if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] attestation handler EXCEPTION:', e);
            }
        });

        // Mesh info (request/response)
        await this.node.handle(PROTOCOL_MESH_INFO, async (stream: any, _connection: any) => {
            const info = this.getMeshInfo();
            try {
                const enc = new TextEncoder().encode(JSON.stringify(info));
                stream.send(enc);
                await stream.close();
            } catch { /* peer disconnected */ }
        });

        // Peer sync — exchange known peer multiaddrs
        await this.node.handle(PROTOCOL_PEER_SYNC, async (stream: any, _connection: any) => {
            try {
                const data = await this.readStream(stream);
                const raw = JSON.parse(data);
                const r = PeerSyncSchema.safeParse(raw);
                if (r.success) {
                    // Connect to newly learned peers
                    for (const peer of r.data.peers) {
                        if (peer.nodeId === this.config.nodeId) continue;
                        for (const ma of peer.multiaddrs) {
                            this.connectToPeer(ma).catch(() => {});
                        }
                    }
                }
            } catch { /* malformed */ }
        });
    }

    // ─── String peerId -> real PeerId object ─────────────────────────
    // getConnections() takes a typed PeerId, not a string — see the
    // connectToPeer() note above for the sibling bug on the dial side.
    private async toPeerId(peerIdStr: string): Promise<any | null> {
        try {
            const { peerIdFromString } = await import('@libp2p/peer-id');
            return peerIdFromString(peerIdStr);
        } catch {
            return null;
        }
    }

    // ─── Heartbeat handlers ─────────────────────────────────────────
    private getPublicHttpUrl(): string | undefined {
        try {
            const { readFileSync } = require('fs');
            const fromFile = readFileSync('/tmp/gstd_tunnel_url.txt', 'utf-8').trim();
            if (fromFile.startsWith('http')) return fromFile;
        } catch { /* file may not exist yet */ }
        return process.env.GSTD_PUBLIC_URL || undefined;
    }

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
            httpUrl: data.httpUrl,
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
            httpUrl: this.getPublicHttpUrl(),
        };

        const connections = this.node.getConnections();
        for (const conn of connections) {
            try {
                const stream = await conn.newStream(PROTOCOL_HEARTBEAT);
                const enc = new TextEncoder().encode(JSON.stringify(hb));
                stream.send(enc);
                await stream.close();
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
            httpUrl: this.getPublicHttpUrl(),
        };
        try {
            const pid = await this.toPeerId(peerId);
            if (!pid) return;
            const conn = this.node.getConnections(pid)?.[0];
            if (!conn) return;
            const stream = await conn.newStream(PROTOCOL_HEARTBEAT);
            const enc = new TextEncoder().encode(JSON.stringify(hb));
            stream.send(enc);
            await stream.close();
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
                stream.send(enc);
                await stream.close();
            } catch { /* silent */ }
        }
    }

    // ─── Direct connect to a multiaddr ──────────────────────────────
    // NOTE: this previously passed the raw string straight to node.dial(),
    // which this libp2p version rejects (`multiaddrs[0].getComponents is
    // not a function`) — it needs an actual Multiaddr object. That means
    // this method has likely never successfully connected to anything; it
    // just silently returned false. Manual/bootstrap dialing was probably
    // masked by mDNS discovery's auto-dial (which passes a proper PeerInfo,
    // not a string) working on LAN. Fixed here by parsing the string first.
    async connectToPeer(multiaddrStr: string): Promise<boolean> {
        if (!this.node) return false;
        try {
            const { multiaddr } = await import('@multiformats/multiaddr');
            await this.node.dial(multiaddr(multiaddrStr));
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
            const pid = await this.toPeerId(peerId);
            if (!pid) return false;
            const conn = this.node.getConnections(pid)?.[0];
            if (!conn) return false;
            const stream = await conn.newStream(PROTOCOL_TASK);
            const enc = new TextEncoder().encode(JSON.stringify(msg));
            stream.send(enc);
            await stream.close();
            this.stats.messagesSent++;
            return true;
        } catch {
            return false;
        }
    }

    // ─── Send a task result back to whoever dispatched it ───────────
    async sendTaskResult(peerId: string, response: Omit<P2PTaskResponse, 'type'>): Promise<boolean> {
        if (!this.node) return false;
        const msg: P2PTaskResponse = { type: 'task_response', ...response };
        try {
            const pid = await this.toPeerId(peerId);
            if (!pid) return false;
            const conn = this.node.getConnections(pid)?.[0];
            if (!conn) return false;
            const stream = await conn.newStream(PROTOCOL_TASK_RESPONSE);
            const enc = new TextEncoder().encode(JSON.stringify(msg));
            stream.send(enc);
            await stream.close();
            this.stats.messagesSent++;
            return true;
        } catch {
            return false;
        }
    }

    // ─── Send a signed attestation to one co-executor ────────────────
    async sendAttestation(peerId: string, attestation: Omit<P2PAttestation, 'type'>): Promise<boolean> {
        if (!this.node) return false;
        const msg: P2PAttestation = { type: 'attestation', ...attestation };
        try {
            const pid = await this.toPeerId(peerId);
            if (!pid) { if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] sendAttestation: toPeerId failed for', peerId); return false; }
            const conn = this.node.getConnections(pid)?.[0];
            if (!conn) { if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] sendAttestation: no connection to', peerId.slice(0, 20)); return false; }
            const stream = await conn.newStream(PROTOCOL_ATTESTATION);
            const enc = new TextEncoder().encode(JSON.stringify(msg));
            stream.send(enc);
            await stream.close();
            this.stats.messagesSent++;
            if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] sendAttestation: sent to', peerId.slice(0, 20));
            return true;
        } catch (e) {
            if (process.env.GSTD_P2P_DEBUG) console.log('[p2p-debug] sendAttestation EXCEPTION:', e);
            return false;
        }
    }

    // ─── Broadcast a signed attestation to all co-executors for a task ─
    async broadcastAttestation(peerIds: string[], attestation: Omit<P2PAttestation, 'type'>): Promise<number> {
        const results = await Promise.all(peerIds.map(id => this.sendAttestation(id, attestation)));
        return results.filter(Boolean).length;
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
            protocols: [PROTOCOL_HEARTBEAT, PROTOCOL_TASK, PROTOCOL_MESH_INFO, PROTOCOL_PEER_SYNC, PROTOCOL_TASK_RESPONSE, PROTOCOL_ATTESTATION],
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

    /** Raw libp2p transport connection count — distinct from getStats().connectedPeers,
     *  which reflects heartbeat-confirmed application-layer peers. Useful for
     *  diagnosing connectivity before the first heartbeat has round-tripped. */
    getConnectionCount(): number {
        return this.node?.getConnections()?.length || 0;
    }

    private getLivePeers(): PeerRecord[] {
        const cutoff = Date.now() - 2 * 60_000; // 2 min TTL
        return Array.from(this.peers.values()).filter(p => p.lastSeen > cutoff);
    }

    // ─── Stream utility ──────────────────────────────────────────────
    private async readStream(stream: any): Promise<string> {
        // libp2p v3's Stream is itself the AsyncIterable (MessageStream
        // interface) — there is no `.source`/`.sink` duplex pair anymore
        // (that was the pre-v3 it-stream API). Chunks may be a plain
        // Uint8Array or a Uint8ArrayList depending on the muxer; normalize
        // via subarray() either way.
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray?.() || chunk));
            if (chunks.reduce((s, c) => s + c.length, 0) > 65536) break; // 64KB max
        }
        const merged = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        const text = new TextDecoder().decode(merged);
        // Strip any leading control-byte framing (protocol garbage, not user input)
        // eslint-disable-next-line no-control-regex
        return text.replace(/^[-]+/, '');
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
