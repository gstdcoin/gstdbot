"use strict";
/**
 * GSTD Node OS — Swarm Agent
 *
 * Manages connection to the GSTD Swarm Network:
 * - Registers node with platform
 * - Receives and processes AI tasks
 * - Reports hardware capabilities
 * - Earns GSTD tokens for completed tasks
 * - Heartbeat + health reporting
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmAgent = void 0;
const os_1 = require("os");
const server_js_1 = require("../dashboard/server.js");
// ─── Swarm Agent ─────────────────────────────────────────────────
class SwarmAgent {
    config;
    wallet;
    memory;
    connected = false;
    heartbeatTimer = null;
    taskPollTimer = null;
    startedAt = Date.now();
    stats;
    constructor(config, wallet, memory) {
        this.config = config;
        this.wallet = wallet;
        this.memory = memory;
        this.stats = {
            connected: false,
            nodeId: config.nodeId,
            peersCount: 0,
            tasksCompleted: 0,
            tasksProcessing: 0,
            tasksFailed: 0,
            totalEarnedGstd: 0,
            uptimeSeconds: 0,
            lastHeartbeat: null,
            rank: 0,
        };
    }
    async start() {
        if (!this.config.swarm.enabled) {
            console.log('    Swarm disabled');
            return;
        }
        // Register with platform
        await this.register();
        // Start heartbeat (every 30 seconds)
        this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
        // Start task polling (every 5 seconds)
        this.taskPollTimer = setInterval(() => this.pollTasks(), 5_000);
        // Initial heartbeat
        await this.heartbeat();
        console.log('    Swarm agent started (node: ' + this.config.nodeId.slice(0, 8) + '...)');
        (0, server_js_1.logActivity)('Joined swarm network', 'success');
    }
    async stop() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        if (this.taskPollTimer)
            clearInterval(this.taskPollTimer);
        // Deregister from swarm
        try {
            await this.apiCall('/nodes/deregister', {
                node_id: this.config.nodeId,
            });
        }
        catch { }
        this.connected = false;
        (0, server_js_1.logActivity)('Left swarm network', 'warn');
    }
    isConnected() {
        return this.connected;
    }
    getStats() {
        this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        return { ...this.stats };
    }
    // ─── Registration ────────────────────────────────────────────
    async register() {
        try {
            const caps = this.getCapabilities();
            const result = await this.apiCall('/nodes/register', caps);
            if (result?.nodeId || result?.node_id || result?.ok) {
                this.connected = true;
                this.stats.connected = true;
                (0, server_js_1.logActivity)(`Registered with swarm (ID: ${this.config.nodeId.slice(0, 12)}...)`, 'success');
            }
            else {
                (0, server_js_1.logActivity)('Swarm registration pending — will retry on heartbeat', 'warn');
            }
        }
        catch (e) {
            (0, server_js_1.logActivity)('Swarm registration error: ' + (e.message || 'network'), 'error');
        }
    }
    // ─── Heartbeat ───────────────────────────────────────────────
    async heartbeat() {
        try {
            const load = (0, os_1.loadavg)();
            const ramUsage = Math.round((((0, os_1.totalmem)() - (0, os_1.freemem)()) / (0, os_1.totalmem)()) * 100);
            const walletAddr = this.wallet.getAddress();
            const payload = {
                node_id: this.config.nodeId,
                node_name: this.config.nodeName,
                status: 'online',
                cpu_usage: Math.round(load[0] * 100 / (0, os_1.cpus)().length),
                ram_usage: ramUsage,
                ram_free_mb: Math.round((0, os_1.freemem)() / 1048576),
                tasks_completed: this.stats.tasksCompleted,
                tasks_processing: this.stats.tasksProcessing,
                uptime: Math.round((Date.now() - this.startedAt) / 1000),
                wallet_address: walletAddr || undefined,
                version: this.config.version,
                mode: this.config.mode,
                memory_entries: this.memory.getEntryCount(),
            };
            const result = await this.apiCall('/nodes/heartbeat', payload);
            if (result) {
                this.connected = true;
                this.stats.connected = true;
                this.stats.lastHeartbeat = new Date().toISOString();
                this.stats.peersCount = result.peers_online || result.active_nodes || 0;
                this.stats.rank = result.rank || 0;
                // Check if platform assigned any reward for uptime
                if (result.reward_gstd && result.reward_gstd > 0) {
                    this.stats.totalEarnedGstd += result.reward_gstd;
                    (0, server_js_1.logActivity)(`Earned ${result.reward_gstd.toFixed(4)} GSTD (uptime)`, 'success');
                }
            }
        }
        catch {
            if (this.connected) {
                this.connected = false;
                this.stats.connected = false;
                (0, server_js_1.logActivity)('Heartbeat failed — connection lost', 'error');
            }
        }
    }
    // ─── Task Processing ─────────────────────────────────────────
    async pollTasks() {
        if (!this.connected)
            return;
        // Don't accept new tasks if resources are overloaded
        const load = (0, os_1.loadavg)()[0] / (0, os_1.cpus)().length;
        if (load > this.config.swarm.maxCPU / 100)
            return;
        const ramUsage = (((0, os_1.totalmem)() - (0, os_1.freemem)()) / (0, os_1.totalmem)()) * 100;
        if (ramUsage > this.config.swarm.maxRAM)
            return;
        try {
            const result = await this.apiCall('/tasks/poll', {
                node_id: this.config.nodeId,
                capabilities: this.getCapabilities(),
                max_tasks: 1,
            });
            if (result?.task) {
                await this.processTask(result.task);
            }
        }
        catch { }
    }
    async processTask(task) {
        this.stats.tasksProcessing++;
        (0, server_js_1.logActivity)(`Processing task: ${task.type} (${task.id.slice(0, 8)}...) reward: ${task.reward_gstd} GSTD`, 'info');
        try {
            let result = null;
            switch (task.type) {
                case 'inference':
                    result = await this.processInference(task);
                    break;
                case 'embedding':
                    result = await this.processEmbedding(task);
                    break;
                case 'verification':
                    result = await this.processVerification(task);
                    break;
                case 'storage':
                    result = await this.processStorage(task);
                    break;
                default:
                    throw new Error(`Unknown task type: ${task.type}`);
            }
            // Report completion
            await this.apiCall('/tasks/complete', {
                task_id: task.id,
                node_id: this.config.nodeId,
                result,
                wallet_address: this.wallet.getAddress(),
            });
            this.stats.tasksCompleted++;
            this.stats.totalEarnedGstd += task.reward_gstd;
            (0, server_js_1.logActivity)(`Task ${task.id.slice(0, 8)} completed → +${task.reward_gstd} GSTD`, 'success');
            // Save to collective memory if inference
            if (task.type === 'inference' && task.prompt && result?.response) {
                await this.memory.store(task.prompt, result.response, task.model || 'unknown', 0.8);
            }
        }
        catch (e) {
            this.stats.tasksFailed++;
            (0, server_js_1.logActivity)(`Task ${task.id.slice(0, 8)} failed: ${e.message}`, 'error');
            await this.apiCall('/tasks/fail', {
                task_id: task.id,
                node_id: this.config.nodeId,
                error: e.message,
            }).catch(() => { });
        }
        finally {
            this.stats.tasksProcessing--;
        }
    }
    // ─── Task Processors ─────────────────────────────────────────
    async processInference(task) {
        // Use Groq API for inference
        const model = task.model || 'llama-3.3-70b-versatile';
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error('GROQ_API_KEY not configured');
        }
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: task.prompt }],
                max_tokens: 2048,
                temperature: 0.7,
            }),
        });
        if (!resp.ok)
            throw new Error(`Groq API error: ${resp.status}`);
        const data = await resp.json();
        return {
            response: data.choices?.[0]?.message?.content || '',
            model,
            tokens: data.usage?.total_tokens || 0,
        };
    }
    async processEmbedding(task) {
        // Store content in collective memory for embedding
        const text = task.payload?.text || task.prompt || '';
        await this.memory.store(`emb:${task.id}`, text, 'embedding', 1.0);
        return { stored: true, length: text.length };
    }
    async processVerification(task) {
        // Verify an existing answer by re-querying
        const cached = await this.memory.recall(task.prompt || '');
        return {
            verified: !!cached,
            confidence: cached?.confidence || 0,
            matches: cached?.answer === task.payload?.expected_answer,
        };
    }
    async processStorage(task) {
        // Store data in local memory
        const key = task.payload?.key || task.id;
        const value = task.payload?.value || '';
        await this.memory.store(key, value, 'storage', 1.0);
        return { stored: true, key };
    }
    // ─── Helpers ─────────────────────────────────────────────────
    getCapabilities() {
        const cpuInfo = (0, os_1.cpus)();
        let gpu = null;
        try {
            const { execSync } = require('child_process');
            gpu = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim() || null;
        }
        catch { }
        return {
            node_id: this.config.nodeId,
            node_name: this.config.nodeName,
            platform: (0, os_1.platform)(),
            arch: (0, os_1.arch)(),
            cpu_cores: cpuInfo.length,
            cpu_model: cpuInfo[0]?.model || 'Unknown',
            ram_total_mb: Math.round((0, os_1.totalmem)() / 1048576),
            ram_free_mb: Math.round((0, os_1.freemem)() / 1048576),
            gpu,
            models: this.config.groq.models,
            max_cpu: this.config.swarm.maxCPU,
            max_ram: this.config.swarm.maxRAM,
            mode: this.config.mode,
            version: this.config.version,
        };
    }
    async apiCall(endpoint, data) {
        const url = this.config.swarm.apiUrl + endpoint;
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(10_000),
            });
            if (resp.ok)
                return await resp.json().catch(() => ({ ok: true }));
            return null;
        }
        catch {
            return null;
        }
    }
}
exports.SwarmAgent = SwarmAgent;
//# sourceMappingURL=agent.js.map