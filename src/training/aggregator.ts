/**
 * Weighted FedAvg gradient aggregator with outlier protection.
 * Nodes with higher metacognitive_score get more weight.
 * Gradient norm outliers (>3× median) are rejected to prevent poisoning.
 */

import { SpecializationTracker } from './specialization.js';

export interface GradientSubmission {
    jobId: string;
    nodeId: string;
    domain: string;
    metacognitiveScore: number;     // 0.0–1.0 from MetacognitiveEvaluator
    gradientNorm: number;           // L2 norm of the LoRA delta
    datasetSize: number;            // number of training examples processed
    valLossImprovement: number;     // (before - after) / before, can be negative
    loraPath: string;               // URL or local path to .safetensors delta
    submittedAt: number;
}

export interface AggregatedCheckpoint {
    jobId: string;
    round: number;
    participatingNodes: string[];
    rejectedNodes: string[];
    avgMetacognitiveScore: number;
    avgValLossImprovement: number;
    totalDatasetSize: number;
    aggregatedAt: number;
    loraPath: string | null;        // path to merged adapter (set by platform)
}

export interface AggregationResult {
    accepted: boolean;
    reason?: string;
    weight?: number;
}

export class GradientAggregator {
    private submissions: Map<string, GradientSubmission[]> = new Map();
    private checkpoints: Map<string, AggregatedCheckpoint[]> = new Map();
    private roundCounter: Map<string, number> = new Map();

    constructor(
        private specialization: SpecializationTracker,
        private minSubmissions = 2,
        private outlierMultiplier = 3.0,
        private minScore = 0.3,
    ) {}

    /** Accept or reject a gradient submission from a node. */
    submit(submission: GradientSubmission): AggregationResult {
        if (submission.metacognitiveScore < this.minScore) {
            return { accepted: false, reason: `Score ${submission.metacognitiveScore.toFixed(2)} below threshold ${this.minScore}` };
        }
        const pending = this.submissions.get(submission.jobId) || [];
        pending.push(submission);
        this.submissions.set(submission.jobId, pending);

        const weight = submission.metacognitiveScore * submission.datasetSize;
        return { accepted: true, weight };
    }

    /** Aggregate all pending submissions for a job. Requires >= minSubmissions. */
    aggregate(jobId: string, domain: string): AggregatedCheckpoint | null {
        const pending = this.submissions.get(jobId) || [];
        if (pending.length < this.minSubmissions) return null;

        // Outlier detection: reject nodes whose gradient norm > 3× median
        const norms = pending.map(s => s.gradientNorm).sort((a, b) => a - b);
        const medianNorm = norms[Math.floor(norms.length / 2)];
        const threshold = medianNorm * this.outlierMultiplier;

        const valid = pending.filter(s => s.gradientNorm <= threshold);
        const rejected = pending.filter(s => s.gradientNorm > threshold);

        if (valid.length === 0) {
            this.submissions.delete(jobId);
            return null;
        }

        // Weighted FedAvg: weight = metacognitive_score × dataset_size
        const totalWeight = valid.reduce((s, x) => s + x.metacognitiveScore * x.datasetSize, 0);
        const avgScore = valid.reduce((s, x) => s + x.metacognitiveScore, 0) / valid.length;
        const avgImprovement = valid.reduce((s, x) => s + x.metacognitiveScore * x.datasetSize * x.valLossImprovement, 0) / totalWeight;

        // Update specialization scores for participating nodes
        for (const sub of valid) {
            this.specialization.update(sub.nodeId, domain, Math.max(0, sub.valLossImprovement));
        }

        const round = (this.roundCounter.get(jobId) || 0) + 1;
        this.roundCounter.set(jobId, round);

        const checkpoint: AggregatedCheckpoint = {
            jobId,
            round,
            participatingNodes: valid.map(s => s.nodeId),
            rejectedNodes: rejected.map(s => s.nodeId),
            avgMetacognitiveScore: avgScore,
            avgValLossImprovement: avgImprovement,
            totalDatasetSize: valid.reduce((s, x) => s + x.datasetSize, 0),
            aggregatedAt: Date.now(),
            loraPath: null,
        };

        // Store checkpoint, clear pending
        const history = this.checkpoints.get(jobId) || [];
        history.push(checkpoint);
        this.checkpoints.set(jobId, history);
        this.submissions.delete(jobId);

        return checkpoint;
    }

    getJobSubmissions(jobId: string): GradientSubmission[] {
        return this.submissions.get(jobId) || [];
    }

    getCheckpoints(jobId: string): AggregatedCheckpoint[] {
        return this.checkpoints.get(jobId) || [];
    }

    getLatestCheckpoint(jobId: string): AggregatedCheckpoint | null {
        const hist = this.checkpoints.get(jobId) || [];
        return hist.length > 0 ? hist[hist.length - 1] : null;
    }
}
