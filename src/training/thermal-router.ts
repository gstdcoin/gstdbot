/**
 * Routes training shards to nodes via entropy minimization.
 * Low-entropy = high predictability = good fit for this shard.
 * Inspired by thermodynamic flow toward equilibrium.
 */

import { SpecializationTracker } from './specialization.js';

export interface TrainingShard {
    id: string;
    jobId: string;
    domain: string;             // e.g. "medical", "code", "finance", "general"
    dataUrl: string;            // signed URL, expires in 2h
    expiresAt: number;          // unix ms
    steps: number;
    baseModel: string;
}

export interface TrainingPeer {
    nodeId: string;
    address: string;            // http://host:port
    gpuAvailable: boolean;
    vramGb: number;
    latencyMs: number;
    latencyHistory: number[];   // last 10 latencies
    successRate: number;        // 0.0–1.0, last 20 tasks
    currentLoad: number;        // 0.0–1.0
    capabilities: string[];
}

export class ThermalRouter {
    constructor(private specialization: SpecializationTracker) {}

    /**
     * Compute computational entropy for a node on a given domain.
     * Lower = more predictable = better candidate.
     */
    computeEntropy(peer: TrainingPeer, domain: string): number {
        const latencyVariance = this.variance(peer.latencyHistory);
        const failureRate = 1 - peer.successRate;
        const specializationScore = this.specialization.getScore(peer.nodeId, domain);

        // Thermodynamic: H ∝ variance × failure_rate × (1 - specialization)
        // Each factor amplifies uncertainty
        return latencyVariance * (failureRate + 0.01) * (1 - specializationScore + 0.01);
    }

    /**
     * Route a shard to the best available peer.
     * Returns null if no capable peer is available.
     */
    route(shard: TrainingShard, peers: TrainingPeer[]): TrainingPeer | null {
        const capable = peers.filter(p =>
            p.capabilities.includes('finetune') &&
            p.currentLoad < 0.9 &&
            (!requiresGpu(shard.baseModel) || p.gpuAvailable)
        );

        if (capable.length === 0) return null;

        return capable.sort(
            (a, b) => this.computeEntropy(a, shard.domain) - this.computeEntropy(b, shard.domain)
        )[0];
    }

    /** Select up to N peers for redundant shard assignment (fault tolerance). */
    routeWithFallbacks(shard: TrainingShard, peers: TrainingPeer[], n = 3): TrainingPeer[] {
        const capable = peers.filter(p =>
            p.capabilities.includes('finetune') &&
            p.currentLoad < 0.9 &&
            (!requiresGpu(shard.baseModel) || p.gpuAvailable)
        );
        return capable
            .sort((a, b) => this.computeEntropy(a, shard.domain) - this.computeEntropy(b, shard.domain))
            .slice(0, n);
    }

    private variance(values: number[]): number {
        if (values.length < 2) return 0;
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    }
}

function requiresGpu(model: string): boolean {
    return ['llama3.1:70b', 'qwen2.5:32b'].includes(model);
}
