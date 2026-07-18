/**
 * GSTD Node OS — Federated Learning & Training
 *
 * Distributed model training across the swarm:
 * - ThermalRouter: entropy-based shard assignment
 * - GradientAggregator: weighted FedAvg with outlier protection
 * - SpecializationTracker: emergent domain expertise
 * - Training task marketplace: earn GSTD for GPU time
 */

import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import { SpecializationTracker } from './specialization.js';
import { ThermalRouter, TrainingShard, TrainingPeer } from './thermal-router.js';
import { GradientAggregator, GradientSubmission, AggregationResult, AggregatedCheckpoint } from './aggregator.js';
import { NodeHealth, HealthSnapshot } from './health.js';
import { OfflineQueue } from './offline-queue.js';

// ─── Types ───────────────────────────────────────────────────────
export interface TrainingJob {
    id: string;
    type: 'finetune' | 'federated' | 'distillation' | 'embedding';
    baseModel: string;
    domain: string;
    status: 'queued' | 'preparing' | 'training' | 'aggregating' | 'complete' | 'failed';
    progress: number;
    epoch: number;
    totalEpochs: number;
    loss: number;
    learningRate: number;
    participatingNodes: number;
    rewardGstd: number;
    createdAt: string;
    updatedAt: string;
    config: TrainingConfig;
    shards: TrainingShard[];
    checkpoints: AggregatedCheckpoint[];
}

export interface TrainingConfig {
    dataset?: string;
    epochs: number;
    batchSize: number;
    learningRate: number;
    maxTokens: number;
    lora: boolean;
    quantization: '4bit' | '8bit' | 'none';
    splitStrategy: 'data' | 'model' | 'pipeline';
}

export interface ModelEntry {
    id: string;
    name: string;
    baseModel: string;
    type: 'finetuned' | 'distilled' | 'merged';
    size_mb: number;
    createdBy: string;
    trainedAt: string;
    performance: {
        accuracy?: number;
        perplexity?: number;
        bleu?: number;
    };
    available: boolean;
    gstdCost: number;
    downloads: number;
}

export interface TrainingStats {
    activeJobs: number;
    completedJobs: number;
    totalEpochsTrained: number;
    gstdEarnedTraining: number;
    contributedModels: number;
    gpuHoursContributed: number;
}

// ─── Swarm Training Manager ─────────────────────────────────────
export class SwarmTrainer {
    private config: NodeConfig;
    private activeJobs: Map<string, TrainingJob> = new Map();
    private completedJobs: TrainingJob[] = [];
    private sharedModels: ModelEntry[] = [];
    private peers: Map<string, TrainingPeer> = new Map();
    private stats: TrainingStats;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private health: NodeHealth | null = null;
    private offlineQueue: OfflineQueue | null = null;
    private healthSnapshot: HealthSnapshot | null = null;

    readonly specialization: SpecializationTracker;
    readonly router: ThermalRouter;
    readonly aggregator: GradientAggregator;

    constructor(config: NodeConfig) {
        this.config = config;
        this.specialization = new SpecializationTracker();
        this.router = new ThermalRouter(this.specialization);
        this.aggregator = new GradientAggregator(this.specialization);
        this.stats = {
            activeJobs: 0, completedJobs: 0, totalEpochsTrained: 0,
            gstdEarnedTraining: 0, contributedModels: 0, gpuHoursContributed: 0,
        };
    }

    async init(): Promise<void> {
        const hasGpu = await this.detectGPU();
        if (hasGpu) logActivity('GPU detected — training capabilities enabled', 'success');

        const hasOllama = await this.checkOllama();
        if (hasOllama) logActivity('Ollama detected — local model management enabled', 'success');

        // Initialize health monitor
        this.health = new NodeHealth(this.config.nodeId, this.config.swarm.apiUrl);

        // Initialize offline queue (works even without SQLite)
        this.offlineQueue = new OfflineQueue();
        await this.offlineQueue.init();

        // Start health refresh loop
        setInterval(async () => {
            if (this.health) {
                this.healthSnapshot = await this.health.refresh(
                    this.stats.activeJobs,
                    this.offlineQueue?.pendingCount() || 0
                );
            }
        }, 30_000);

        // Initial health snapshot
        this.healthSnapshot = await this.health.refresh(0, 0);
        logActivity(`Node autonomy level: ${((this.healthSnapshot?.autonomyLevel || 0) * 100).toFixed(0)}%`, 'info');

        await this.loadModelRegistry();

        console.log('    Training: ' + (hasGpu ? 'GPU-accelerated' : 'CPU-only')
            + ' | Models: ' + this.sharedModels.length
            + ' | Peers: ' + this.peers.size);
    }

    async stop(): Promise<void> {
        if (this.pollTimer) clearInterval(this.pollTimer);
    }

    // ─── Peer Management ────────────────────────────────────────
    registerPeer(peer: TrainingPeer): void {
        this.peers.set(peer.nodeId, peer);
        logActivity(`Training peer registered: ${peer.nodeId.slice(0, 12)}... (GPU: ${peer.gpuAvailable})`, 'info');
    }

    updatePeerLoad(nodeId: string, load: number): void {
        const peer = this.peers.get(nodeId);
        if (peer) {
            peer.currentLoad = Math.max(0, Math.min(1, load));
            const ts = Date.now() % 1000;
            peer.latencyHistory = [...(peer.latencyHistory || []).slice(-9), ts];
        }
    }

    updatePeerSuccess(nodeId: string, success: boolean): void {
        const peer = this.peers.get(nodeId);
        if (peer) {
            peer.successRate = 0.9 * peer.successRate + 0.1 * (success ? 1 : 0);
        }
    }

    getPeerList(): TrainingPeer[] {
        return Array.from(this.peers.values());
    }

    // ─── Gradient Submission (from nodes) ───────────────────────
    submitGradient(submission: GradientSubmission): AggregationResult {
        const result = this.aggregator.submit(submission);
        if (result.accepted) {
            this.updatePeerSuccess(submission.nodeId, true);
            logActivity(`Gradient accepted from ${submission.nodeId.slice(0, 12)}... (score: ${submission.metacognitiveScore.toFixed(2)})`, 'success');

            const checkpoint = this.aggregator.aggregate(submission.jobId, submission.domain);
            if (checkpoint) {
                logActivity(`Round ${checkpoint.round} aggregated: ${checkpoint.participatingNodes.length} nodes, avg score ${checkpoint.avgMetacognitiveScore.toFixed(2)}`, 'success');
                const job = this.activeJobs.get(submission.jobId);
                if (job) {
                    job.checkpoints.push(checkpoint);
                    job.participatingNodes = checkpoint.participatingNodes.length;
                    job.progress = Math.min(99, job.progress + Math.round(100 / job.totalEpochs));
                }
            }
        } else {
            this.updatePeerSuccess(submission.nodeId, false);
            logActivity(`Gradient rejected from ${submission.nodeId.slice(0, 12)}...: ${result.reason}`, 'warn');
        }
        return result;
    }

    // ─── Shard Routing ──────────────────────────────────────────
    routeShard(shard: TrainingShard): TrainingPeer | null {
        return this.router.route(shard, this.getPeerList());
    }

    routeShardWithFallbacks(shard: TrainingShard, n = 3): TrainingPeer[] {
        return this.router.routeWithFallbacks(shard, this.getPeerList(), n);
    }

    // ─── Leaderboard ─────────────────────────────────────────────
    getLeaderboard(domain = 'general'): { nodeId: string; score: number; tier: string }[] {
        return this.specialization.getLeaderboard(domain).map(entry => ({
            ...entry,
            tier: entry.score >= 0.8 ? 'Sovereign' : entry.score >= 0.6 ? 'Validator' : 'Seedling',
        }));
    }

    // ─── Training Job Lifecycle ──────────────────────────────────
    async submitJob(config: Partial<TrainingJob>): Promise<string | null> {
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/training/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: this.config.nodeId, ...config }),
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                const data: any = await resp.json();
                logActivity(`Training job submitted: ${data.job_id}`, 'success');
                return data.job_id;
            }
        } catch (_e) {}
        return null;
    }

    // ─── Model Registry ──────────────────────────────────────────
    async loadModelRegistry(): Promise<void> {
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/models/registry`,
                { signal: AbortSignal.timeout(5000) }
            ).catch(() => null);
            if (resp?.ok) {
                const data: any = await resp.json();
                this.sharedModels = data.models || [];
            }
        } catch (_e) {}
    }

    async shareModel(model: Partial<ModelEntry>): Promise<boolean> {
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/models/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: this.config.nodeId, ...model }),
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                this.stats.contributedModels++;
                logActivity(`Model shared: ${model.name}`, 'success');
                return true;
            }
        } catch (_e) {}
        return false;
    }

    getModels(): ModelEntry[] { return [...this.sharedModels]; }
    getStats(): TrainingStats { return { ...this.stats }; }
    getActiveJobs(): TrainingJob[] { return Array.from(this.activeJobs.values()); }

    async getHealth(): Promise<HealthSnapshot | null> {
        if (this.health) {
            return await this.health.refresh(
                this.stats.activeJobs,
                this.offlineQueue?.pendingCount() || 0
            );
        }
        return this.healthSnapshot;
    }

    getOfflineQueue(): OfflineQueue | null {
        return this.offlineQueue;
    }

    // ─── Helpers ─────────────────────────────────────────────────
    private async detectGPU(): Promise<boolean> {
        try {
            const { execSync } = require('child_process');
            execSync('nvidia-smi', { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
            return true;
        } catch (_e) { return false; }
    }

    private async checkOllama(): Promise<boolean> {
        try {
            const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
            return resp.ok;
        } catch (_e) { return false; }
    }
}
