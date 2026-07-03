/**
 * Tracks per-node domain expertise using exponential moving average.
 * Feeds into ThermalRouter for smarter shard assignment.
 */

export interface NodeDomainScores {
    [domain: string]: number;   // EMA of validation loss improvement, 0.0–1.0
}

export class SpecializationTracker {
    private scores: Map<string, NodeDomainScores> = new Map();
    private readonly EMA_ALPHA = 0.1;  // weight of new observation

    /** Update a node's score for a domain after completing a training shard. */
    update(nodeId: string, domain: string, improvement: number): void {
        const clamped = Math.max(0, Math.min(1, improvement));
        const node = this.scores.get(nodeId) || {};
        const prev = node[domain] ?? 0.5;  // start at 0.5 (neutral)
        node[domain] = (1 - this.EMA_ALPHA) * prev + this.EMA_ALPHA * clamped;
        this.scores.set(nodeId, node);
    }

    /** Get a node's specialization score for a domain (0.0–1.0, default 0.5). */
    getScore(nodeId: string, domain: string): number {
        return this.scores.get(nodeId)?.[domain] ?? 0.5;
    }

    /** Get top N node IDs ranked by specialization score for a domain. */
    getTopNodes(domain: string, n: number): string[] {
        return Array.from(this.scores.entries())
            .sort((a, b) => (b[1][domain] ?? 0.5) - (a[1][domain] ?? 0.5))
            .slice(0, n)
            .map(([id]) => id);
    }

    /** Return leaderboard for a domain: [{nodeId, score}] */
    getLeaderboard(domain: string): { nodeId: string; score: number }[] {
        return Array.from(this.scores.entries())
            .map(([nodeId, domains]) => ({ nodeId, score: domains[domain] ?? 0.5 }))
            .sort((a, b) => b.score - a.score);
    }

    serialize(): Record<string, Record<string, number>> {
        const out: Record<string, Record<string, number>> = {};
        for (const [k, v] of this.scores) out[k] = { ...v };
        return out;
    }

    deserialize(data: Record<string, Record<string, number>>): void {
        this.scores.clear();
        for (const [k, v] of Object.entries(data)) {
            this.scores.set(k, { ...v });
        }
    }
}
