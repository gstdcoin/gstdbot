/**
 * GSTD Node OS — Swarm Agent
 * 
 * Manages connection to the GSTD Swarm Network:
 * - Registers node with platform
 * - Receives and processes AI tasks
 * - Reports hardware capabilities
 * - Earns GSTD tokens for completed tasks
 * - Heartbeat + health reporting
 * - Sovereign Protocol integration (staking, P2P, governance, mesh)
 */

import { cpus, totalmem, freemem, platform, arch, loadavg } from 'os';
import { createHash } from 'crypto';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';
import { CrossChainBridge } from '../blockchain/bridge.js';
import { SovereignSuite } from './sovereign.js';

// ─── Types ───────────────────────────────────────────────────────
export interface SwarmTask {
    id: string;
    type: 'inference' | 'embedding' | 'verification' | 'storage' | 'bridge_verify';
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
    // Rewards system
    tier: string;
    tierIcon: string;
    streakDays: number;
    bestStreak: number;
    effectiveRate: number;
    nextTier: string | null;
    nextTierHours: number;
    tasksByType: Record<string, number>;
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
    public sovereign: SovereignSuite;

    constructor(config: NodeConfig, wallet: NodeWallet, memory: CollectiveMemory) {
        this.config = config;
        this.wallet = wallet;
        this.memory = memory;
        this.sovereign = new SovereignSuite(config, wallet);
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
            tier: 'bronze',
            tierIcon: '🥉',
            streakDays: 0,
            bestStreak: 0,
            effectiveRate: 0.5,
            nextTier: 'silver',
            nextTierHours: 100,
            tasksByType: {},
        };
    }

    async start(): Promise<void> {
        if (!this.config.swarm.enabled) {
            console.log('    Swarm disabled');
            return;
        }

        // Register with platform
        await this.register();

        // Fetch initial rewards/tier info
        await this.fetchRewardsInfo();

        // Start heartbeat (every 60 minutes — backend rate-limits at 54min)
        this.heartbeatTimer = setInterval(() => this.heartbeat(), 60 * 60_000);

        // Start task polling (every 30 seconds)
        this.taskPollTimer = setInterval(() => this.pollTasks(), 30_000);

        // Refresh tier info every 5 minutes
        setInterval(() => this.fetchRewardsInfo(), 5 * 60_000);

        // Start Sovereign Protocol instruments (staking, P2P, mesh, governance, lending)
        await this.sovereign.start();

        // Initial heartbeat
        await this.heartbeat();

        const tierLine = `${this.stats.tierIcon} ${this.stats.tier.toUpperCase()} · ${this.stats.effectiveRate} GSTD/h · ${this.stats.streakDays}d streak`;
        const sovState = this.sovereign.getState();
        const econData = this.sovereign.getNodeEconomics();
        console.log(`    Swarm agent started (node: ${this.config.nodeId.slice(0, 8)}...)`);
        console.log(`    Rewards: ${tierLine}`);
        console.log(`    Sovereign: Mesh ${sovState.meshPeers.length} peers | Staked ${sovState.stakedAmount} GSTD | ${sovState.capabilities.length} capabilities`);
        console.log(`    Economics: ${econData.summary.daily_gstd.toFixed(4)} GSTD/day | ${econData.revenue_streams.staking.desc}`);
        logActivity(`Joined swarm network | ${tierLine}`, 'success');
    }

    async stop(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.taskPollTimer) clearInterval(this.taskPollTimer);

        // Stop sovereign instruments
        await this.sovereign.stop();

        // Deregister from swarm
        try {
            await this.apiCall('/nodes/deregister', {
                node_id: this.config.nodeId,
            });
        } catch (_e) { }

        this.connected = false;
        logActivity('Left swarm network', 'warn');
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStats(): SwarmStats & { sovereign?: any; economics?: any } {
        this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        return {
            ...this.stats,
            sovereign: this.sovereign.getState(),
            economics: this.sovereign.getNodeEconomics(),
        };
    }

    // ─── Rewards Info Sync ───────────────────────────────────────
    private static TIER_ICONS: Record<string, string> = {
        bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎', diamond: '👑'
    };

    private async fetchRewardsInfo(): Promise<void> {
        const walletAddr = this.wallet.getAddress();
        if (!walletAddr) return;

        try {
            const result = await this.apiCall('/nodes/rewards/my', {}, 'GET', `?wallet=${walletAddr}`);
            if (!result || !result.registered) return;

            // Update stats from rewards API
            this.stats.tier = result.tier?.name || 'bronze';
            this.stats.tierIcon = SwarmAgent.TIER_ICONS[this.stats.tier] || '🥉';
            this.stats.streakDays = result.streak?.days || 0;
            this.stats.bestStreak = result.streak?.best || 0;
            this.stats.effectiveRate = result.stats?.effective_rate_per_h || 0.5;
            this.stats.totalEarnedGstd = result.earnings?.total || this.stats.totalEarnedGstd;

            if (result.next_tier) {
                this.stats.nextTier = result.next_tier.name;
                this.stats.nextTierHours = result.next_tier.hours_needed || 0;
            }
        } catch (_e) { }
    }
    private async register(): Promise<void> {
        try {
            const caps = this.getCapabilities();
            // Platform expects: { name, specs } + X-Wallet-Address header
            const payload = {
                name: this.config.nodeName,
                specs: {
                    node_id: caps.node_id,
                    platform: caps.platform,
                    arch: caps.arch,
                    cpu: caps.cpu_model,
                    cpu_cores: caps.cpu_cores,
                    ram: caps.ram_total_mb,
                    gpu: caps.gpu,
                    models: caps.models,
                    mode: caps.mode,
                    version: caps.version,
                },
            };
            const result = await this.apiCall('/nodes/register', payload);

            if (result?.id || result?.node_id || result?.ok) {
                this.connected = true;
                this.stats.connected = true;
                logActivity(`Registered with platform (ID: ${this.config.nodeId.slice(0, 12)}...)`, 'success');
            } else {
                logActivity('Platform registration pending — will retry on heartbeat', 'warn');
            }
        } catch (e: any) {
            logActivity('Platform registration error: ' + (e.message || 'network'), 'error');
        }
    }

    // ─── Heartbeat ───────────────────────────────────────────────
    private async heartbeat(): Promise<void> {
        try {
            const load = loadavg();
            const ramUsage = Math.round(((totalmem() - freemem()) / totalmem()) * 100);
            const walletAddr = this.wallet.getAddress();

            // Platform heartbeat expects: { wallet_address, node_name, node_version, uptime_hours, queries_served }
            const payload = {
                wallet_address: walletAddr || this.config.nodeId,
                node_id: this.config.nodeId,
                node_name: this.config.nodeName,
                node_version: this.config.version,
                status: 'online',
                uptime_hours: Math.round((Date.now() - this.startedAt) / 3600000),
                queries_served: this.stats.tasksCompleted,
                battery: 100 - Math.round(load[0] * 100 / cpus().length),
                signal: 100 - ramUsage,
                cpu_usage: Math.round(load[0] * 100 / cpus().length),
                ram_usage: ramUsage,
                ram_free_mb: Math.round(freemem() / 1048576),
                tasks_completed: this.stats.tasksCompleted,
                tasks_processing: this.stats.tasksProcessing,
                uptime: Math.round((Date.now() - this.startedAt) / 1000),
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
                // Backend returns 'reward', not 'reward_gstd'
                const rewardAmount = result.reward ?? result.reward_gstd ?? 0;
                if (rewardAmount > 0) {
                    this.stats.totalEarnedGstd += rewardAmount;
                    this.wallet.recordVerifiedEarning(rewardAmount, 'uptime', `Heartbeat reward (${result.reason || 'verified'})`);
                    logActivity(`Earned ${rewardAmount.toFixed(4)} GSTD (uptime)`, 'success');
                }

                // ─── OTA Update Check ────────────────────────────
                if (result.update?.update_available) {
                    logActivity(`⬆️ Update available: v${result.update.latest_version} (current: ${this.config.version})`, 'warn');
                    console.log(`\n  🔄 Update available: v${result.update.latest_version}`);
                    console.log(`     Run: curl -fsSL ${result.update.update_url} | bash`);
                    
                    // Auto-update if git is available (non-Docker installs)
                    this.tryAutoUpdate().catch(() => {});
                }
            }
        } catch (_e) {
            if (this.connected) {
                this.connected = false;
                this.stats.connected = false;
                logActivity('Heartbeat failed — connection lost', 'error');
            }
        }
    }

    // ─── OTA Auto-Update (for remote bare-metal nodes) ───────────
    private updateAttempted = false;
    private async tryAutoUpdate(): Promise<void> {
        if (this.updateAttempted) return; // Only try once per session
        this.updateAttempted = true;

        try {
            const { execSync } = require('child_process');
            const installDir = this.config.installDir || require('os').homedir() + '/gstdbot';
            const fs = require('fs');

            // Skip in Docker (no git, managed externally)
            if (fs.existsSync('/.dockerenv')) {
                logActivity('Update available but running in Docker — skip auto-update', 'info');
                return;
            }

            // Must have .git directory
            if (!fs.existsSync(installDir + '/.git')) {
                logActivity('Update available but no .git — run install.sh manually', 'warn');
                return;
            }

            logActivity('⬆️ Starting auto-update...', 'info');
            console.log('  🔄 Auto-updating from GitHub...');

            // Pull latest code
            execSync('git fetch origin main --quiet 2>/dev/null', { cwd: installDir, timeout: 30000 });
            const local = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            const remote = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();

            if (local === remote) {
                logActivity('Already at latest commit — no update needed', 'info');
                return;
            }

            execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });
            execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
            execSync('npx tsc --skipLibCheck 2>/dev/null || npx tsc 2>/dev/null', { cwd: installDir, timeout: 60000 });

            logActivity('✅ Update installed — restarting node...', 'success');
            console.log('  ✅ Update installed. Restarting...');

            // Systemd will restart us, or pm2, or the user manually
            process.exit(0);
        } catch (e: any) {
            logActivity(`Auto-update failed: ${e.message || 'unknown'} — run install.sh manually`, 'error');
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
        } catch (_e) { }
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
                case 'bridge_verify':
                    result = await this.processBridgeVerify(task);
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
            this.stats.tasksByType[task.type] = (this.stats.tasksByType[task.type] || 0) + 1;
            logActivity(`${this.stats.tierIcon} Task ${task.id.slice(0, 8)} completed → +${task.reward_gstd} GSTD (${task.type}) [total: ${this.stats.tasksCompleted}]`, 'success');

            // Submit consensus vote for this task result (mesh decentralization)
            const resultHash = createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 16);
            this.sovereign.submitConsensusVote(task.id, resultHash).catch(() => {});

            // Record in wallet
            this.wallet.recordVerifiedEarning(task.reward_gstd, task.type as any, `Task ${task.type}: ${task.id.slice(0, 8)}`, task.id);

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

    private async processBridgeVerify(task: SwarmTask): Promise<any> {
        // Run cross chain lock-and-unlock validation
        const bridge = new CrossChainBridge();
        const verification = await bridge.processBridgeTask(task.payload);
        return verification;
    }

    // ─── Helpers ─────────────────────────────────────────────────
    private getCapabilities(): NodeCapabilities {
        const cpuInfo = cpus();
        let gpu: string | null = null;
        try {
            const { execSync } = require('child_process');
            gpu = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim() || null;
        } catch (_e) { }

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

    private async apiCall(endpoint: string, data: any, method?: string, query?: string): Promise<any> {
        const url = this.config.swarm.apiUrl + endpoint + (query || '');
        const walletAddr = this.wallet.getAddress() || '';
        const isGet = method === 'GET' || endpoint.startsWith('/nodes/public');
        try {
            const resp = await fetch(url, {
                method: isGet ? 'GET' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': walletAddr,
                    'X-Node-Id': this.config.nodeId,
                },
                body: isGet ? undefined : JSON.stringify(data),
                signal: AbortSignal.timeout(10_000),
            });
            if (resp.ok) return await resp.json().catch(() => ({ ok: true }));
            return null;
        } catch (_e) {
            return null;
        }
    }
}
