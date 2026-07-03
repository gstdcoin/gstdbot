/**
 * NodeHealth — self-diagnostics for the GSTD training node.
 * Node reports its own health to the network so ThermalRouter
 * can make better routing decisions. Implements the Steiniger
 * "minimum necessary control" principle — nodes self-regulate.
 */

export interface HealthSnapshot {
    nodeId: string;
    timestamp: number;
    cpu: {
        loadPercent: number;
        cores: number;
    };
    memory: {
        totalGb: number;
        freeGb: number;
        usagePercent: number;
    };
    gpu: {
        detected: boolean;
        model: string;
        vramTotalGb: number;
        vramFreeGb: number;
        tempCelsius: number;
        usagePercent: number;
    };
    network: {
        platformReachable: boolean;
        latencyMs: number;
        offlineMinutes: number;
    };
    training: {
        activeJobs: number;
        queuedLocally: number;
        acceptsNewTasks: boolean;
    };
    autonomyLevel: number;  // 0.0–1.0: how independently this node can operate
}

export class NodeHealth {
    private nodeId: string;
    private platformUrl: string;
    private snapshot: HealthSnapshot;
    private offlineSince: number | null = null;
    private latencyHistory: number[] = [];

    constructor(nodeId: string, platformUrl: string) {
        this.nodeId = nodeId;
        this.platformUrl = platformUrl;
        this.snapshot = this.emptySnapshot();
    }

    async refresh(activeJobs: number, queuedLocally: number): Promise<HealthSnapshot> {
        const [cpuLoad, memInfo, gpuInfo, netInfo] = await Promise.all([
            this.getCpuLoad(),
            this.getMemInfo(),
            this.getGpuInfo(),
            this.checkPlatform(),
        ]);

        const acceptsNewTasks = (
            cpuLoad < 0.85 &&
            memInfo.freeGb > 0.5 &&
            activeJobs < 3
        );

        const autonomyLevel = this.computeAutonomy(gpuInfo.detected, netInfo.platformReachable, queuedLocally);

        this.snapshot = {
            nodeId: this.nodeId,
            timestamp: Date.now(),
            cpu: { loadPercent: cpuLoad * 100, cores: require('os').cpus().length },
            memory: memInfo,
            gpu: gpuInfo,
            network: netInfo,
            training: { activeJobs, queuedLocally, acceptsNewTasks },
            autonomyLevel,
        };

        return this.snapshot;
    }

    get(): HealthSnapshot { return this.snapshot; }

    isHealthy(): boolean {
        const s = this.snapshot;
        return s.cpu.loadPercent < 90 && s.memory.usagePercent < 90;
    }

    acceptsTasks(): boolean {
        return this.snapshot.training.acceptsNewTasks;
    }

    private computeAutonomy(hasGpu: boolean, platformReachable: boolean, queuedLocally: number): number {
        let score = 0;
        if (hasGpu) score += 0.4;            // can train locally
        if (queuedLocally > 0) score += 0.3; // has work to do offline
        if (!platformReachable) score += 0;  // penalize: no platform = lower autonomy for now
        else score += 0.2;                   // platform reachable = better coordination
        score += 0.1;                        // base autonomy for running at all
        return Math.min(1.0, score);
    }

    private async getCpuLoad(): Promise<number> {
        const os = require('os');
        const cpus = os.cpus();
        let total = 0, idle = 0;
        for (const cpu of cpus) {
            for (const t in cpu.times) total += (cpu.times as any)[t];
            idle += cpu.times.idle;
        }
        // Simple instantaneous approximation
        const loads = os.loadavg();
        return Math.min(1.0, loads[0] / cpus.length);
    }

    private async getMemInfo(): Promise<HealthSnapshot['memory']> {
        const os = require('os');
        const totalGb = os.totalmem() / 1e9;
        const freeGb = os.freemem() / 1e9;
        return {
            totalGb: Math.round(totalGb * 10) / 10,
            freeGb: Math.round(freeGb * 10) / 10,
            usagePercent: Math.round((1 - freeGb / totalGb) * 100),
        };
    }

    private async getGpuInfo(): Promise<HealthSnapshot['gpu']> {
        try {
            const { execSync } = require('child_process');
            const out = execSync(
                'nvidia-smi --query-gpu=name,memory.total,memory.free,temperature.gpu,utilization.gpu --format=csv,noheader,nounits',
                { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
            ).trim();
            const parts = out.split(',').map((s: string) => s.trim());
            return {
                detected: true,
                model: parts[0] || 'Unknown GPU',
                vramTotalGb: Math.round(Number(parts[1] || 0) / 1024 * 10) / 10,
                vramFreeGb: Math.round(Number(parts[2] || 0) / 1024 * 10) / 10,
                tempCelsius: Number(parts[3] || 0),
                usagePercent: Number(parts[4] || 0),
            };
        } catch (_e) {
            return { detected: false, model: 'none', vramTotalGb: 0, vramFreeGb: 0, tempCelsius: 0, usagePercent: 0 };
        }
    }

    private async checkPlatform(): Promise<HealthSnapshot['network']> {
        const start = Date.now();
        try {
            const resp = await fetch(`${this.platformUrl}/api/v1/health`, {
                signal: AbortSignal.timeout(3000),
            });
            const latencyMs = Date.now() - start;
            this.latencyHistory = [...this.latencyHistory.slice(-9), latencyMs];
            if (resp.ok) {
                this.offlineSince = null;
                return { platformReachable: true, latencyMs, offlineMinutes: 0 };
            }
        } catch (_e) {
            if (!this.offlineSince) this.offlineSince = Date.now();
        }
        const offlineMinutes = this.offlineSince ? Math.round((Date.now() - this.offlineSince) / 60000) : 0;
        return { platformReachable: false, latencyMs: -1, offlineMinutes };
    }

    private emptySnapshot(): HealthSnapshot {
        return {
            nodeId: this.nodeId,
            timestamp: 0,
            cpu: { loadPercent: 0, cores: 1 },
            memory: { totalGb: 0, freeGb: 0, usagePercent: 0 },
            gpu: { detected: false, model: 'none', vramTotalGb: 0, vramFreeGb: 0, tempCelsius: 0, usagePercent: 0 },
            network: { platformReachable: false, latencyMs: -1, offlineMinutes: 0 },
            training: { activeJobs: 0, queuedLocally: 0, acceptsNewTasks: false },
            autonomyLevel: 0,
        };
    }
}
