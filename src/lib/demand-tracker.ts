import { isRegistered } from './model-registry.js';

export interface DemandEntry {
    modelId: string;
    requests: number;
}

export class DemandTracker {
    private counts = new Map<string, number>();

    record(modelId: string): void {
        this.counts.set(modelId, (this.counts.get(modelId) ?? 0) + 1);
    }

    getDemandRanking(): DemandEntry[] {
        return [...this.counts.entries()]
            .map(([modelId, requests]) => ({ modelId, requests }))
            .sort((a, b) => b.requests - a.requests);
    }

    getTopRecommended(installed: string[], n = 3): string[] {
        const installedSet = new Set(installed);
        return this.getDemandRanking()
            .filter(e => !installedSet.has(e.modelId) && isRegistered(e.modelId))
            .slice(0, n)
            .map(e => e.modelId);
    }
}

export const demandTracker = new DemandTracker();
