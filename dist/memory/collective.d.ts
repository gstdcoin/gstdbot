/**
 * GSTD Node OS — Collective Memory
 *
 * Multi-layer distributed knowledge store:
 *   L1: In-memory Map  (instant, per-node)
 *   L2: Redis          (shared across local services, optional)
 *   L3: Platform API   (global swarm knowledge)
 *
 * When a node answers a query with high confidence,
 * the answer gets stored and synced across the network.
 */
import type { NodeConfig } from '../index.js';
export interface MemoryEntry {
    key: string;
    question: string;
    answer: string;
    model: string;
    confidence: number;
    verifiedBy: number;
    sources: string[];
    createdAt: string;
    expiresAt: string;
    nodeId: string;
    hits: number;
}
export interface MemoryStats {
    l1Entries: number;
    l2Connected: boolean;
    l3Connected: boolean;
    totalRecalls: number;
    totalStores: number;
    hitRate: number;
}
export declare class CollectiveMemory {
    private config;
    private l1;
    private redisClient;
    private l2Connected;
    private l3Connected;
    private stats;
    private readonly L1_MAX;
    private readonly L1_TTL;
    private readonly L2_TTL;
    constructor(config: NodeConfig);
    init(): Promise<void>;
    close(): Promise<void>;
    isConnected(): boolean;
    getEntryCount(): number;
    getStats(): MemoryStats;
    store(question: string, answer: string, model: string, confidence: number, sources?: string[]): Promise<void>;
    recall(question: string): Promise<MemoryEntry | null>;
    verify(question: string, expectedAnswer: string): Promise<boolean>;
    search(query: string, limit?: number): Promise<MemoryEntry[]>;
    private hashKey;
    private isExpired;
    private textSimilarity;
    private cleanupL1;
    private connectRedis;
    private checkPlatform;
    private syncToPlatform;
}
//# sourceMappingURL=collective.d.ts.map