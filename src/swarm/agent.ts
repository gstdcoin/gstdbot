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

import { cpus, totalmem, freemem, hostname, platform, arch, loadavg } from 'os';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';

// ─── Types ───────────────────────────────────────────────────────
export interface SwarmTask {
    id: string;
    type: 'inference' | 'embedding' | 'verification' | 'storage';
    model?: string;
    prompt?: string;
    payload?: any;
    reward_gstd: number;
    requester: string;
    deadline?: string;
    priority: number;
}

export interface SwarmStats {
    connected: boolean;
    nodeId: string;
    peersCount: number;
    tasksCompleted: number;
    tasksProcessing: number;
    tasksFailed: number;
    totalEarnedGstd: number;
    uptimeSeconds: number;
    lastHeartbeat: string | null;
    rank: number;
}

interface NodeCapabilities {
    node_id: string;
    node_name: string;
    platform: string;
    arch: string;
    cpu_cores: number;
    cpu_model: string;
    ram_total_mb: number;
    ram_free_mb: number;
    gpu: string | null;
    models: string[];
    max_cpu: number;
    max_ram: number;
    mode: string;
    version: string;
}

// ─── Swarm Agent ─────────────────────────────────────────────────
export class SwarmAgent {
    private config: NodeConfig;
    private wallet: NodeWallet;
    private memory: CollectiveMemory;
    private connected = false;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private taskPollTimer: NodeJS.Timeout | null = null;
    private startedAt = Date.now();
    private stats: SwarmStats;

    constructor(config: NodeConfig, wallet: NodeWallet, memory: CollectiveMemory) {
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

    async start(): Promise<void> {
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
        logActivity('Joined swarm network', 'success');
    }

    async stop(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.taskPollTimer) clearInterval(this.taskPollTimer);

        // Deregister from swarm
        try {
            await this.apiCall('/nodes/deregister', {
                node_id: this.config.nodeId,
            });
        } catch { }

        this.connected = false;
        logActivity('Left swarm network', 'warn');
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStats(): SwarmStats {
        this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        return { ...this.stats };
    }

    // ─── Registration ────────────────────────────────────────────
    private async register(): Promise<void> {
        try {
            const caps = this.getCapabilities();
            const result = await this.apiCall('/nodes/register', caps);

            if (result?.nodeId || result?.node_id || result?.ok) {
                this.connected = true;
                this.stats.connected = true;
                logActivity(`Registered with swarm (ID: ${this.config.nodeId.slice(0, 12)}...)`, 'success');
            } else {
                logActivity('Swarm registration pending — will retry on heartbeat', 'warn');
            }
        } catch (e: any) {
            logActivity('Swarm registration error: ' + (e.message || 'network'), 'error');
        }
    }

    // ─── Heartbeat ───────────────────────────────────────────────
    private async heartbeat(): Promise<void> {
        try {
            const load = loadavg();
            const ramUsage = Math.round(((totalmem() - freemem()) / totalmem()) * 100);
            const walletAddr = this.wallet.getAddress();

            const payload = {
                node_id: this.config.nodeId,
                node_name: this.config.nodeName,
                status: 'online',
                cpu_usage: Math.round(load[0] * 100 / cpus().length),
                ram_usage: ramUsage,
                ram_free_mb: Math.round(freemem() / 1048576),
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
                    logActivity(`Earned ${result.reward_gstd.toFixed(4)} GSTD (uptime)`, 'success');
                }
            }
        } catch {
            if (this.connected) {
                this.connected = false;
                this.stats.connected = false;
                logActivity('Heartbeat failed — connection lost', 'error');
            }
        }
    }

    // ─── Task Processing ─────────────────────────────────────────
    private async pollTasks(): Promise<void> {
        if (!this.connected) return;

        // Don't accept new tasks if resources are overloaded
        const load = loadavg()[0] / cpus().length;
        if (load > this.config.swarm.maxCPU / 100) return;

        const ramUsage = ((totalmem() - freemem()) / totalmem()) * 100;
        if (ramUsage > this.config.swarm.maxRAM) return;

        try {
            const result = await this.apiCall('/tasks/poll', {
                node_id: this.config.nodeId,
                capabilities: this.getCapabilities(),
                max_tasks: 1,
            });

            if (result?.task) {
                await this.processTask(result.task);
            }
        } catch { }
    }

    private async processTask(task: SwarmTask): Promise<void> {
        this.stats.tasksProcessing++;
        logActivity(`Processing task: ${task.type} (${task.id.slice(0, 8)}...) reward: ${task.reward_gstd} GSTD`, 'info');

        try {
            let result: any = null;

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
            logActivity(`Task ${task.id.slice(0, 8)} completed → +${task.reward_gstd} GSTD`, 'success');

            // Save to collective memory if inference
            if (task.type === 'inference' && task.prompt && result?.response) {
                await this.memory.store(task.prompt, result.response, task.model || 'unknown', 0.8);
            }

        } catch (e: any) {
            this.stats.tasksFailed++;
            logActivity(`Task ${task.id.slice(0, 8)} failed: ${e.message}`, 'error');

            await this.apiCall('/tasks/fail', {
                task_id: task.id,
                node_id: this.config.nodeId,
                error: e.message,
            }).catch(() => { });
        } finally {
            this.stats.tasksProcessing--;
        }
    }

    // ─── Task Processors ─────────────────────────────────────────
    private async processInference(task: SwarmTask): Promise<any> {
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

        if (!resp.ok) throw new Error(`Groq API error: ${resp.status}`);
        const data: any = await resp.json();
        return {
            response: data.choices?.[0]?.message?.content || '',
            model,
            tokens: data.usage?.total_tokens || 0,
        };
    }

    private async processEmbedding(task: SwarmTask): Promise<any> {
        // Store content in collective memory for embedding
        const text = task.payload?.text || task.prompt || '';
        await this.memory.store(`emb:${task.id}`, text, 'embedding', 1.0);
        return { stored: true, length: text.length };
    }

    private async processVerification(task: SwarmTask): Promise<any> {
        // Verify an existing answer by re-querying
        const cached = await this.memory.recall(task.prompt || '');
        return {
            verified: !!cached,
            confidence: cached?.confidence || 0,
            matches: cached?.answer === task.payload?.expected_answer,
        };
    }

    private async processStorage(task: SwarmTask): Promise<any> {
        // Store data in local memory
        const key = task.payload?.key || task.id;
        const value = task.payload?.value || '';
        await this.memory.store(key, value, 'storage', 1.0);
        return { stored: true, key };
    }

    // ─── Helpers ─────────────────────────────────────────────────
    private getCapabilities(): NodeCapabilities {
        const cpuInfo = cpus();
        let gpu: string | null = null;
        try {
            const { execSync } = require('child_process');
            gpu = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim() || null;
        } catch { }

        return {
            node_id: this.config.nodeId,
            node_name: this.config.nodeName,
            platform: platform(),
            arch: arch(),
            cpu_cores: cpuInfo.length,
            cpu_model: cpuInfo[0]?.model || 'Unknown',
            ram_total_mb: Math.round(totalmem() / 1048576),
            ram_free_mb: Math.round(freemem() / 1048576),
            gpu,
            models: this.config.groq.models,
            max_cpu: this.config.swarm.maxCPU,
            max_ram: this.config.swarm.maxRAM,
            mode: this.config.mode,
            version: this.config.version,
        };
    }

    private async apiCall(endpoint: string, data: any): Promise<any> {
        const url = this.config.swarm.apiUrl + endpoint;
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(10_000),
            });
            if (resp.ok) return await resp.json().catch(() => ({ ok: true }));
            return null;
        } catch {
            return null;
        }
    }
}
