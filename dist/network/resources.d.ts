/**
 * GSTD Node OS — Resource Sharing Protocol
 *
 * Nodes share compute/storage/bandwidth and earn GSTD:
 * - Publish available resources to swarm
 * - Accept resource requests from other nodes
 * - Metering: track CPU-hours, GB-stored, queries processed
 * - Automatic pricing based on supply/demand
 * - Settlement via GSTD tokens
 */
import type { NodeConfig } from '../index.js';
export interface NodeResources {
    nodeId: string;
    compute: {
        cpuCores: number;
        cpuFreeMhz: number;
        ramFreeMb: number;
        gpuAvailable: boolean;
        gpuModel: string | null;
        gpuVramMb: number;
    };
    storage: {
        availableGb: number;
        readSpeedMbps: number;
        writeSpeedMbps: number;
    };
    network: {
        bandwidthMbps: number;
        latencyMs: number;
        region: string;
    };
    models: string[];
    pricePerUnit: ResourcePricing;
}
export interface ResourcePricing {
    cpuHour: number;
    gpuHour: number;
    storageGbDay: number;
    inferenceQuery: number;
    embeddingQuery: number;
    bandwidthGb: number;
}
export interface ResourceRequest {
    id: string;
    type: 'compute' | 'storage' | 'inference' | 'embedding' | 'bandwidth';
    requesterNodeId: string;
    requirements: any;
    maxPriceGstd: number;
    duration?: number;
    status: 'pending' | 'accepted' | 'processing' | 'completed' | 'failed';
    assignedNodeId?: string;
    startedAt?: string;
    completedAt?: string;
    actualCostGstd?: number;
}
export interface ResourceMeter {
    cpuHoursProvided: number;
    gpuHoursProvided: number;
    storageGbDays: number;
    queriesProcessed: number;
    bandwidthGbServed: number;
    totalEarnedGstd: number;
    totalSpentGstd: number;
}
export declare class ResourceSharing {
    private config;
    private pricing;
    private meter;
    private activeRequests;
    private publishTimer;
    private meterTimer;
    constructor(config: NodeConfig);
    init(): Promise<void>;
    stop(): Promise<void>;
    publishResources(): Promise<void>;
    getAvailableResources(): NodeResources;
    handleRequest(request: ResourceRequest): Promise<any>;
    private handleInferenceRequest;
    private handleEmbeddingRequest;
    private handleComputeRequest;
    private handleStorageRequest;
    private updateMetering;
    updatePricing(newPricing: Partial<ResourcePricing>): void;
    getMeter(): ResourceMeter;
    getPricing(): ResourcePricing;
    getActiveRequests(): ResourceRequest[];
}
//# sourceMappingURL=resources.d.ts.map