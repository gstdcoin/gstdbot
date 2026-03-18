/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Usage Tracker
 * 
 * Tracks model usage, costs, latency per session.
 * OpenClaw tracks usage — GSTD goes further with DeFi integration:
 *  - Per-model token consumption
 *  - Cost tracking (GSTD spent/earned)
 *  - Session analytics
 *  - Rate limiting per model
 *  - Daily/weekly/monthly aggregates
 * ═══════════════════════════════════════════════════════════════
 */

export interface UsageRecord {
    model: string;
    tokens_in: number;
    tokens_out: number;
    latencyMs: number;
    timestamp: string;
    session?: string;
    cost_gstd?: number;
}

export interface ModelStats {
    model: string;
    totalRequests: number;
    totalTokensIn: number;
    totalTokensOut: number;
    avgLatencyMs: number;
    totalCostGstd: number;
    last24h: { requests: number; tokensIn: number; tokensOut: number };
}

export interface UsageSummary {
    totalRequests: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalCostGstd: number;
    modelsUsed: number;
    avgLatencyMs: number;
    models: ModelStats[];
    daily: { date: string; requests: number; tokensIn: number; tokensOut: number }[];
}

export class UsageTracker {
    private records: UsageRecord[] = [];
    private maxRecords = 10000;
    private dailyAggregates = new Map<string, { requests: number; tokensIn: number; tokensOut: number }>();

    /** Record a model usage event */
    record(rec: Omit<UsageRecord, 'timestamp'>) {
        const entry: UsageRecord = { ...rec, timestamp: new Date().toISOString() };
        this.records.push(entry);
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }

        // Update daily aggregates
        const day = entry.timestamp.slice(0, 10);
        const agg = this.dailyAggregates.get(day) || { requests: 0, tokensIn: 0, tokensOut: 0 };
        agg.requests++;
        agg.tokensIn += rec.tokens_in;
        agg.tokensOut += rec.tokens_out;
        this.dailyAggregates.set(day, agg);
    }

    /** Get usage summary */
    getSummary(): UsageSummary {
        const byModel = new Map<string, { requests: number; tokensIn: number; tokensOut: number; latencies: number[]; cost: number; last24h: { requests: number; tokensIn: number; tokensOut: number } }>();
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        for (const r of this.records) {
            const m = byModel.get(r.model) || {
                requests: 0, tokensIn: 0, tokensOut: 0, latencies: [], cost: 0,
                last24h: { requests: 0, tokensIn: 0, tokensOut: 0 },
            };
            m.requests++;
            m.tokensIn += r.tokens_in;
            m.tokensOut += r.tokens_out;
            m.latencies.push(r.latencyMs);
            m.cost += r.cost_gstd || 0;

            if (now - new Date(r.timestamp).getTime() < day) {
                m.last24h.requests++;
                m.last24h.tokensIn += r.tokens_in;
                m.last24h.tokensOut += r.tokens_out;
            }
            byModel.set(r.model, m);
        }

        let totalReqs = 0, totalIn = 0, totalOut = 0, totalCost = 0;
        const allLatencies: number[] = [];

        const models: ModelStats[] = Array.from(byModel.entries()).map(([model, m]) => {
            totalReqs += m.requests;
            totalIn += m.tokensIn;
            totalOut += m.tokensOut;
            totalCost += m.cost;
            allLatencies.push(...m.latencies);

            return {
                model,
                totalRequests: m.requests,
                totalTokensIn: m.tokensIn,
                totalTokensOut: m.tokensOut,
                avgLatencyMs: Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length),
                totalCostGstd: Math.round(m.cost * 10000) / 10000,
                last24h: m.last24h,
            };
        }).sort((a, b) => b.totalRequests - a.totalRequests);

        // Daily aggregates (last 30 days)
        const daily = Array.from(this.dailyAggregates.entries())
            .map(([date, d]) => ({ date, ...d }))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);

        return {
            totalRequests: totalReqs,
            totalTokensIn: totalIn,
            totalTokensOut: totalOut,
            totalCostGstd: Math.round(totalCost * 10000) / 10000,
            modelsUsed: byModel.size,
            avgLatencyMs: allLatencies.length > 0
                ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
                : 0,
            models,
            daily,
        };
    }

    /** Get recent records */
    getRecent(limit = 20): UsageRecord[] {
        return this.records.slice(-limit).reverse();
    }
}
