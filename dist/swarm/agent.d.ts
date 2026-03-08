/**
 * GSTD Node OS — Swarm Agent
 *
 * Manages connection to the GSTD Swarm Network:
 * - Registers node with platform
 * - Receives and processes AI tasks
 * - Reports hardware capabilities
 * - Earns GSTD tokens for completed tasks
 * - Heartbeat + health reporting
 */
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';
export interface SwarmTask {
    id: string;
    type: 'inference' | 'embedding' | 'verification' | 'storage';
    model?: string;
    prompt?: string;
    payload?: any;
    reward_gstd: number;
    requester: string;
    deadline?: string;
    priority: number;
}
export interface SwarmStats {
    connected: boolean;
    nodeId: string;
    peersCount: number;
    tasksCompleted: number;
    tasksProcessing: number;
    tasksFailed: number;
    totalEarnedGstd: number;
    uptimeSeconds: number;
    lastHeartbeat: string | null;
    rank: number;
}
export declare class SwarmAgent {
    private config;
    private wallet;
    private memory;
    private connected;
    private heartbeatTimer;
    private taskPollTimer;
    private startedAt;
    private stats;
    constructor(config: NodeConfig, wallet: NodeWallet, memory: CollectiveMemory);
    start(): Promise<void>;
    stop(): Promise<void>;
    isConnected(): boolean;
    getStats(): SwarmStats;
    private register;
    private heartbeat;
    private pollTasks;
    private processTask;
    private processInference;
    private processEmbedding;
    private processVerification;
    private processStorage;
    private getCapabilities;
    private apiCall;
}
//# sourceMappingURL=agent.d.ts.map