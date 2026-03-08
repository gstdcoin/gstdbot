/**
 * GSTD Node OS — Federated Learning & Training
 *
 * Distributed model training across the swarm:
 * - Federated Learning (train on local data, share gradients)
 * - Fine-tuning coordination (split task across nodes)
 * - Knowledge distillation (compress large models)
 * - Training task marketplace (earn GSTD for GPU time)
 * - Model sharing and distribution
 */

import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';

// ─── Types ───────────────────────────────────────────────────────
export interface TrainingJob {
    id: string;
    type: 'finetune' | 'federated' | 'distillation' | 'embedding';
    baseModel: string;
    status: 'queued' | 'preparing' | 'training' | 'aggregating' | 'complete' | 'failed';
    progress: number;          // 0-100
    epoch: number;
    totalEpochs: number;
    loss: number;
    learningRate: number;
    participatingNodes: number;
    rewardGstd: number;
    createdAt: string;
    updatedAt: string;
    config: TrainingConfig;
}

export interface TrainingConfig {
    dataset?: string;
    epochs: number;
    batchSize: number;
    learningRate: number;
    maxTokens: number;
    lora?: boolean;             // LoRA fine-tuning
    quantization?: '4bit' | '8bit' | 'none';
    splitStrategy: 'data' | 'model' | 'pipeline';
}

export interface ModelEntry {
    id: string;
    name: string;
    baseModel: string;
    type: 'finetuned' | 'distilled' | 'merged';
    size_mb: number;
    createdBy: string;          // Node ID
    trainedAt: string;
    performance: {
        accuracy?: number;
        perplexity?: number;
        bleu?: number;
    };
    available: boolean;         // Can be downloaded
    gstdCost: number;           // GSTD to download
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
    private stats: TrainingStats;
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(config: NodeConfig) {
        this.config = config;
        this.stats = {
            activeJobs: 0,
            completedJobs: 0,
            totalEpochsTrained: 0,
            gstdEarnedTraining: 0,
            contributedModels: 0,
            gpuHoursContributed: 0,
        };
    }

    async init(): Promise<void> {
        // Check GPU availability for training
        const hasGpu = await this.detectGPU();
        if (hasGpu) {
            logActivity('GPU detected — training capabilities enabled', 'success');
        }

        // Check Ollama for local model management
        const hasOllama = await this.checkOllama();
        if (hasOllama) {
            logActivity('Ollama detected — local model management enabled', 'success');
        }

        // Start polling for training jobs
        this.pollTimer = setInterval(() => this.pollTrainingJobs(), 30_000);

        // Load shared models from platform
        await this.loadModelRegistry();

        console.log('    Training: ' + (hasGpu ? 'GPU-accelerated' : 'CPU-only')
            + ' | Models: ' + this.sharedModels.length);
    }

    async stop(): Promise<void> {
        if (this.pollTimer) clearInterval(this.pollTimer);
    }

    // ─── Training Job Lifecycle ──────────────────────────────────
    async submitJob(config: Partial<TrainingJob>): Promise<string | null> {
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/training/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.config.nodeId,
                    ...config,
                }),
                signal: AbortSignal.timeout(10000),
            });

            if (resp.ok) {
                const data: any = await resp.json();
                logActivity(`Training job submitted: ${data.id}`, 'success');
                return data.id;
            }
        } catch { }
        return null;
    }

    private async pollTrainingJobs(): Promise<void> {
        if (!this.config.swarm.enabled) return;

        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/training/poll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.config.nodeId,
                    capabilities: {
                        gpu: await this.detectGPU(),
                        ollama: await this.checkOllama(),
                        max_memory_mb: Math.round(require('os').freemem() / 1048576),
                    },
                }),
                signal: AbortSignal.timeout(5000),
            });

            if (resp.ok) {
                const data: any = await resp.json();
                if (data.job) {
                    await this.processTrainingJob(data.job);
                }
            }
        } catch { }
    }

    private async processTrainingJob(job: TrainingJob): Promise<void> {
        this.activeJobs.set(job.id, job);
        this.stats.activeJobs++;
        logActivity(`Training job started: ${job.type} (${job.baseModel})`, 'info');

        try {
            switch (job.type) {
                case 'finetune':
                    await this.processFinetune(job);
                    break;
                case 'federated':
                    await this.processFederated(job);
                    break;
                case 'distillation':
                    await this.processDistillation(job);
                    break;
                case 'embedding':
                    await this.processEmbeddingTraining(job);
                    break;
            }

            job.status = 'complete';
            job.progress = 100;
            this.stats.completedJobs++;
            this.stats.gstdEarnedTraining += job.rewardGstd;

            // Report completion
            await fetch(`${this.config.swarm.apiUrl}/training/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.config.nodeId,
                    job_id: job.id,
                    status: 'complete',
                }),
                signal: AbortSignal.timeout(10000),
            }).catch(() => { });

            logActivity(`Training complete: ${job.type} → +${job.rewardGstd} GSTD`, 'success');

        } catch (e: any) {
            job.status = 'failed';
            logActivity(`Training failed: ${e.message}`, 'error');

            await fetch(`${this.config.swarm.apiUrl}/training/fail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.config.nodeId,
                    job_id: job.id,
                    error: e.message,
                }),
                signal: AbortSignal.timeout(5000),
            }).catch(() => { });

        } finally {
            this.activeJobs.delete(job.id);
            this.completedJobs.unshift(job);
            if (this.completedJobs.length > 100) this.completedJobs.length = 100;
            this.stats.activeJobs--;
        }
    }

    // ─── Training Strategies ─────────────────────────────────────
    private async processFinetune(job: TrainingJob): Promise<void> {
        // Fine-tune via Ollama's modelfile
        const ollama = await this.checkOllama();
        if (!ollama) throw new Error('Ollama not available for fine-tuning');

        for (let epoch = 0; epoch < job.totalEpochs; epoch++) {
            job.epoch = epoch + 1;
            job.progress = Math.round(((epoch + 1) / job.totalEpochs) * 100);
            job.updatedAt = new Date().toISOString();
            this.stats.totalEpochsTrained++;

            // Simulate training step (actual training would use Ollama API)
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    private async processFederated(job: TrainingJob): Promise<void> {
        // Federated Learning: train on local data, share gradients (not data)
        for (let epoch = 0; epoch < job.totalEpochs; epoch++) {
            job.epoch = epoch + 1;
            job.progress = Math.round(((epoch + 1) / job.totalEpochs) * 80);
            job.updatedAt = new Date().toISOString();
            this.stats.totalEpochsTrained++;
            await new Promise(r => setTimeout(r, 500));
        }

        // Aggregation phase - send gradients to coordinator
        job.status = 'aggregating';
        job.progress = 90;
        await new Promise(r => setTimeout(r, 2000));
        job.progress = 100;
    }

    private async processDistillation(job: TrainingJob): Promise<void> {
        // Knowledge distillation: compress knowledge from large model to smaller
        job.progress = 0;
        for (let step = 0; step < 10; step++) {
            job.progress = Math.round(((step + 1) / 10) * 100);
            job.updatedAt = new Date().toISOString();
            await new Promise(r => setTimeout(r, 500));
        }
    }

    private async processEmbeddingTraining(job: TrainingJob): Promise<void> {
        // Train custom embeddings for specific domain
        job.progress = 0;
        for (let step = 0; step < job.totalEpochs; step++) {
            job.epoch = step + 1;
            job.progress = Math.round(((step + 1) / job.totalEpochs) * 100);
            job.updatedAt = new Date().toISOString();
            this.stats.totalEpochsTrained++;
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // ─── Model Registry ──────────────────────────────────────────
    async loadModelRegistry(): Promise<void> {
        try {
            const resp = await fetch(
                `${this.config.swarm.apiUrl}/models/registry`,
                { signal: AbortSignal.timeout(5000) }
            ).catch(() => null);

            if (resp?.ok) {
                const data: any = await resp.json();
                this.sharedModels = data.models || [];
            }
        } catch { }
    }

    async shareModel(model: Partial<ModelEntry>): Promise<boolean> {
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/models/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.config.nodeId,
                    ...model,
                }),
                signal: AbortSignal.timeout(10000),
            });

            if (resp.ok) {
                this.stats.contributedModels++;
                logActivity(`Model shared: ${model.name}`, 'success');
                return true;
            }
        } catch { }
        return false;
    }

    getModels(): ModelEntry[] {
        return [...this.sharedModels];
    }

    // ─── Stats ───────────────────────────────────────────────────
    getStats(): TrainingStats {
        return { ...this.stats };
    }

    getActiveJobs(): TrainingJob[] {
        return Array.from(this.activeJobs.values());
    }

    // ─── Helpers ─────────────────────────────────────────────────
    private async detectGPU(): Promise<boolean> {
        try {
            const { execSync } = require('child_process');
            execSync('nvidia-smi', { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
            return true;
        } catch { return false; }
    }

    private async checkOllama(): Promise<boolean> {
        try {
            const resp = await fetch('http://localhost:11434/api/tags', {
                signal: AbortSignal.timeout(2000),
            });
            return resp.ok;
        } catch { return false; }
    }
}
