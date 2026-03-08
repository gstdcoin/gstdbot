/**
 * GSTD Node OS — Swarm Orchestrator
 *
 * Manages decentralized node coordination:
 * - Load balancing across swarm nodes
 * - P2P relay for network resilience (bypass ISP blocks)
 * - Model distribution & federated learning coordination
 * - Resource-aware task routing
 * - Automatic peer discovery & mesh networking
 */

import { cpus, totalmem, freemem, loadavg } from 'os';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';

// ─── Types ───────────────────────────────────────────────────────
export interface PeerNode {
    nodeId: string;
    address: string;
    port: number;
    capabilities: PeerCapabilities;
    lastSeen: number;
    latencyMs: number;
    trustScore: number;
    relayAvailable: boolean;
    models: string[];
    memoryEntries: number;
}

export interface PeerCapabilities {
    cpuCores: number;
    ramGb: number;
    gpuAvailable: boolean;
    gpuModel?: string;
    gpuVram?: number;
    storageGb: number;
    bandwidthMbps: number;
    region: string;
    maxConcurrentTasks: number;
}

export interface TaskRoute {
    taskId: string;
    targetNodeId: string;
    reason: string;
    estimatedMs: number;
    fallbackNodes: string[];
}

export interface SwarmModel {
    id: string;
    name: string;
    size: string;
    type: 'inference' | 'embedding' | 'image' | 'audio';
    hostedBy: string[];     // Node IDs that have this model
    popularity: number;
    minRamGb: number;
    minVramGb: number;
}

export interface FederatedTask {
    id: string;
    type: 'train' | 'fine-tune' | 'evaluate';
    model: string;
    dataSlice: string;
    participants: string[];
    status: 'pending' | 'running' | 'aggregating' | 'complete';
    round: number;
    totalRounds: number;
}

// ─── Swarm Orchestrator ──────────────────────────────────────────
export class SwarmOrchestrator {
    private config: NodeConfig;
    private peers: Map<string, PeerNode> = new Map();
    private models: Map<string, SwarmModel> = new Map();
    private federatedTasks: Map<string, FederatedTask> = new Map();
    private relayPeers: Set<string> = new Set();
    private taskQueue: TaskRoute[] = [];
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private peerDiscoveryInterval: ReturnType<typeof setInterval> | null = null;

    constructor(config: NodeConfig) {
        this.config = config;
        this.initBuiltinModels();
    }

    // ─── Initialize ──────────────────────────────────────────
    async init(): Promise<void> {
        logActivity('Swarm Orchestrator initializing...', 'info');

        // Start peer discovery
        this.peerDiscoveryInterval = setInterval(() => this.discoverPeers(), 30000);

        // Start heartbeat to known peers
        this.heartbeatInterval = setInterval(() => this.broadcastHeartbeat(), 15000);

        // Initial peer discovery
        await this.discoverPeers();

        logActivity(`Swarm Orchestrator active (${this.peers.size} peers, ${this.models.size} models)`, 'success');
    }

    async stop(): Promise<void> {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.peerDiscoveryInterval) clearInterval(this.peerDiscoveryInterval);
    }

    // ─── Load Balancer ───────────────────────────────────────
    /**
     * Route a task to the best available node based on:
     * - Required resources (CPU, GPU, RAM, model availability)
     * - Current load on each node
     * - Network latency
     * - Trust score
     */
    routeTask(taskType: string, requirements: any): TaskRoute {
        const candidates = Array.from(this.peers.values())
            .filter(p => Date.now() - p.lastSeen < 60000) // Active peers only
            .filter(p => p.trustScore > 0.3) // Minimum trust
            .sort((a, b) => {
                // Score: lower is better
                const scoreA = this.calculateNodeScore(a, taskType, requirements);
                const scoreB = this.calculateNodeScore(b, taskType, requirements);
                return scoreA - scoreB;
            });

        if (candidates.length === 0) {
            return {
                taskId: requirements.taskId || 'local',
                targetNodeId: this.config.nodeId,
                reason: 'No suitable peers, processing locally',
                estimatedMs: 5000,
                fallbackNodes: [],
            };
        }

        const best = candidates[0];
        return {
            taskId: requirements.taskId || `task-${Date.now()}`,
            targetNodeId: best.nodeId,
            reason: `Best score: latency=${best.latencyMs}ms, trust=${best.trustScore.toFixed(2)}, load=${this.estimateLoad(best)}`,
            estimatedMs: best.latencyMs + 2000,
            fallbackNodes: candidates.slice(1, 4).map(c => c.nodeId),
        };
    }

    private calculateNodeScore(peer: PeerNode, taskType: string, requirements: any): number {
        let score = 0;

        // Latency penalty
        score += peer.latencyMs * 0.1;

        // Trust bonus (higher trust = lower score = better)
        score -= peer.trustScore * 100;

        // Resource match
        const caps = peer.capabilities;
        if (taskType === 'inference' && requirements.model) {
            if (!peer.models.includes(requirements.model)) score += 500; // No model = big penalty
        }
        if (taskType === 'inference' && caps.gpuAvailable) score -= 200; // GPU bonus
        if (caps.ramGb < (requirements.minRamGb || 2)) score += 300; // Insufficient RAM penalty

        // Load estimate
        score += this.estimateLoad(peer) * 50;

        return score;
    }

    private estimateLoad(peer: PeerNode): number {
        // Estimate based on capabilities vs known tasks
        const tasksOnPeer = this.taskQueue.filter(t => t.targetNodeId === peer.nodeId).length;
        return tasksOnPeer / Math.max(peer.capabilities.maxConcurrentTasks, 1);
    }

    // ─── Peer Discovery ──────────────────────────────────────
    async discoverPeers(): Promise<void> {
        try {
            const apiUrl = this.config.swarm.apiUrl;
            const response = await fetch(`${apiUrl}/nodes/public`);
            if (!response.ok) return;
            const data = await response.json() as any;
            const nodes = data.nodes || data || [];

            for (const node of nodes) {
                if (node.node_id === this.config.nodeId) continue;
                this.peers.set(node.node_id, {
                    nodeId: node.node_id,
                    address: node.ip || node.address || '',
                    port: node.port || 8080,
                    capabilities: {
                        cpuCores: node.cpu_cores || 2,
                        ramGb: Math.round((node.ram_total || 4 * 1024 * 1024 * 1024) / (1024 ** 3)),
                        gpuAvailable: !!node.gpu_available,
                        gpuModel: node.gpu_model,
                        storageGb: node.storage_gb || 50,
                        bandwidthMbps: node.bandwidth || 100,
                        region: node.region || 'unknown',
                        maxConcurrentTasks: node.max_tasks || 4,
                    },
                    lastSeen: Date.now(),
                    latencyMs: node.latency || 100,
                    trustScore: node.trust_score || 0.5,
                    relayAvailable: !!node.relay,
                    models: node.models || [],
                    memoryEntries: node.memory_entries || 0,
                });
            }

            // Identify relay nodes
            this.relayPeers = new Set(
                Array.from(this.peers.values())
                    .filter(p => p.relayAvailable)
                    .map(p => p.nodeId)
            );
        } catch {}
    }

    private async broadcastHeartbeat(): Promise<void> {
        // Clean stale peers
        const now = Date.now();
        for (const [id, peer] of this.peers) {
            if (now - peer.lastSeen > 120000) this.peers.delete(id);
        }
    }

    // ─── Network Resilience (P2P Relay) ──────────────────────
    /**
     * If direct connection fails, route through relay nodes.
     * This allows nodes to bypass ISP restrictions.
     */
    getRelayRoute(targetNodeId: string): string[] {
        const relays = Array.from(this.relayPeers)
            .filter(id => id !== targetNodeId)
            .slice(0, 3);

        if (relays.length === 0) return [targetNodeId];
        return [relays[0], targetNodeId]; // Through 1 relay
    }

    isRelayAvailable(): boolean {
        return this.relayPeers.size > 0;
    }

    // ─── Model Distribution ──────────────────────────────────
    private initBuiltinModels(): void {
        const builtinModels: SwarmModel[] = [
            { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', size: '40GB', type: 'inference', hostedBy: [], popularity: 100, minRamGb: 48, minVramGb: 24 },
            { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', size: '5GB', type: 'inference', hostedBy: [], popularity: 95, minRamGb: 8, minVramGb: 6 },
            { id: 'llama-4-scout', name: 'Llama 4 Scout', size: '35GB', type: 'inference', hostedBy: [], popularity: 90, minRamGb: 32, minVramGb: 16 },
            { id: 'llama-4-maverick', name: 'Llama 4 Maverick', size: '35GB', type: 'inference', hostedBy: [], popularity: 85, minRamGb: 32, minVramGb: 16 },
            { id: 'qwen3-32b', name: 'Qwen3 32B', size: '20GB', type: 'inference', hostedBy: [], popularity: 80, minRamGb: 24, minVramGb: 12 },
            { id: 'mistral-7b', name: 'Mistral 7B', size: '4GB', type: 'inference', hostedBy: [], popularity: 75, minRamGb: 8, minVramGb: 4 },
            { id: 'phi-3-mini', name: 'Phi-3 Mini', size: '2.5GB', type: 'inference', hostedBy: [], popularity: 70, minRamGb: 4, minVramGb: 2 },
            { id: 'stable-diffusion-xl', name: 'SDXL', size: '7GB', type: 'image', hostedBy: [], popularity: 65, minRamGb: 8, minVramGb: 6 },
            { id: 'whisper-large', name: 'Whisper Large', size: '3GB', type: 'audio', hostedBy: [], popularity: 60, minRamGb: 4, minVramGb: 4 },
            { id: 'bge-large', name: 'BGE Large', size: '1.5GB', type: 'embedding', hostedBy: [], popularity: 55, minRamGb: 4, minVramGb: 2 },
        ];

        for (const m of builtinModels) {
            this.models.set(m.id, m);
        }
    }

    registerModelHost(modelId: string, nodeId: string): void {
        const model = this.models.get(modelId);
        if (model && !model.hostedBy.includes(nodeId)) {
            model.hostedBy.push(nodeId);
        }
    }

    findModelHosts(modelId: string): PeerNode[] {
        const model = this.models.get(modelId);
        if (!model) return [];
        return model.hostedBy
            .map(id => this.peers.get(id))
            .filter((p): p is PeerNode => !!p);
    }

    getAvailableModels(): SwarmModel[] {
        return Array.from(this.models.values())
            .sort((a, b) => b.popularity - a.popularity);
    }

    // ─── Federated Learning ──────────────────────────────────
    createFederatedTask(model: string, dataSlice: string): FederatedTask {
        const task: FederatedTask = {
            id: `fed-${Date.now()}`,
            type: 'fine-tune',
            model,
            dataSlice,
            participants: [],
            status: 'pending',
            round: 0,
            totalRounds: 10,
        };
        this.federatedTasks.set(task.id, task);
        return task;
    }

    joinFederatedTask(taskId: string, nodeId: string): boolean {
        const task = this.federatedTasks.get(taskId);
        if (!task || task.status !== 'pending') return false;
        if (!task.participants.includes(nodeId)) {
            task.participants.push(nodeId);
        }
        return true;
    }

    getFederatedTasks(): FederatedTask[] {
        return Array.from(this.federatedTasks.values());
    }

    // ─── Status ──────────────────────────────────────────────
    getStatus() {
        return {
            peers: this.peers.size,
            activePeers: Array.from(this.peers.values()).filter(p => Date.now() - p.lastSeen < 60000).length,
            relayNodes: this.relayPeers.size,
            models: this.models.size,
            modelsHosted: Array.from(this.models.values()).filter(m => m.hostedBy.length > 0).length,
            federatedTasks: this.federatedTasks.size,
            taskQueue: this.taskQueue.length,
            loadBalancer: 'active',
            networkResilience: this.relayPeers.size > 0 ? 'relay-available' : 'direct-only',
        };
    }

    getPeers(): PeerNode[] {
        return Array.from(this.peers.values());
    }
}
