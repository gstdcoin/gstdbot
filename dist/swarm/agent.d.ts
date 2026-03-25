/**
 * GSTD Node OS — Swarm Agent
 *
 * Manages connection to the GSTD Swarm Network:
 * - Registers node with platform
 * - Receives and processes AI tasks
 * - Reports hardware capabilities
 * - Earns GSTD tokens for completed tasks
 * - Heartbeat + health reporting
 * - Sovereign Protocol integration (staking, P2P, governance, mesh)
 */
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';
import { SovereignSuite } from './sovereign.js';
export interface SwarmTask {
    id: string;
    type: string;
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
    tier: string;
    tierIcon: string;
    streakDays: number;
    bestStreak: number;
    effectiveRate: number;
    nextTier: string | null;
    nextTierHours: number;
    tasksByType: Record<string, number>;
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
    sovereign: SovereignSuite;
    constructor(config: NodeConfig, wallet: NodeWallet, memory: CollectiveMemory);
    start(): Promise<void>;
    stop(): Promise<void>;
    isConnected(): boolean;
    getStats(): SwarmStats & {
        sovereign?: any;
        economics?: any;
    };
    private static TIER_ICONS;
    private fetchRewardsInfo;
    private register;
    private heartbeat;
    private updateAttempted;
    private tryAutoUpdate;
    private executeRemoteCommand;
    private fetchPeers;
    private pollTasks;
    private processTask;
    private processInference;
    private processEmbedding;
    private processVerification;
    private processStorage;
    private processBridgeVerify;
    private processRender;
    private getCapabilities;
    private apiCall;
}
//# sourceMappingURL=agent.d.ts.map