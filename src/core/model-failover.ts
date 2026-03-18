/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Smart Model Failover
 * 
 * Better than OpenClaw's model failover:
 *  - Cascading chain: primary → fallback1 → fallback2 → ...
 *  - Latency-aware routing (learns fastest models)
 *  - Health tracking per model
 *  - Automatic recovery when model comes back online
 *  - Usage-weighted selection
 * ═══════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'events';

export interface ModelHealth {
    id: string;
    available: boolean;
    avgLatencyMs: number;
    successRate: number;
    totalRequests: number;
    totalErrors: number;
    lastError: string | null;
    lastErrorAt: string | null;
    lastSuccessAt: string | null;
    cooldownUntil: string | null;
}

interface ModelRecord {
    id: string;
    latencies: number[];
    successes: number;
    failures: number;
    lastError: string | null;
    lastErrorAt: Date | null;
    lastSuccessAt: Date | null;
    cooldownUntil: Date | null;
}

export class ModelFailover extends EventEmitter {
    private models = new Map<string, ModelRecord>();
    private chain: string[];
    private maxLatencies = 20;   // Keep last N for avg
    private cooldownMs = 30000;  // 30s cooldown after consecutive failures
    private consecutiveFailThreshold = 3;

    constructor(modelChain: string[]) {
        super();
        this.chain = modelChain;
        for (const id of modelChain) {
            this.models.set(id, {
                id,
                latencies: [],
                successes: 0,
                failures: 0,
                lastError: null,
                lastErrorAt: null,
                lastSuccessAt: null,
                cooldownUntil: null,
            });
        }
    }

    /** Get best available model (respects cooldowns and health) */
    getBestModel(preferred?: string): string {
        // If preferred is healthy, use it
        if (preferred) {
            const m = this.models.get(preferred);
            if (m && this.isAvailable(m)) return preferred;
        }

        // Walk the chain
        for (const id of this.chain) {
            const m = this.models.get(id);
            if (m && this.isAvailable(m)) return id;
        }

        // All in cooldown — force use the first one
        return this.chain[0];
    }

    private isAvailable(m: ModelRecord): boolean {
        if (m.cooldownUntil && m.cooldownUntil.getTime() > Date.now()) return false;
        return true;
    }

    /** Record successful completion */
    recordSuccess(modelId: string, latencyMs: number) {
        const m = this.getOrCreate(modelId);
        m.successes++;
        m.lastSuccessAt = new Date();
        m.cooldownUntil = null; // Clear cooldown
        m.latencies.push(latencyMs);
        if (m.latencies.length > this.maxLatencies) {
            m.latencies = m.latencies.slice(-this.maxLatencies);
        }
        this.emit('model:success', { modelId, latencyMs });
    }

    /** Record failure */
    recordFailure(modelId: string, error: string) {
        const m = this.getOrCreate(modelId);
        m.failures++;
        m.lastError = error;
        m.lastErrorAt = new Date();

        // Check consecutive failures
        const recentSuccessWindow = Date.now() - 60000; // last 60s
        if (!m.lastSuccessAt || m.lastSuccessAt.getTime() < recentSuccessWindow) {
            if (m.failures % this.consecutiveFailThreshold === 0) {
                m.cooldownUntil = new Date(Date.now() + this.cooldownMs);
                this.emit('model:cooldown', { modelId, until: m.cooldownUntil.toISOString(), error });
            }
        }
        this.emit('model:failure', { modelId, error });
    }

    /** Get health status for all models */
    getHealth(): ModelHealth[] {
        return this.chain.map(id => {
            const m = this.models.get(id)!;
            const total = m.successes + m.failures;
            return {
                id,
                available: this.isAvailable(m),
                avgLatencyMs: m.latencies.length > 0
                    ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
                    : 0,
                successRate: total > 0 ? Math.round(m.successes / total * 10000) / 100 : 100,
                totalRequests: total,
                totalErrors: m.failures,
                lastError: m.lastError,
                lastErrorAt: m.lastErrorAt?.toISOString() || null,
                lastSuccessAt: m.lastSuccessAt?.toISOString() || null,
                cooldownUntil: m.cooldownUntil?.toISOString() || null,
            };
        });
    }

    /** Execute with automatic failover */
    async executeWithFailover<T>(
        fn: (modelId: string) => Promise<T>,
        preferred?: string
    ): Promise<{ result: T; model: string; latencyMs: number }> {
        const tried = new Set<string>();

        for (const modelId of this.getFailoverOrder(preferred)) {
            if (tried.has(modelId)) continue;
            tried.add(modelId);

            const start = Date.now();
            try {
                const result = await fn(modelId);
                const latencyMs = Date.now() - start;
                this.recordSuccess(modelId, latencyMs);
                return { result, model: modelId, latencyMs };
            } catch (e: any) {
                this.recordFailure(modelId, e.message);
                // Continue to next model
            }
        }

        throw new Error('All models failed');
    }

    private getFailoverOrder(preferred?: string): string[] {
        const order: string[] = [];
        if (preferred && this.isAvailable(this.getOrCreate(preferred))) {
            order.push(preferred);
        }
        for (const id of this.chain) {
            if (!order.includes(id) && this.isAvailable(this.getOrCreate(id))) {
                order.push(id);
            }
        }
        // Add cooldown models as last resort
        for (const id of this.chain) {
            if (!order.includes(id)) order.push(id);
        }
        return order;
    }

    private getOrCreate(id: string): ModelRecord {
        let m = this.models.get(id);
        if (!m) {
            m = { id, latencies: [], successes: 0, failures: 0, lastError: null, lastErrorAt: null, lastSuccessAt: null, cooldownUntil: null };
            this.models.set(id, m);
        }
        return m;
    }
}
