/**
 * GSTD SuperNode — libp2p Mesh Network
 *
 * TRUE DECENTRALIZATION: Nodes find and talk to each other
 * directly — no central server required.
 *
 * Features:
 *   - Automatic peer discovery via mDNS (LAN)
 *   - Encrypted channels (Noise protocol)
 *   - Multiplexed streams (Yamux)
 *   - Custom GSTD protocols for heartbeat, task delegation, mesh info
 */

// @ts-nocheck — libp2p is ESM-only, using dynamic imports
import { EventEmitter } from 'events';

// ─── Protocol IDs ─────────────────────────────────────────────
const PROTOCOL_HEARTBEAT = '/gstd/heartbeat/1.0.0';
const PROTOCOL_TASK      = '/gstd/task/1.0.0';
const PROTOCOL_MESH_INFO = '/gstd/mesh/1.0.0';

// ─── Message types ────────────────────────────────────────────
export interface P2PHeartbeat {
    type: 'heartbeat';
    nodeId: string;
    walletAddress: string;
    timestamp: number;
    version: string;
    capabilities: string[];
    uptime: number;
    cpuCores: number;
    ramGb: number;
    gpuAvailable: boolean;
}

export interface P2PTaskRequest {
    type: 'task_request';
    taskId: string;
    model: string;
    prompt: string;
    maxTokens: number;
    senderNodeId: string;
    rewardGstd: number;
}

export interface P2PMeshInfo {
    type: 'mesh_info';
    nodeId: string;
    connectedPeers: number;
    knownPeers: string[];
    totalTasksProcessed: number;
    totalGstdEarned: number;
}

export interface P2PNodeConfig {
    nodeId: string;
    walletAddress: string;
    listenPort: number;
    bootstrapPeers: string[];
    enableMdns: boolean;
    version: string;
}

const DEFAULT_P2P_CONFIG: P2PNodeConfig = {
    nodeId: '',
    walletAddress: '',
    listenPort: 4001,
    bootstrapPeers: [],
    enableMdns: true,
    version: '3.4.0',
};

// ─── P2P Mesh Node ────────────────────────────────────────────

export class GstdP2PNode extends EventEmitter {
    private node: any = null;
    private config: P2PNodeConfig;
    private connectedPeers = new Map<string, { nodeId: string; walletAddress: string; lastSeen: number }>();
    private stats = {
        messagesReceived: 0,
        messagesSent: 0,
        tasksRelayed: 0,
        heartbeatsExchanged: 0,
        peersDiscovered: 0,
    };
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor(config: Partial<P2PNodeConfig> = {}) {
        super();
        this.config = { ...DEFAULT_P2P_CONFIG, ...config };
    }

    /**
     * Start the libp2p node and begin peer discovery
     */
    async start(): Promise<string> {
        // Dynamic imports for ESM-only packages
        const { createLibp2p } = await import('libp2p');
        const { tcp } = await import('@libp2p/tcp');
        const { noise } = await import('@chainsafe/libp2p-noise');
        const { yamux } = await import('@chainsafe/libp2p-yamux');
        const { identify } = await import('@libp2p/identify');

        const peerDiscovery: any[] = [];

        // mDNS for local network peer discovery
        if (this.config.enableMdns) {
            try {
                const mdnsMod = await import('@libp2p/mdns');
                peerDiscovery.push(mdnsMod.mdns({ interval: 20000 }));
            } catch {
                console.log('    ⚠ mDNS not available');
            }
        }

        this.node = await createLibp2p({
            addresses: {
                listen: [`/ip4/0.0.0.0/tcp/${this.config.listenPort}`],
            },
            transports: [tcp()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            peerDiscovery: peerDiscovery.length > 0 ? peerDiscovery : undefined,
            services: {
                identify: identify(),
            },
        });

        // Register GSTD protocols
        await this.registerProtocols();

        // Event handlers
        this.node.addEventListener('peer:discovery', (evt: any) => {
            const peerId = evt.detail.id.toString();
            this.stats.peersDiscovered++;
            this.emit('peer:discovered', peerId);
            console.log(`    🔍 P2P: Discovered peer ${peerId.slice(0, 12)}...`);
        });

        this.node.addEventListener('peer:connect', (evt: any) => {
            const peerId = evt.detail.toString();
            console.log(`    🤝 P2P: Connected to ${peerId.slice(0, 12)}...`);
            this.emit('peer:connected', peerId);
        });

        this.node.addEventListener('peer:disconnect', (evt: any) => {
            const peerId = evt.detail.toString();
            this.connectedPeers.delete(peerId);
            this.emit('peer:disconnected', peerId);
        });

        // Start periodic heartbeat broadcast
        this.heartbeatInterval = setInterval(() => {
            this.broadcastHeartbeat().catch(() => {});
        }, 60000);

        const peerId = this.node.peerId.toString();
        const addrs = this.node.getMultiaddrs().map((a: any) => a.toString());

        console.log(`    🌐 P2P Node started: ${peerId.slice(0, 16)}...`);
        console.log(`    📡 Listening on: ${addrs.join(', ') || 'waiting for addresses'}`);
        console.log(`    🔒 Encryption: Noise protocol`);
        console.log(`    🔄 Multiplexer: Yamux`);
        console.log(`    🔍 Discovery: ${this.config.enableMdns ? 'mDNS' : 'manual'}`);

        return peerId;
    }

    /**
     * Register GSTD-specific protocols
     */
    private async registerProtocols(): Promise<void> {
        if (!this.node) return;

        // Heartbeat Protocol
        await this.node.handle(PROTOCOL_HEARTBEAT, async ({ stream }: any) => {
            try {
                const chunks: Uint8Array[] = [];
                for await (const chunk of stream.source) {
                    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray?.() || chunk));
                }
                if (chunks.length > 0) {
                    const text = new TextDecoder().decode(chunks[0]);
                    // Try to parse as JSON from length-prefixed data
                    const jsonStr = text.replace(/^[\x00-\x1f]+/, ''); // Strip length prefix
                    try {
                        const data = JSON.parse(jsonStr) as P2PHeartbeat;
                        this.handleHeartbeat(data);
                    } catch { /* not valid JSON */ }
                }
            } catch {
                // Peer may have disconnected
            }
        });

        // Task Delegation Protocol
        await this.node.handle(PROTOCOL_TASK, async ({ stream }: any) => {
            try {
                const chunks: Uint8Array[] = [];
                for await (const chunk of stream.source) {
                    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray?.() || chunk));
                }
                if (chunks.length > 0) {
                    const text = new TextDecoder().decode(chunks[0]);
                    const jsonStr = text.replace(/^[\x00-\x1f]+/, '');
                    try {
                        const data = JSON.parse(jsonStr) as P2PTaskRequest;
                        this.stats.tasksRelayed++;
                        this.emit('task:received', data);
                    } catch { /* not valid JSON */ }
                }
            } catch {
                // Silent
            }
        });

        // Mesh Info Protocol
        await this.node.handle(PROTOCOL_MESH_INFO, async ({ stream }: any) => {
            const info = this.getMeshInfo();
            const data = new TextEncoder().encode(JSON.stringify(info));
            try {
                await stream.sink([data]);
            } catch {
                // Peer disconnected
            }
        });
    }

    /**
     * Handle incoming heartbeat
     */
    private handleHeartbeat(data: P2PHeartbeat): void {
        this.stats.heartbeatsExchanged++;
        this.stats.messagesReceived++;
        this.connectedPeers.set(data.nodeId, {
            nodeId: data.nodeId,
            walletAddress: data.walletAddress,
            lastSeen: Date.now(),
        });
        this.emit('heartbeat:received', data);
    }

    /**
     * Broadcast heartbeat to all connected peers
     */
    async broadcastHeartbeat(): Promise<void> {
        if (!this.node) return;
        const os = await import('os');

        const heartbeat: P2PHeartbeat = {
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
        };

        const connections = this.node.getConnections();
        for (const conn of connections) {
            try {
                const stream = await conn.newStream(PROTOCOL_HEARTBEAT);
                const data = new TextEncoder().encode(JSON.stringify(heartbeat));
                await stream.sink([data]);
                this.stats.messagesSent++;
            } catch {
                // Peer may have disconnected
            }
        }
    }

    /**
     * Get node capabilities
     */
    private getCapabilities(): string[] {
        const caps = ['inference', 'relay'];
        try {
            const os = require('os');
            const ram = os.totalmem() / (1024 ** 3);
            if (ram >= 8) caps.push('model-7b');
            if (ram >= 16) caps.push('model-13b');
            if (ram >= 32) caps.push('model-30b');
        } catch { /* ignore */ }
        return caps;
    }

    /**
     * Get mesh network information
     */
    getMeshInfo(): P2PMeshInfo {
        return {
            type: 'mesh_info',
            nodeId: this.config.nodeId,
            connectedPeers: this.connectedPeers.size,
            knownPeers: Array.from(this.connectedPeers.keys()),
            totalTasksProcessed: this.stats.tasksRelayed,
            totalGstdEarned: 0,
        };
    }

    /**
     * Get P2P network statistics
     */
    getStats() {
        return {
            ...this.stats,
            connectedPeers: this.connectedPeers.size,
            peerId: this.node?.peerId?.toString().slice(0, 16) || 'not_started',
            addresses: this.node?.getMultiaddrs()?.map((a: any) => a.toString()) || [],
            protocols: [PROTOCOL_HEARTBEAT, PROTOCOL_TASK, PROTOCOL_MESH_INFO],
        };
    }

    /**
     * Get connected peers
     */
    getPeers() {
        return Array.from(this.connectedPeers.entries()).map(([peerId, info]) => ({
            peerId: peerId.slice(0, 16),
            ...info,
            alive: Date.now() - info.lastSeen < 120000,
        }));
    }

    /**
     * Graceful shutdown
     */
    async stop(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.node) {
            try {
                await this.node.stop();
            } catch {
                // Already stopped
            }
            this.node = null;
        }
        console.log('    🛑 P2P Node stopped');
    }
}
