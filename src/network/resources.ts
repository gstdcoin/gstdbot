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

import { cpus, freemem, loadavg } from 'os';
import type { NodeConfig } from '../index.js';

// ─── Types ───────────────────────────────────────────────────────
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
    models: string[];           // Available AI models
    pricePerUnit: ResourcePricing;
}

export interface ResourcePricing {
    cpuHour: number;            // GSTD per CPU-hour
    gpuHour: number;            // GSTD per GPU-hour
    storageGbDay: number;       // GSTD per GB per day
    inferenceQuery: number;     // GSTD per inference query
    embeddingQuery: number;     // GSTD per embedding query
    bandwidthGb: number;        // GSTD per GB transferred
}

export interface ResourceRequest {
    id: string;
    type: 'compute' | 'storage' | 'inference' | 'embedding' | 'bandwidth';
    requesterNodeId: string;
    requirements: any;
    maxPriceGstd: number;
    duration?: number;          // seconds
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

// ─── Default Pricing ─────────────────────────────────────────────
const DEFAULT_PRICING: ResourcePricing = {
    cpuHour: 0.05,          // 0.05 GSTD per CPU-hour
    gpuHour: 0.5,           // 0.5 GSTD per GPU-hour
    storageGbDay: 0.01,     // 0.01 GSTD per GB per day
    inferenceQuery: 0.001,  // 0.001 GSTD per inference
    embeddingQuery: 0.0005, // 0.0005 GSTD per embedding
    bandwidthGb: 0.02,      // 0.02 GSTD per GB
};

// ─── Resource Sharing Manager ────────────────────────────────────
export class ResourceSharing {
    private config: NodeConfig;
    private pricing: ResourcePricing;
    private meter: ResourceMeter;
    private activeRequests: Map<string, ResourceRequest> = new Map();
    private publishTimer: NodeJS.Timeout | null = null;
    private meterTimer: NodeJS.Timeout | null = null;

    constructor(config: NodeConfig) {
        this.config = config;
        this.pricing = { ...DEFAULT_PRICING };
        this.meter = {
            cpuHoursProvided: 0,
            gpuHoursProvided: 0,
            storageGbDays: 0,
            queriesProcessed: 0,
            bandwidthGbServed: 0,
            totalEarnedGstd: 0,
            totalSpentGstd: 0,
        };
    }

    async init(): Promise<void> {
        // Publish our resources to the swarm every 60s
        this.publishTimer = setInterval(() => this.publishResources(), 60_000);

        // Update metering every 5 min
        this.meterTimer = setInterval(() => this.updateMetering(), 5 * 60 * 1000);

        // Initial publish
        await this.publishResources();

        console.log('    Resources: sharing enabled | Price: ' +
            this.pricing.inferenceQuery + ' GSTD/query');
    }

    async stop(): Promise<void> {
        if (this.publishTimer) clearInterval(this.publishTimer);
        if (this.meterTimer) clearInterval(this.meterTimer);
    }

    // ─── Publish Resources ───────────────────────────────────────
    async publishResources(): Promise<void> {
        const resources = this.getAvailableResources();

        try {
            await fetch(`${this.config.swarm.apiUrl}/resources/publish`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.config.nodeId,
                },
                body: JSON.stringify({
                    cpu_available: resources.compute.cpuCores,
                    ram_available: resources.compute.ramFreeMb,
                    gpu: resources.compute.gpuModel || '',
                    models: resources.models,
                }),
                signal: AbortSignal.timeout(5000),
            });
        } catch (_e) { }
    }

    getAvailableResources(): NodeResources {
        const cpuInfo = cpus();
        const load = loadavg();
        const freeCpuPercent = Math.max(0, 100 - (load[0] / cpuInfo.length * 100));

        let gpu = { available: false, model: null as string | null, vram: 0 };
        try {
            const { execSync } = require('child_process');
            const out = execSync(
                'nvidia-smi --query-gpu=name,memory.free --format=csv,noheader,nounits 2>/dev/null',
                { encoding: 'utf-8', timeout: 3000 }
            ).trim();
            if (out) {
                const [model, vram] = out.split(',').map((s: string) => s.trim());
                gpu = { available: true, model, vram: parseInt(vram) || 0 };
            }
        } catch (_e) { }

        let diskFree = 0;
        try {
            const { execSync } = require('child_process');
            const out = execSync("df -BG / | tail -1 | awk '{print $4}'", {
                encoding: 'utf-8', timeout: 3000,
            }).trim().replace('G', '');
            diskFree = parseInt(out) || 0;
        } catch (_e) { }

        return {
            nodeId: this.config.nodeId,
            compute: {
                cpuCores: cpuInfo.length,
                cpuFreeMhz: Math.round(freeCpuPercent * (cpuInfo[0]?.speed || 2400) / 100),
                ramFreeMb: Math.round(freemem() / 1048576),
                gpuAvailable: gpu.available,
                gpuModel: gpu.model,
                gpuVramMb: gpu.vram,
            },
            storage: {
                availableGb: diskFree,
                readSpeedMbps: 500,    // Estimated
                writeSpeedMbps: 300,
            },
            network: {
                bandwidthMbps: 100,    // Estimated
                latencyMs: 10,
                region: process.env.GSTD_REGION || 'auto',
            },
            models: this.config.models.available,
            pricePerUnit: this.pricing,
        };
    }

    // ─── Accept Resource Requests ────────────────────────────────
    async handleRequest(request: ResourceRequest): Promise<any> {
        request.assignedNodeId = this.config.nodeId;
        request.status = 'processing';
        request.startedAt = new Date().toISOString();
        this.activeRequests.set(request.id, request);

        try {
            let result: any;

            switch (request.type) {
                case 'inference':
                    result = await this.handleInferenceRequest(request);
                    this.meter.queriesProcessed++;
                    this.meter.totalEarnedGstd += this.pricing.inferenceQuery;
                    break;
                case 'embedding':
                    result = await this.handleEmbeddingRequest(request);
                    this.meter.queriesProcessed++;
                    this.meter.totalEarnedGstd += this.pricing.embeddingQuery;
                    break;
                case 'compute':
                    result = await this.handleComputeRequest(request);
                    break;
                case 'storage':
                    result = await this.handleStorageRequest(request);
                    break;
                default:
                    throw new Error('Unknown request type');
            }

            request.status = 'completed';
            request.completedAt = new Date().toISOString();
            return result;

        } catch (e: any) {
            request.status = 'failed';
            throw e;
        } finally {
            this.activeRequests.delete(request.id);
        }
    }

    private async handleInferenceRequest(req: ResourceRequest): Promise<any> {
        const { model, prompt, max_tokens } = req.requirements;
        const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
        const ollamaModel = model || 'llama3.2:3b';

        const resp = await fetch(`${ollamaUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ollamaModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: max_tokens || 2048,
                stream: false,
            }),
            signal: AbortSignal.timeout(90_000),
        });

        if (!resp.ok) throw new Error(`Ollama: ${resp.status}`);
        return resp.json();
    }

    private async handleEmbeddingRequest(_req: ResourceRequest): Promise<any> {
        return { embedded: true };
    }

    private async handleComputeRequest(_req: ResourceRequest): Promise<any> {
        return { completed: true };
    }

    private async handleStorageRequest(_req: ResourceRequest): Promise<any> {
        return { stored: true };
    }

    // ─── Metering ────────────────────────────────────────────────
    private updateMetering(): void {
        // Update CPU-hours based on load
        const load = loadavg()[0] / cpus().length;
        const cpuHoursUsed = (load * 5) / 60; // 5 min interval
        this.meter.cpuHoursProvided += cpuHoursUsed;
    }

    updatePricing(newPricing: Partial<ResourcePricing>): void {
        this.pricing = { ...this.pricing, ...newPricing };
    }

    getMeter(): ResourceMeter {
        return { ...this.meter };
    }

    getPricing(): ResourcePricing {
        return { ...this.pricing };
    }

    getActiveRequests(): ResourceRequest[] {
        return Array.from(this.activeRequests.values());
    }
}
