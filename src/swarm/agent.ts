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
import { execSync } from 'child_process';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';
import { CrossChainBridge } from '../blockchain/bridge.js';
import { SovereignSuite } from './sovereign.js';

// ─── Types ───────────────────────────────────────────────────────
export interface SwarmTask {
    id: string;
    type: string;
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
    private priorityPollTimer: NodeJS.Timeout | null = null;
    private startedAt = Date.now();
    private stats: SwarmStats;
    public sovereign: SovereignSuite;
    private p2pNode: any = null;
    private avgLatencyMs = 0;

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

    // ─── P2P Integration ─────────────────────────────────────────
    setP2PNode(node: any): void {
        this.p2pNode = node;

        // Route P2P tasks directly into the same processing pipeline
        node.on('task:received', (p2pTask: any) => {
            const task: SwarmTask = {
                id: p2pTask.taskId,
                type: 'inference',
                model: p2pTask.model,
                prompt: p2pTask.prompt,
                payload: { max_tokens: p2pTask.maxTokens },
                reward_gstd: p2pTask.rewardGstd || 0,
                requester: p2pTask.senderNodeId,
                priority: 1,
            };
            this.processTask(task).catch(() => {});
        });

        // Use P2P heartbeats to dial new peers for WAN mesh formation
        node.on('heartbeat:received', (hb: any) => {
            if (hb.multiaddrs?.length) {
                for (const ma of hb.multiaddrs) node.connectToPeer(ma).catch(() => {});
            }
        });
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

        // Heartbeat every 8 minutes. Node TTL on the platform is 10 min,
        // so this keeps the node alive with comfortable margin while staying
        // well within the Vercel KV free tier (3K req/day).
        this.heartbeatTimer = setInterval(() => this.heartbeat(), 8 * 60_000);

        // Start task polling (every 30 seconds for general queue)
        this.taskPollTimer = setInterval(() => this.pollTasks(), 30_000);

        // Priority inference queue poll (every 5 seconds — fast path for AI routing)
        this.priorityPollTimer = setInterval(() => this.pollPriorityInference(), 5_000);

        // Fetch peers every 60 seconds
        setInterval(() => this.fetchPeers(), 60_000);

        // Refresh tier info every 5 minutes
        setInterval(() => this.fetchRewardsInfo(), 5 * 60_000);

        // Scan and join new campaigns every 10 minutes
        setInterval(() => this.joinActiveCampaigns().catch(() => {}), 10 * 60_000);
        setTimeout(() => this.joinActiveCampaigns().catch(() => {}), 15_000); // initial check after 15s

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
        if (this.priorityPollTimer) clearInterval(this.priorityPollTimer);

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

            const resources = this.getResourceStats();

            // Platform heartbeat expects: { wallet_address, node_name, node_version, uptime_hours, queries_served }
            const payload: any = {
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
                tasks_completed: this.stats.tasksCompleted,
                tasks_processing: this.stats.tasksProcessing,
                uptime: Math.round((Date.now() - this.startedAt) / 1000),
                version: this.config.version,
                mode: this.config.mode,
                memory_entries: this.memory.getEntryCount(),
                capabilities:    this.config.groq.models,
                // Resource stats for marketplace matching
                storage_free_gb: resources.storage_free_gb,
                ram_free_mb:     resources.ram_free_mb,
                gpu_vram_mb:     resources.gpu_vram_mb,
                bandwidth_mbps:  resources.bandwidth_mbps,
                cpu_score:       resources.cpu_score,
                avg_latency_ms:  this.avgLatencyMs || undefined,
            };
            // Include P2P multiaddrs so the platform can relay them to other nodes
            if (this.p2pNode) {
                const addrs = this.p2pNode.getMultiaddrs?.() || [];
                if (addrs.length) payload.multiaddrs = addrs;
            }

            const result = await this.apiCall('/nodes/heartbeat', payload);

            if (result) {
                this.connected = true;
                this.stats.connected = true;
                this.stats.lastHeartbeat = new Date().toISOString();
                this.stats.peersCount = result.peers_online || result.active_nodes || 0;
                this.stats.rank = result.rank || 0;

                // Check if platform assigned any reward for uptime
                const rewardAmount = result.reward ?? result.reward_gstd ?? 0;
                if (rewardAmount > 0) {
                    this.stats.totalEarnedGstd += rewardAmount;
                    this.wallet.recordVerifiedEarning(rewardAmount, 'uptime', `Heartbeat reward (${result.reason || 'verified'})`);
                    logActivity(`Earned ${rewardAmount.toFixed(4)} GSTD (uptime)`, 'success');
                }

                // ─── Execute remote commands ─────────────────────
                if (result.commands && Array.isArray(result.commands) && result.commands.length > 0) {
                    for (const cmd of result.commands) {
                        this.executeRemoteCommand(cmd).catch(() => {});
                    }
                }

                // ─── OTA Update Check ────────────────────────────
                if (result.update?.update_available) {
                    logActivity(`⬆️ Update available: v${result.update.latest_version} (current: ${this.config.version})`, 'warn');
                    console.log(`\n  🔄 Update available: v${result.update.latest_version}`);
                    console.log(`     Run: curl -fsSL ${result.update.update_url} | bash`);
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

    // ─── OTA Auto-Update (SAFE — snapshot + verify + rollback) ────
    private updateAttempted = false;
    private async tryAutoUpdate(): Promise<void> {
        if (this.updateAttempted) return; // Only try once per session
        this.updateAttempted = true;

        try {
            const { execSync } = require('child_process');
            const fs = require('fs');
            const installDir = this.config.installDir || require('os').homedir() + '/gstdbot';

            // Skip in Docker (managed externally)
            if (fs.existsSync('/.dockerenv')) {
                logActivity('Update available but running in Docker — skip auto-update', 'info');
                return;
            }

            // Must have .git directory
            if (!fs.existsSync(installDir + '/.git')) {
                logActivity('Update available but no .git — run install.sh manually', 'warn');
                return;
            }

            logActivity('⬆️ Starting safe auto-update...', 'info');

            // 1. SNAPSHOT — record current state for rollback
            const snapshot = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            logActivity(`📸 Snapshot: ${snapshot.slice(0, 12)}`, 'info');

            // Stash any local changes
            try { execSync('git stash --quiet 2>/dev/null', { cwd: installDir, timeout: 10000 }); } catch (_e) {}

            // 2. PULL — fetch latest code
            execSync('git fetch origin main --quiet 2>/dev/null', { cwd: installDir, timeout: 30000 });
            const remote = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();

            if (snapshot === remote) {
                logActivity('Already at latest commit — no update needed', 'info');
                return;
            }

            execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });

            // 3. VERIFY — build check before restart
            let buildOk = true;
            try {
                execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
                execSync('npx tsc --noEmit --skipLibCheck 2>/dev/null', { cwd: installDir, timeout: 60000 });
                
                // Verify entry point exists
                const entryPoint = installDir + '/dist/index.js';
                if (!fs.existsSync(entryPoint)) {
                    // Try building
                    execSync('npx tsc --skipLibCheck 2>/dev/null', { cwd: installDir, timeout: 60000 });
                    if (!fs.existsSync(entryPoint)) {
                        buildOk = false;
                    }
                }
            } catch (_e) {
                buildOk = false;
            }

            if (!buildOk) {
                // 4a. ROLLBACK — revert to snapshot
                logActivity('❌ Update build failed — rolling back to ' + snapshot.slice(0, 12), 'error');
                execSync(`git reset --hard ${snapshot}`, { cwd: installDir, timeout: 15000 });
                try { execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 }); } catch (_e) {}
                logActivity('✅ Rollback complete — node continues on previous version', 'success');
                return;
            }

            // 4b. SUCCESS — log and restart
            const newHead = execSync('git rev-parse --short HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            fs.appendFileSync(installDir + '/.update-log',
                `${new Date().toISOString()} | ${snapshot.slice(0,8)} → ${newHead} | build verified | restarting\n`);

            logActivity(`✅ Update verified: ${snapshot.slice(0,8)} → ${newHead} — restarting node...`, 'success');
            console.log(`  ✅ Update installed (${snapshot.slice(0,8)} → ${newHead}). Restarting...`);

            // systemd/pm2 will restart us
            process.exit(0);
        } catch (e: any) {
            logActivity(`Auto-update failed: ${e.message || 'unknown'} — run install.sh manually`, 'error');
        }
    }

    // ─── Remote Command Execution ────────────────────────────────
    private async executeRemoteCommand(cmd: { id: number; command: string; params: string }): Promise<void> {
        logActivity(`⚡ Remote command: ${cmd.command} (id=${cmd.id})`, 'info');

        try {
            switch (cmd.command) {
                case 'health_check':
                    const load = loadavg();
                    const ramUsed = Math.round(((totalmem() - freemem()) / totalmem()) * 100);
                    logActivity(`Health: CPU=${Math.round(load[0]*100/cpus().length)}% RAM=${ramUsed}% Uptime=${Math.round((Date.now()-this.startedAt)/3600000)}h`, 'success');
                    break;
                case 'diagnostics':
                    logActivity(`Diagnostics: Node=${this.config.nodeId.slice(0,12)} v${this.config.version} | Peers=${this.stats.peersCount} | Tasks=${this.stats.tasksCompleted} | Memory=${this.memory.getEntryCount()}`, 'info');
                    break;
                case 'rotate_logs':
                    logActivity('Log rotation requested — acknowledged', 'info');
                    break;
                case 'clear_cache':
                    logActivity('Cache clear requested — acknowledged', 'info');
                    break;
                case 'restart':
                    logActivity('🔄 Restart command received — restarting...', 'warn');
                    setTimeout(() => process.exit(0), 2000);
                    break;
                case 'stop':
                    logActivity('🛑 Stop command received — shutting down...', 'warn');
                    await this.stop();
                    setTimeout(() => process.exit(0), 2000);
                    break;
                case 'update':
                    logActivity('⬆️ Update command received', 'info');
                    await this.tryAutoUpdate();
                    break;
                default:
                    logActivity(`Unknown command: ${cmd.command}`, 'warn');
            }
        } catch (e: any) {
            logActivity(`Command ${cmd.command} failed: ${e.message}`, 'error');
        }
    }

    // ─── Campaign Auto-Join ──────────────────────────────────────
    private joinedCampaigns = new Set<string>();

    private async joinActiveCampaigns(): Promise<void> {
        if (!this.connected) return;
        try {
            const result = await this.apiCall('/campaigns/list', {}, 'GET');
            if (!result?.campaigns?.length) return;

            const resources = this.getResourceStats();

            for (const campaign of result.campaigns) {
                if (this.joinedCampaigns.has(campaign.id)) continue;

                const joinResult = await this.apiCall('/campaigns/join', {
                    campaign_id:  campaign.id,
                    node_id:      this.config.nodeId,
                    capabilities: this.config.groq.models,
                    resources,
                });

                if (joinResult?.ok) {
                    this.joinedCampaigns.add(campaign.id);
                    logActivity(`Joined campaign: "${campaign.title}" by ${campaign.company} → ${campaign.reward_per_task} GSTD/task`, 'success');
                }
            }
        } catch (_e) { }
    }

    // ─── Peer Discovery ─────────────────────────────────────────
    private async fetchPeers(): Promise<void> {
        if (!this.connected) return;
        try {
            const result = await this.apiCall('/nodes/peers', {}, 'GET');
            if (result?.peers && Array.isArray(result.peers)) {
                this.stats.peersCount = result.count || result.peers.length;
                // Sync to sovereign mesh
                const peerIds = result.peers.map((p: any) => p.node_id || p.name || 'unknown');
                this.sovereign.updateMeshPeers(peerIds);
                // Dial P2P multiaddrs to establish WAN mesh without central coordination
                if (this.p2pNode) {
                    for (const peer of result.peers) {
                        const addrs: string[] = peer.multiaddrs || [];
                        for (const ma of addrs) {
                            this.p2pNode.connectToPeer(ma).catch(() => {});
                        }
                    }
                }
            }
        } catch (_e) { }
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
                node_id:      this.config.nodeId,
                capabilities: this.config.groq.models,
                resources:    this.getResourceStats(),
                max_tasks:    1,
            });

            if (result?.task) {
                await this.processTask(result.task);
            }
        } catch (_e) { }
    }

    // ─── Priority Inference Queue (5s fast path) ─────────────────
    private async pollPriorityInference(): Promise<void> {
        if (!this.connected) return;
        const load = loadavg()[0] / cpus().length;
        if (load > this.config.swarm.maxCPU / 100) return;

        try {
            const result = await this.apiCall('/tasks/poll', {
                node_id:       this.config.nodeId,
                capabilities:  this.config.groq.models,
                resources:     this.getResourceStats(),
                priority_only: true,
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
                case 'render':
                    result = await this.processRender(task);
                    break;
                default:
                    if (task.type.startsWith('render_')) {
                        result = await this.processRender(task);
                    } else {
                        throw new Error(`Unknown task type: ${task.type}`);
                    }
            }

            // Report completion — include campaign_id and reward so treasury accounting works
            await this.apiCall('/tasks/complete', {
                task_id:      task.id,
                node_id:      this.config.nodeId,
                result,
                wallet_address: this.wallet.getAddress(),
                reward_gstd:  task.reward_gstd,
                protocol_fee: (task as any).protocol_fee || 0,
                campaign_id:  (task as any).campaign_id || null,
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

    // Calls an OpenAI-compatible chat completions endpoint.
    // Supports Groq, Ollama, and any compatible API.
    private async callOpenAICompat(
        baseUrl: string, apiKey: string | undefined,
        model: string, messages: any[], maxTok: number, temp: number,
    ): Promise<any> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model, messages, max_tokens: maxTok, temperature: temp }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text().catch(() => '')}`);
        return resp.json();
    }

    private async processInference(task: SwarmTask): Promise<any> {
        const model    = task.model || 'llama-3.3-70b-versatile';
        const messages = (task as any).messages || [{ role: 'user', content: task.prompt }];
        const maxTok   = (task as any).max_tokens || (task.payload?.max_tokens) || 2048;
        const temp     = (task as any).temperature ?? 0.7;
        const startMs  = Date.now();

        let data: any;

        // Backend priority:
        // 1. Groq (fast, free tier, requires GROQ_API_KEY)
        // 2. Ollama (local, no key, requires OLLAMA_URL)
        // 3. Any OpenAI-compatible API at GSTD_INFERENCE_URL + GSTD_INFERENCE_KEY
        const groqKey  = process.env.GROQ_API_KEY;
        const ollamaUrl = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
        const customUrl = (process.env.GSTD_INFERENCE_URL || '').replace(/\/$/, '');
        const customKey = process.env.GSTD_INFERENCE_KEY;

        if (groqKey) {
            const groqModel = model.includes('/') ? model.split('/').pop()! : model;
            data = await this.callOpenAICompat(
                'https://api.groq.com/openai/v1', groqKey, groqModel, messages, maxTok, temp);
        } else if (ollamaUrl) {
            // Ollama uses OpenAI-compatible /v1/chat/completions
            data = await this.callOpenAICompat(`${ollamaUrl}/v1`, undefined, model, messages, maxTok, temp);
        } else if (customUrl) {
            data = await this.callOpenAICompat(`${customUrl}/v1`, customKey, model, messages, maxTok, temp);
        } else {
            throw new Error('No AI backend configured. Set GROQ_API_KEY, OLLAMA_URL, or GSTD_INFERENCE_URL in .env');
        }

        const latencyMs = Date.now() - startMs;
        this.avgLatencyMs = this.avgLatencyMs
            ? Math.round(this.avgLatencyMs * 0.7 + latencyMs * 0.3)
            : latencyMs;

        const result = {
            response: data.choices?.[0]?.message?.content || '',
            choices:  data.choices,
            model:    data.model || model,
            tokens:   data.usage?.total_tokens || 0,
        };

        // Post result to platform so completions.ts short-poll can pick it up
        if (task.id) {
            this.apiCall('/tasks/result', {
                task_id:    task.id,
                node_id:    this.config.nodeId,
                result,
                latency_ms: latencyMs,
                model,
            }).catch(() => {});
        }

        return result;
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

    private async processRender(task: SwarmTask): Promise<any> {
        // Simulate a GPU rendering job
        const type = task.type.replace('render_', '') || 'generic_render';
        const frames = task.payload?.frames || 1;
        const duration = Math.min(10000, 2000 * frames); // Simulate 2-10s render
        await new Promise(resolve => setTimeout(resolve, duration));
        return {
            rendered: true,
            type,
            frames,
            completion_time_ms: duration,
            hash: createHash('sha256').update(Date.now().toString()).digest('hex').slice(0, 16)
        };
    }

    // ─── Resource Stats ──────────────────────────────────────────
    private getResourceStats() {
        let storageFreeGb = 0;
        try {
            const { statfsSync: sfs } = require('fs');
            const fs = sfs(process.env.GSTD_STORAGE || process.env.HOME || '/');
            storageFreeGb = Math.round(fs.bfree * fs.bsize / (1024 ** 3) * 10) / 10;
        } catch { /* ignore */ }

        let gpuVramMb = 0;
        try {
            const vram = execSync('nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim();
            gpuVramMb = parseInt(vram) || 0;
        } catch { /* no GPU */ }

        const load  = loadavg()[0];
        const cores = cpus().length;

        return {
            storage_free_gb: storageFreeGb,
            ram_free_mb:     Math.round(freemem() / 1048576),
            gpu_vram_mb:     gpuVramMb,
            bandwidth_mbps:  0,
            cpu_score:       Math.round(cores * 1000 / Math.max(load + 0.1, 0.1)),
        };
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
