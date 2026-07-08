/**
 * Swarm Network Client — Join, contribute, earn GSTD tokens
 *
 * Turns any PC into a node in the GSTD decentralized network.
 * - Auto-detects hardware capabilities (CPU, RAM, GPU)
 * - Registers with the GSTD control plane
 * - Serves AI inference requests via Ollama
 * - Earns GSTD tokens for compute contributions
 * - Reports health metrics to the network
 */

import os from 'os';
import { v4 as uuid } from 'uuid';

export interface NodeCapabilities {
    cpu: string;
    cpuCores: number;
    ramGB: number;
    platform: string;
    arch: string;
    gpuDetected: boolean;
    ollamaAvailable: boolean;
    models: string[];
    nodeId: string;
    hostname: string;
}

export interface SwarmStatus {
    connected: boolean;
    nodeId: string;
    uptime: number;
    tasksProcessed: number;
    gstdEarned: number;
    currentLoad: number;
    modelsReady: string[];
}

export class SwarmClient {
    private nodeId: string;
    private startTime: number;
    private controlPlaneUrl: string;
    private ollamaUrl: string;
    private tasksProcessed = 0;
    private gstdEarned = 0;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private connected = false;
    /** Set by register(); required for /nodes/heartbeat (wallet_address) */
    private registeredWallet?: string;

    constructor(controlPlaneUrl = process.env.GSTD_API_URL?.replace(/\/api\/v1$/, '') || 'https://gstdtoken.com', ollamaUrl = 'http://localhost:11434') {
        this.nodeId = process.env.GSTD_NODE_ID || uuid();
        this.startTime = Date.now();
        this.controlPlaneUrl = controlPlaneUrl;
        this.ollamaUrl = ollamaUrl;
    }

    /**
     * Detect hardware capabilities
     */
    async detectCapabilities(): Promise<NodeCapabilities> {
        const cpus = os.cpus();
        const totalRam = os.totalmem() / (1024 ** 3);

        // Check Ollama
        let ollamaAvailable = false;
        let models: string[] = [];
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`);
            if (response.ok) {
                const data: any = await response.json();
                ollamaAvailable = true;
                models = (data.models || []).map((m: any) => m.name);
            }
        } catch (_e) { /* Ollama not running */ }

        // Basic GPU detection (checks expected patterns)
        const gpuDetected = this.detectGPU();

        return {
            cpu: cpus[0]?.model || 'Unknown',
            cpuCores: cpus.length,
            ramGB: Math.round(totalRam * 10) / 10,
            platform: os.platform(),
            arch: os.arch(),
            gpuDetected,
            ollamaAvailable,
            models,
            nodeId: this.nodeId,
            hostname: os.hostname(),
        };
    }

    /**
     * Simple GPU detection
     */
    private detectGPU(): boolean {
        try {
            // Linux: check for nvidia-smi or /proc/driver/nvidia
            const { execSync } = require('child_process');
            try {
                execSync('nvidia-smi', { stdio: 'ignore' });
                return true;
            } catch (_e) { /* no NVIDIA GPU */ }

            // macOS: check for Metal GPU
            if (os.platform() === 'darwin') {
                return true; // Apple Silicon has GPU
            }

            return false;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Register this node with the GSTD control plane
     */
    async register(walletAddress?: string): Promise<boolean> {
        const capabilities = await this.detectCapabilities();
        this.registeredWallet = walletAddress;

        // Public API: POST /api/v1/nodes/register (registry/join requires session/API key)
        if (!walletAddress) {
            console.warn('[Swarm] Pass wallet address to register() — control plane registration skipped');
            this.connected = false;
            return false;
        }

        try {
            const response = await fetch(`${this.controlPlaneUrl}/api/v1/nodes/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': walletAddress,
                },
                body: JSON.stringify({
                    name: `Swarm-${this.nodeId.slice(0, 8)}`,
                    specs: {
                        node_id: this.nodeId,
                        capabilities,
                        version: '1.0.0',
                        type: 'gstdbot-swarm-client',
                    },
                }),
            });

            if (response.ok) {
                this.connected = true;
                console.log(`[Swarm] ✅ Registered as node: ${this.nodeId}`);
                return true;
            }
            console.warn(`[Swarm] Registration failed: ${response.status}`);
            return false;
        } catch (_err) {
            console.warn('[Swarm] Cannot reach control plane — running in standalone mode');
            this.connected = false;
            return false;
        }
    }

    /**
     * Start heartbeat to the control plane
     */
    startHeartbeat(intervalMs = 30_000): void {
        this.heartbeatInterval = setInterval(async () => {
            try {
                const loadavg = os.loadavg()[0] || 0;
                const freeRam = os.freemem() / (1024 ** 3);

                await fetch(`${this.controlPlaneUrl}/api/v1/nodes/heartbeat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        wallet_address: this.registeredWallet || this.nodeId,
                        node_name: `Swarm ${this.nodeId.slice(0, 8)}`,
                        node_version: '1.0.0',
                        uptime_hours: Math.floor((Date.now() - this.startTime) / 3600000),
                        queries_served: this.tasksProcessed,
                        node_id: this.nodeId,
                        status: 'active',
                        load: loadavg,
                        free_ram_gb: Math.round(freeRam * 10) / 10,
                        tasks_completed: this.tasksProcessed,
                        gstd_earned: this.gstdEarned,
                        uptime_s: (Date.now() - this.startTime) / 1000,
                    }),
                });
            } catch (_e) { /* silent — will retry next interval */ }
        }, intervalMs);

        console.log(`[Swarm] Heartbeat started (every ${intervalMs / 1000}s)`);
    }

    /**
     * Stop heartbeat
     */
    stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Process a task from the network
     */
    async processTask(task: { model: string; messages: any[] }): Promise<string> {
        try {
            const response = await fetch(`${this.ollamaUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: task.model,
                    messages: task.messages,
                    stream: false,
                }),
            });

            if (!response.ok) throw new Error(`Ollama: ${response.status}`);

            const data: any = await response.json();
            this.tasksProcessed++;
            this.gstdEarned += 0.001; // Base reward per task

            return data.message?.content || '';
        } catch (err: any) {
            throw new Error(`Failed to process task: ${err.message}`);
        }
    }

    /**
     * Get current swarm status
     */
    getStatus(): SwarmStatus {
        return {
            connected: this.connected,
            nodeId: this.nodeId,
            uptime: (Date.now() - this.startTime) / 1000,
            tasksProcessed: this.tasksProcessed,
            gstdEarned: this.gstdEarned,
            currentLoad: os.loadavg()[0] || 0,
            modelsReady: [],
        };
    }
}
