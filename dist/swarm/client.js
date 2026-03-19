"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmClient = void 0;
const os_1 = __importDefault(require("os"));
const uuid_1 = require("uuid");
class SwarmClient {
    nodeId;
    startTime;
    controlPlaneUrl;
    ollamaUrl;
    tasksProcessed = 0;
    gstdEarned = 0;
    heartbeatInterval = null;
    connected = false;
    constructor(controlPlaneUrl = process.env.GSTD_API_URL?.replace(/\/api\/v1$/, '') || 'https://app.gstdtoken.com', ollamaUrl = 'http://localhost:11434') {
        this.nodeId = (0, uuid_1.v4)();
        this.startTime = Date.now();
        this.controlPlaneUrl = controlPlaneUrl;
        this.ollamaUrl = ollamaUrl;
    }
    /**
     * Detect hardware capabilities
     */
    async detectCapabilities() {
        const cpus = os_1.default.cpus();
        const totalRam = os_1.default.totalmem() / (1024 ** 3);
        // Check Ollama
        let ollamaAvailable = false;
        let models = [];
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`);
            if (response.ok) {
                const data = await response.json();
                ollamaAvailable = true;
                models = (data.models || []).map((m) => m.name);
            }
        }
        catch (_e) { /* Ollama not running */ }
        // Basic GPU detection (checks expected patterns)
        const gpuDetected = this.detectGPU();
        return {
            cpu: cpus[0]?.model || 'Unknown',
            cpuCores: cpus.length,
            ramGB: Math.round(totalRam * 10) / 10,
            platform: os_1.default.platform(),
            arch: os_1.default.arch(),
            gpuDetected,
            ollamaAvailable,
            models,
            nodeId: this.nodeId,
            hostname: os_1.default.hostname(),
        };
    }
    /**
     * Simple GPU detection
     */
    detectGPU() {
        try {
            // Linux: check for nvidia-smi or /proc/driver/nvidia
            const { execSync } = require('child_process');
            try {
                execSync('nvidia-smi', { stdio: 'ignore' });
                return true;
            }
            catch (_e) { /* no NVIDIA GPU */ }
            // macOS: check for Metal GPU
            if (os_1.default.platform() === 'darwin') {
                return true; // Apple Silicon has GPU
            }
            return false;
        }
        catch (_e) {
            return false;
        }
    }
    /**
     * Register this node with the GSTD control plane
     */
    async register(walletAddress) {
        const capabilities = await this.detectCapabilities();
        try {
            const response = await fetch(`${this.controlPlaneUrl}/api/v1/registry/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.nodeId,
                    capabilities,
                    wallet_address: walletAddress,
                    version: '1.0.0',
                    type: 'gstdbot-node',
                }),
            });
            if (response.ok) {
                this.connected = true;
                console.log(`[Swarm] ✅ Registered as node: ${this.nodeId}`);
                return true;
            }
            else {
                console.warn(`[Swarm] Registration failed: ${response.status}`);
                return false;
            }
        }
        catch (_err) {
            console.warn('[Swarm] Cannot reach control plane — running in standalone mode');
            this.connected = false;
            return false;
        }
    }
    /**
     * Start heartbeat to the control plane
     */
    startHeartbeat(intervalMs = 30_000) {
        this.heartbeatInterval = setInterval(async () => {
            try {
                const loadavg = os_1.default.loadavg()[0] || 0;
                const freeRam = os_1.default.freemem() / (1024 ** 3);
                await fetch(`${this.controlPlaneUrl}/api/v1/nodes/heartbeat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_id: this.nodeId,
                        status: 'active',
                        load: loadavg,
                        free_ram_gb: Math.round(freeRam * 10) / 10,
                        tasks_completed: this.tasksProcessed,
                        gstd_earned: this.gstdEarned,
                        uptime_s: (Date.now() - this.startTime) / 1000,
                    }),
                });
            }
            catch (_e) { /* silent — will retry next interval */ }
        }, intervalMs);
        console.log(`[Swarm] Heartbeat started (every ${intervalMs / 1000}s)`);
    }
    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    /**
     * Process a task from the network
     */
    async processTask(task) {
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
            if (!response.ok)
                throw new Error(`Ollama: ${response.status}`);
            const data = await response.json();
            this.tasksProcessed++;
            this.gstdEarned += 0.001; // Base reward per task
            return data.message?.content || '';
        }
        catch (err) {
            throw new Error(`Failed to process task: ${err.message}`);
        }
    }
    /**
     * Get current swarm status
     */
    getStatus() {
        return {
            connected: this.connected,
            nodeId: this.nodeId,
            uptime: (Date.now() - this.startTime) / 1000,
            tasksProcessed: this.tasksProcessed,
            gstdEarned: this.gstdEarned,
            currentLoad: os_1.default.loadavg()[0] || 0,
            modelsReady: [],
        };
    }
}
exports.SwarmClient = SwarmClient;
//# sourceMappingURL=client.js.map