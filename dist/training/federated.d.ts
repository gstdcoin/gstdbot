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
import type { NodeConfig } from '../index.js';
export interface TrainingJob {
    id: string;
    type: 'finetune' | 'federated' | 'distillation' | 'embedding';
    baseModel: string;
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
}
export interface TrainingConfig {
    dataset?: string;
    epochs: number;
    batchSize: number;
    learningRate: number;
    maxTokens: number;
    lora?: boolean;
    quantization?: '4bit' | '8bit' | 'none';
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
export declare class SwarmTrainer {
    private config;
    private activeJobs;
    private completedJobs;
    private sharedModels;
    private stats;
    private pollTimer;
    constructor(config: NodeConfig);
    init(): Promise<void>;
    stop(): Promise<void>;
    submitJob(config: Partial<TrainingJob>): Promise<string | null>;
    private pollTrainingJobs;
    private processTrainingJob;
    private processFinetune;
    private processFederated;
    private processDistillation;
    private processEmbeddingTraining;
    loadModelRegistry(): Promise<void>;
    shareModel(model: Partial<ModelEntry>): Promise<boolean>;
    getModels(): ModelEntry[];
    getStats(): TrainingStats;
    getActiveJobs(): TrainingJob[];
    private detectGPU;
    private checkOllama;
}
//# sourceMappingURL=federated.d.ts.map