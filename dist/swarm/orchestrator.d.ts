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
import type { NodeConfig } from '../index.js';
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
    hostedBy: string[];
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
export declare class SwarmOrchestrator {
    private config;
    private peers;
    private models;
    private federatedTasks;
    private relayPeers;
    private taskQueue;
    private heartbeatInterval;
    private peerDiscoveryInterval;
    constructor(config: NodeConfig);
    init(): Promise<void>;
    stop(): Promise<void>;
    /**
     * Route a task to the best available node based on:
     * - Required resources (CPU, GPU, RAM, model availability)
     * - Current load on each node
     * - Network latency
     * - Trust score
     */
    routeTask(taskType: string, requirements: any): TaskRoute;
    private calculateNodeScore;
    private estimateLoad;
    discoverPeers(): Promise<void>;
    private broadcastHeartbeat;
    /**
     * If direct connection fails, route through relay nodes.
     * This allows nodes to bypass ISP restrictions.
     */
    getRelayRoute(targetNodeId: string): string[];
    isRelayAvailable(): boolean;
    private initBuiltinModels;
    registerModelHost(modelId: string, nodeId: string): void;
    findModelHosts(modelId: string): PeerNode[];
    getAvailableModels(): SwarmModel[];
    createFederatedTask(model: string, dataSlice: string): FederatedTask;
    joinFederatedTask(taskId: string, nodeId: string): boolean;
    getFederatedTasks(): FederatedTask[];
    getStatus(): {
        peers: number;
        activePeers: number;
        relayNodes: number;
        models: number;
        modelsHosted: number;
        federatedTasks: number;
        taskQueue: number;
        loadBalancer: string;
        networkResilience: string;
    };
    getPeers(): PeerNode[];
}
//# sourceMappingURL=orchestrator.d.ts.map