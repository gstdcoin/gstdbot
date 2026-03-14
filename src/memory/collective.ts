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

import { createHash } from 'crypto';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';

// ─── Types ───────────────────────────────────────────────────────
export interface MemoryEntry {
    key: string;
    question: string;
    answer: string;
    model: string;
    confidence: number;          // 0-1
    verifiedBy: number;          // how many nodes confirmed
    sources: string[];
    createdAt: string;
    expiresAt: string;
    nodeId: string;
    hits: number;                // how many times recalled
}

export interface MemoryStats {
    l1Entries: number;
    l2Connected: boolean;
    l3Connected: boolean;
    totalRecalls: number;
    totalStores: number;
    hitRate: number;
}

// ─── Collective Memory ──────────────────────────────────────────
export class CollectiveMemory {
    private config: NodeConfig;
    private l1: Map<string, MemoryEntry> = new Map();
    private redisClient: any = null;
    private l2Connected = false;
    private l3Connected = false;
    private stats = { totalRecalls: 0, totalStores: 0, hits: 0 };

    private readonly L1_MAX = 10_000;
    private readonly L1_TTL = 24 * 60 * 60 * 1000; // 24h
    private readonly L2_TTL = 7 * 24 * 60 * 60;    // 7 days (seconds for Redis)

    constructor(config: NodeConfig) {
        this.config = config;
    }

    async init(): Promise<void> {
        // Try to connect to Redis (L2)
        if (this.config.memory.enabled) {
            await this.connectRedis();
        }

        // Check platform API availability (L3)
        await this.checkPlatform();

        // Cleanup timer for L1 expired entries
        setInterval(() => this.cleanupL1(), 60_000);

        const status = [];
        status.push(`L1: ${this.l1.size} entries`);
        if (this.l2Connected) status.push('L2: Redis ✓');
        if (this.l3Connected) status.push('L3: Platform ✓');
        console.log('    Memory layers: ' + status.join(' | '));
    }

    async close(): Promise<void> {
        if (this.redisClient) {
            try { await this.redisClient.quit(); } catch (_e) { }
        }
    }

    isConnected(): boolean {
        return this.l2Connected || this.l3Connected;
    }

    getEntryCount(): number {
        return this.l1.size;
    }

    getStats(): MemoryStats {
        return {
            l1Entries: this.l1.size,
            l2Connected: this.l2Connected,
            l3Connected: this.l3Connected,
            totalRecalls: this.stats.totalRecalls,
            totalStores: this.stats.totalStores,
            hitRate: this.stats.totalRecalls > 0
                ? Math.round((this.stats.hits / this.stats.totalRecalls) * 100)
                : 0,
        };
    }

    // ─── Store ────────────────────────────────────────────────────
    async store(
        question: string,
        answer: string,
        model: string,
        confidence: number,
        sources: string[] = []
    ): Promise<void> {
        const key = this.hashKey(question);
        const now = new Date();

        const entry: MemoryEntry = {
            key,
            question: question.slice(0, 500),
            answer,
            model,
            confidence: Math.max(0, Math.min(1, confidence)),
            verifiedBy: 1,
            sources,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + this.L1_TTL).toISOString(),
            nodeId: this.config.nodeId,
            hits: 0,
        };

        // L1: Always store in memory
        if (this.l1.size >= this.L1_MAX) {
            // Evict oldest entry
            const oldest = Array.from(this.l1.entries())
                .sort((a, b) => a[1].hits - b[1].hits)[0];
            if (oldest) this.l1.delete(oldest[0]);
        }
        this.l1.set(key, entry);

        // L2: Store in Redis if available
        if (this.l2Connected) {
            try {
                await this.redisClient.setEx(
                    `gstd:mem:${key}`,
                    this.L2_TTL,
                    JSON.stringify(entry)
                );
            } catch (_e) { }
        }

        // L3: Report to platform for global sync (high confidence only)
        if (this.l3Connected && confidence >= 0.8) {
            this.syncToPlatform(entry).catch(() => { });
        }

        this.stats.totalStores++;
    }

    // ─── Recall ──────────────────────────────────────────────────
    async recall(question: string): Promise<MemoryEntry | null> {
        const key = this.hashKey(question);
        this.stats.totalRecalls++;

        // L1: Check in-memory first (fastest)
        const l1Entry = this.l1.get(key);
        if (l1Entry && !this.isExpired(l1Entry)) {
            l1Entry.hits++;
            this.stats.hits++;
            return l1Entry;
        }

        // L2: Check Redis
        if (this.l2Connected) {
            try {
                const raw = await this.redisClient.get(`gstd:mem:${key}`);
                if (raw) {
                    const entry: MemoryEntry = JSON.parse(raw);
                    entry.hits++;
                    this.l1.set(key, entry); // Promote to L1
                    this.stats.hits++;
                    return entry;
                }
            } catch (_e) { }
        }

        // L3: Check platform API
        if (this.l3Connected) {
            try {
                const resp = await fetch(
                    `${this.config.swarm.apiUrl}/memory/recall`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            key,
                            question: question.slice(0, 500),
                            node_id: this.config.nodeId,
                        }),
                        signal: AbortSignal.timeout(5000),
                    }
                );
                if (resp.ok) {
                    const data: any = await resp.json();
                    if (data?.answer) {
                        const entry: MemoryEntry = {
                            key,
                            question: question.slice(0, 500),
                            answer: data.answer,
                            model: data.model || 'platform',
                            confidence: data.confidence || 0.9,
                            verifiedBy: data.verified_by || 1,
                            sources: data.sources || [],
                            createdAt: data.created_at || new Date().toISOString(),
                            expiresAt: new Date(Date.now() + this.L1_TTL).toISOString(),
                            nodeId: data.node_id || 'platform',
                            hits: 1,
                        };
                        this.l1.set(key, entry); // Cache locally
                        this.stats.hits++;
                        return entry;
                    }
                }
            } catch (_e) { }
        }

        return null;
    }

    // ─── Verify ──────────────────────────────────────────────────
    async verify(question: string, expectedAnswer: string): Promise<boolean> {
        const existing = await this.recall(question);
        if (!existing) return false;

        // Simple similarity check
        const similarity = this.textSimilarity(existing.answer, expectedAnswer);
        if (similarity > 0.7) {
            existing.verifiedBy++;
            existing.confidence = Math.min(1, existing.confidence + 0.05);
            this.l1.set(existing.key, existing);
            return true;
        }
        return false;
    }

    // ─── Semantic Search (basic) ─────────────────────────────────
    async search(query: string, limit: number = 5): Promise<MemoryEntry[]> {
        const results: Array<{ entry: MemoryEntry; score: number }> = [];
        const queryLower = query.toLowerCase();
        const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 2));

        for (const entry of this.l1.values()) {
            if (this.isExpired(entry)) continue;

            const text = (entry.question + ' ' + entry.answer).toLowerCase();
            let score = 0;
            for (const word of queryWords) {
                if (text.includes(word)) score++;
            }
            if (score > 0) {
                results.push({ entry, score: score / queryWords.size });
            }
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(r => r.entry);
    }

    // ─── Private Helpers ─────────────────────────────────────────
    private hashKey(text: string): string {
        return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 24);
    }

    private isExpired(entry: MemoryEntry): boolean {
        return new Date(entry.expiresAt).getTime() < Date.now();
    }

    private textSimilarity(a: string, b: string): number {
        const setA = new Set(a.toLowerCase().split(/\s+/));
        const setB = new Set(b.toLowerCase().split(/\s+/));
        let common = 0;
        for (const w of setA) if (setB.has(w)) common++;
        return common / Math.max(setA.size, setB.size, 1);
    }

    private cleanupL1(): void {
        const now = Date.now();
        for (const [key, entry] of this.l1) {
            if (new Date(entry.expiresAt).getTime() < now) {
                this.l1.delete(key);
            }
        }
    }

    private async connectRedis(): Promise<void> {
        try {
            // Dynamic import for optional dependency
            const redis = await import('redis').catch(() => null);
            if (!redis) {
                console.log('    Redis module not installed (optional)');
                return;
            }

            this.redisClient = redis.createClient({ url: this.config.memory.redisUrl });
            this.redisClient.on('error', () => { this.l2Connected = false; });

            await this.redisClient.connect();
            await this.redisClient.ping();
            this.l2Connected = true;
            logActivity('Redis connected (L2 memory)', 'success');
        } catch (_e) {
            console.log('    Redis not available — using L1 + L3 only');
        }
    }

    private async checkPlatform(): Promise<void> {
        try {
            const resp = await fetch(
                `${this.config.swarm.apiUrl}/memory/ping`,
                { signal: AbortSignal.timeout(5000) }
            ).catch(() => null);
            this.l3Connected = resp?.ok || false;
        } catch (_e) {
            this.l3Connected = false;
        }
    }

    private async syncToPlatform(entry: MemoryEntry): Promise<void> {
        try {
            await fetch(`${this.config.swarm.apiUrl}/memory/store`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: entry.key,
                    question: entry.question,
                    answer: entry.answer,
                    model: entry.model,
                    confidence: entry.confidence,
                    node_id: this.config.nodeId,
                }),
                signal: AbortSignal.timeout(5000),
            });
        } catch (_e) { }
    }
}
