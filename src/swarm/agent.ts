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

import { cpus, totalmem, freemem, platform, arch, loadavg, tmpdir } from 'os';
import { createHash } from 'crypto';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logActivity } from '../gateway/server.js';
import { platformHealth } from '../lib/platform-health.js';
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';
import { CrossChainBridge } from '../blockchain/bridge.js';
import type { AttestorIdentity } from '../p2p/identity.js';
import type { PeerManager } from '../p2p/peers.js';
import { hashResult, signAttestation, taskIdToUint64 } from '../p2p/attestation.js';
import { awaitQuorum } from '../p2p/quorum-coordinator.js';
import { Address } from '@ton/core';

const PENDING_SETTLEMENTS_FILE = join(process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot', 'pending-settlements.json');
const PENDING_TASK_REPORTS_FILE = join(process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot', 'pending-task-reports.json');

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
    // Quorum attestation
    quorumProofsSubmitted: number;
    quorumProofsPending: number;
    quorumAttestationsTotal: number;
    quorumGateFailed: number;
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
    private heartbeatRetryTimer: NodeJS.Timeout | null = null;
    private taskPollTimer: NodeJS.Timeout | null = null;
    private priorityPollTimer: NodeJS.Timeout | null = null;
    private startedAt = Date.now();
    private stats: SwarmStats;
    private p2pNode: any = null;
    private avgLatencyMs = 0;
    private trainingCapable = false;
    private identity: AttestorIdentity | null = null;
    private peerManager: PeerManager | null = null;

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
            tier: 'bronze',
            tierIcon: '🥉',
            streakDays: 0,
            bestStreak: 0,
            effectiveRate: 0.5,
            nextTier: 'silver',
            nextTierHours: 100,
            tasksByType: {},
            quorumProofsSubmitted: 0,
            quorumProofsPending: 0,
            quorumAttestationsTotal: 0,
            quorumGateFailed: 0,
        };
    }

    // ─── P2P Integration ─────────────────────────────────────────
    setIdentity(identity: AttestorIdentity): void { this.identity = identity; }
    setPeerManager(pm: PeerManager | null): void { this.peerManager = pm; }

    private canAttemptQuorum(): boolean {
        if (!this.p2pNode) return false;
        if (!this.identity) return false;
        const peers = (this.p2pNode.getPeers() as any[])
            .map((p: any) => p.nodeId)
            .filter((id: string) => id && id !== this.config.nodeId);
        return peers.length >= 2;
    }

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

            // If this task carries co-executors, it's a redundant-execution
            // quorum request (see docs/P2P_SETTLEMENT_RFC.md §3) — compute
            // and cross-sign, but don't report it to the platform as our own
            // completed task (it isn't; the sender owns that task's actual
            // platform assignment and reward). Plain relayed tasks (no
            // coExecutors) keep the original behavior unchanged.
            if (Array.isArray(p2pTask.coExecutors) && p2pTask.coExecutors.length > 0) {
                this.participateInQuorumVerification(task, p2pTask.coExecutors, p2pTask.quorumThreshold || 2).catch(() => {});
            } else {
                this.processTask(task).catch(() => {});
            }
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

        // Gate the 'finetune' capability on a real, verified Python training
        // environment -- a node must not advertise it can train unless it
        // actually can. This is what tasks/poll.ts's nodeCanHandle() checks
        // against (it requires 'finetune' literally present in this array).
        this.trainingCapable = await this.checkTrainingCapable();
        if (this.trainingCapable && !this.config.models.available.includes('finetune')) {
            this.config.models.available.push('finetune');
            console.log('    🎓 Fine-tuning capability verified — advertising "finetune"');
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

        // Retry quorum settlements that couldn't reach the platform when
        // first computed (e.g. during an outage) — every 2 minutes
        setInterval(() => this.retryPendingSettlements().catch(() => {}), 2 * 60_000);

        // Retry task-completion reports that couldn't reach the platform —
        // this is what makes a real reward actually get counted after an
        // outage, instead of the work being done for nothing
        setInterval(() => this.retryPendingTaskReports().catch(() => {}), 2 * 60_000);
        setTimeout(() => this.joinActiveCampaigns().catch(() => {}), 15_000); // initial check after 15s

        // Initial heartbeat
        await this.heartbeat();

        const tierLine = `${this.stats.tierIcon} ${this.stats.tier.toUpperCase()} · ${this.stats.effectiveRate} GSTD/h · ${this.stats.streakDays}d streak`;
        console.log(`    Swarm agent started (node: ${this.config.nodeId.slice(0, 8)}...)`);
        console.log(`    Rewards: ${tierLine}`);
        logActivity(`Joined swarm network | ${tierLine}`, 'success');
    }

    async stop(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
        if (this.taskPollTimer) clearInterval(this.taskPollTimer);
        if (this.priorityPollTimer) clearInterval(this.priorityPollTimer);

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

    getStats(): SwarmStats {
        this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        this.stats.quorumProofsPending = this.loadPendingSettlements().length;
        return { ...this.stats };
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
                battery: 100 - Math.round(load[0] * 100 / cpus().length),
                signal: 100 - ramUsage,
                cpu_usage: Math.round(load[0] * 100 / cpus().length),
                ram_usage: ramUsage,
                // tasks_completed intentionally omitted — PlatformLink owns this field
                // (reads persistent oracle_log.jsonl; SwarmAgent counter resets on restart)
                tasks_processing: this.stats.tasksProcessing,
                uptime: Math.round((Date.now() - this.startedAt) / 1000),
                version: this.config.version,
                mode: this.config.mode,
                memory_entries: this.memory.getEntryCount(),
                capabilities:    this.config.models.available,
                // Resource stats for marketplace matching
                storage_free_gb: resources.storage_free_gb,
                ram_free_mb:     resources.ram_free_mb,
                gpu_vram_mb:     resources.gpu_vram_mb,
                bandwidth_mbps:  resources.bandwidth_mbps,
                cpu_score:       resources.cpu_score,
                avg_latency_ms:  this.avgLatencyMs || undefined,
            };
            // Include node_url (Cloudflare tunnel) for locality-aware routing
            const tunnelUrl = (() => {
                try { return readFileSync('/tmp/gstd_tunnel_url.txt', 'utf8').trim(); } catch { return ''; }
            })() || process.env.GSTD_PUBLIC_URL || '';
            if (tunnelUrl) {
                payload.node_url  = tunnelUrl;
                // models_loaded: currently available Ollama models for locality scoring
                payload.models_loaded = this.config.models.available;
            }
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
            // Platform node TTL is 10 min; the main timer only fires every 8 min,
            // so one failed heartbeat leaves no margin before the node's KV record
            // expires. Retry quickly instead of waiting for the next full cycle.
            if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
            this.heartbeatRetryTimer = setTimeout(() => this.heartbeat(), 60_000);
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

            // Only reset if local HEAD is genuinely behind origin/main (an ancestor of
            // it) -- otherwise local has commits origin doesn't have, and resetting
            // --hard would silently discard them.
            try {
                execSync(`git merge-base --is-ancestor ${snapshot} ${remote}`, { cwd: installDir, timeout: 5000 });
            } catch {
                logActivity(`Skipping update: origin/main (${remote.slice(0, 8)}) is not a descendant of local HEAD (${snapshot.slice(0, 8)}) -- local commits would be lost`, 'warn');
                return;
            }

            execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });

            // 3. VERIFY — build check before restart
            let buildOk = true;
            try {
                execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
                execSync('./node_modules/.bin/tsc --noEmit --skipLibCheck 2>/dev/null', { cwd: installDir, timeout: 60000 });

                // Verify entry point exists
                const entryPoint = installDir + '/dist/index.js';
                if (!fs.existsSync(entryPoint)) {
                    // Try building
                    execSync('./node_modules/.bin/tsc --skipLibCheck 2>/dev/null', { cwd: installDir, timeout: 60000 });
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
                    capabilities: this.config.models.available,
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
                capabilities: this.config.models.available,
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
                capabilities:  this.config.models.available,
                resources:     this.getResourceStats(),
                priority_only: true,
            });

            if (result?.task) {
                await this.processTask(result.task);
            }
        } catch (_e) { }
    }

    /** The actual compute dispatch, shared by processTask() and the P2P
     *  quorum co-execution path (which computes but never reports to the
     *  platform — see participateInQuorumVerification()). */
    private async computeTaskResult(task: SwarmTask): Promise<any> {
        switch (task.type) {
            case 'inference':
                return this.processInference(task);
            case 'finetune':
                return this.processFinetune(task);
            case 'embedding':
                return this.processEmbedding(task);
            case 'verification':
                return this.processVerification(task);
            case 'storage':
                return this.processStorage(task);
            case 'bridge_verify':
                return this.processBridgeVerify(task);
            case 'render':
                return this.processRender(task);
            default:
                if (task.type.startsWith('render_')) {
                    return this.processRender(task);
                }
                throw new Error(`Unknown task type: ${task.type}`);
        }
    }

    /** Originator side: fan this task out to 2 live peers for redundant
     *  execution, then race to collect a 2-of-3 cross-signed quorum for our
     *  own result. On success, queue the attestation package for the admin
     *  relay to settle on-chain (SettlementMaster.SettleTaskWithProof) —
     *  this node's own wallet cannot sign a real TON transaction itself,
     *  see src/wallet/wallet.ts's known key-derivation issue.
     *
     *  Silently no-ops (existing /tasks/complete reporting is unaffected
     *  either way) when: no P2P node, fewer than 2 live peers, quorum
     *  isn't reached within the timeout, or the platform call fails. */
    private async attemptQuorumSettlement(task: SwarmTask, taskId: string, result: any): Promise<boolean> {
        if (!this.p2pNode) return false;
        const workerAddr = this.wallet.getAddress();
        if (!workerAddr) return false;

        const peers = (this.p2pNode.getPeers() as any[])
            .map((p) => p.nodeId)
            .filter((id: string) => id && id !== this.config.nodeId);
        if (peers.length < 2) return false; // need 2 co-executors for K=3 total

        const coExecutors = peers.slice(0, 2);

        if (!this.identity) return false;
        const identity = this.identity;
        const resultHashBig = hashResult(JSON.stringify(result));
        const resultHashHex = resultHashBig.toString(16).padStart(64, '0');
        const taskIdU64 = taskIdToUint64(taskId);
        const workerAddrParsed = Address.parse(workerAddr);
        const ownSig = signAttestation(identity, taskIdU64, workerAddrParsed, resultHashBig);

        // Dispatch to co-executors so they independently compute the same
        // task and can cross-sign (fire-and-forget — awaitQuorum below
        // times out on its own if they never respond).
        for (const peerId of coExecutors) {
            this.p2pNode.sendTask(peerId, {
                taskId,
                model: task.model || 'unknown',
                prompt: task.prompt || '',
                maxTokens: (task.payload as any)?.max_tokens || 512,
                senderNodeId: this.config.nodeId,
                rewardGstd: task.reward_gstd || 0,
                coExecutors: [this.config.nodeId, ...coExecutors],
                quorumThreshold: 2,
            }).catch(() => {});
        }

        const quorumResult = await awaitQuorum(this.p2pNode, {
            taskId,
            identity,
            workerAddr,
            ownResultHash: resultHashHex,
            ownAttestation: {
                type: 'attestation',
                taskId,
                nodeId: this.config.nodeId,
                workerAddr,
                resultHash: resultHashHex,
                pubkeyHex: ownSig.pubkeyHex,
                signatureHex: ownSig.signatureHex,
            },
            coExecutorPeerIds: coExecutors,
            quorumThreshold: 2,
            timeoutMs: 8_000,
        });

        for (const coExecutorId of coExecutors) {
            this.peerManager?.recordOutcome(coExecutorId, quorumResult.accepted);
        }

        if (!quorumResult.accepted) {
            if (process.env.GSTD_P2P_DEBUG) {
                logActivity(`Quorum not reached for task ${taskId.slice(0, 8)}: ${quorumResult.reason}`, 'info');
            }
            return false;
        }

        const settlementPayload = {
            taskId,
            workerAddr,
            resultHash: resultHashHex,
            attestations: quorumResult.attestations,
            computeUnits: 1,
        };
        this.stats.quorumProofsSubmitted++;
        this.stats.quorumAttestationsTotal += quorumResult.attestations.length;
        // apiCall() swallows failures and returns null rather than throwing —
        // don't log a false "settled" success in that case; queue it locally
        // and retry instead of losing a real, cross-signed quorum result.
        const submitted = await this.apiCall('/settlement/quorum-proof', settlementPayload);
        if (submitted) {
            logActivity(`🔐 Quorum reached (${quorumResult.attestations.length} attestations) for task ${taskId.slice(0, 8)} — queued for on-chain settlement`, 'success');
        } else {
            this.queuePendingSettlement(settlementPayload);
            logActivity(`🔐 Quorum reached for task ${taskId.slice(0, 8)} but platform unreachable — saved locally, will retry`, 'info');
        }
        return true;
    }

    // ─── Pending settlement retry queue ─────────────────────────────
    // Cross-signed quorum results are expensive to produce (require 2+ peers
    // to independently compute and attest); don't drop them just because the
    // platform happened to be down at submission time.

    private loadPendingSettlements(): any[] {
        try {
            return JSON.parse(readFileSync(PENDING_SETTLEMENTS_FILE, 'utf-8'));
        } catch {
            return [];
        }
    }

    private queuePendingSettlement(payload: any): void {
        const pending = this.loadPendingSettlements();
        pending.push({ ...payload, queuedAt: Date.now() });
        try {
            writeFileSync(PENDING_SETTLEMENTS_FILE, JSON.stringify(pending, null, 2), 'utf-8');
        } catch { /* best-effort persistence */ }
    }

    private async retryPendingSettlements(): Promise<void> {
        const pending = this.loadPendingSettlements();
        if (!pending.length) return;

        const stillPending: any[] = [];
        for (const entry of pending) {
            const { queuedAt, ...payload } = entry;
            const submitted = await this.apiCall('/settlement/quorum-proof', payload);
            if (!submitted) stillPending.push(entry);
        }

        if (stillPending.length !== pending.length) {
            logActivity(`🔐 Retried pending settlements: ${pending.length - stillPending.length} succeeded, ${stillPending.length} still pending`, 'success');
        }
        try {
            writeFileSync(PENDING_SETTLEMENTS_FILE, JSON.stringify(stillPending, null, 2), 'utf-8');
        } catch { /* best-effort persistence */ }
    }

    // ─── Pending task-completion report retry queue ─────────────────
    // Same failure mode as pending settlements above, but for the core
    // /tasks/complete report: apiCall() swallows failures silently, so
    // without this a node could burn real compute during an outage and
    // never actually get paid, with no local trace that anything went wrong.

    private loadPendingTaskReports(): any[] {
        try {
            return JSON.parse(readFileSync(PENDING_TASK_REPORTS_FILE, 'utf-8'));
        } catch {
            return [];
        }
    }

    private queuePendingTaskReport(endpoint: string, payload: any, taskType: string, taskId: string): void {
        const pending = this.loadPendingTaskReports();
        pending.push({ endpoint, payload, taskType, taskId, queuedAt: Date.now() });
        try {
            writeFileSync(PENDING_TASK_REPORTS_FILE, JSON.stringify(pending, null, 2), 'utf-8');
        } catch { /* best-effort persistence */ }
    }

    private async retryPendingTaskReports(): Promise<void> {
        const pending = this.loadPendingTaskReports();
        if (!pending.length) return;

        const stillPending: any[] = [];
        for (const entry of pending) {
            const submitted = await this.apiCall(entry.endpoint, entry.payload);
            if (submitted) {
                this.recordTaskEarning({ reward_gstd: entry.payload.reward_gstd, type: entry.taskType } as SwarmTask, entry.taskId);
            } else {
                stillPending.push(entry);
            }
        }

        if (stillPending.length !== pending.length) {
            logActivity(`Retried pending task reports: ${pending.length - stillPending.length} succeeded (reward now counted), ${stillPending.length} still pending`, 'success');
        }
        try {
            writeFileSync(PENDING_TASK_REPORTS_FILE, JSON.stringify(stillPending, null, 2), 'utf-8');
        } catch { /* best-effort persistence */ }
    }

    /** Records a task's reward as verified-earned. Only ever called once the
     *  platform has actually confirmed the /tasks/complete report, whether
     *  immediately or via the retry queue above. */
    private recordTaskEarning(task: SwarmTask, taskId: string): void {
        // Tasks submitted without an explicit reward_gstd (e.g. via the
        // generic /api/v1/tasks/submit endpoint) arrive as undefined --
        // `+= undefined` would silently poison totalEarnedGstd to NaN for
        // the rest of the process's lifetime. Treat as zero instead.
        const rewardGstd = typeof task.reward_gstd === 'number' && !isNaN(task.reward_gstd) ? task.reward_gstd : 0;

        this.stats.totalEarnedGstd += rewardGstd;
        logActivity(`${this.stats.tierIcon} Task ${taskId.slice(0, 8)} confirmed by platform → +${rewardGstd} GSTD (${task.type}) [total: ${this.stats.tasksCompleted}]`, 'success');
        this.wallet.recordVerifiedEarning(rewardGstd, task.type as any, `Task ${task.type}: ${taskId.slice(0, 8)}`, taskId);
    }

    /** Co-executor side: a peer asked us to independently compute the same
     *  task for quorum verification. Compute and cross-sign via the same
     *  awaitQuorum() protocol, but do NOT report this to the platform —
     *  we don't own this task's platform assignment or reward, the
     *  originator does. */
    private async participateInQuorumVerification(task: SwarmTask, coExecutors: string[], quorumThreshold: number): Promise<void> {
        if (!(task as any).id && (task as any).task_id) {
            (task as any).id = (task as any).task_id;
        }
        if (!this.p2pNode) return;
        if (!this.identity) return;
        const workerAddr = this.wallet.getAddress();
        if (!workerAddr) return;

        try {
            const result = await this.computeTaskResult(task);
            const identity = this.identity;
            const resultHashBig = hashResult(JSON.stringify(result));
            const resultHashHex = resultHashBig.toString(16).padStart(64, '0');
            const taskIdU64 = taskIdToUint64(task.id);
            const workerAddrParsed = Address.parse(workerAddr);
            const ownSig = signAttestation(identity, taskIdU64, workerAddrParsed, resultHashBig);

            const otherCoExecutors = coExecutors.filter((id) => id !== this.config.nodeId);

            // We don't settle anything ourselves here — just participate so
            // the originator (and any other co-executor) can reach quorum
            // for their own result via cross-signed endorsements. Result is
            // intentionally unused; awaitQuorum's side effect (broadcasting
            // our reveal + endorsing matching peers) is what matters.
            await awaitQuorum(this.p2pNode, {
                taskId: task.id,
                identity,
                workerAddr,
                ownResultHash: resultHashHex,
                ownAttestation: {
                    type: 'attestation',
                    taskId: task.id,
                    nodeId: this.config.nodeId,
                    workerAddr,
                    resultHash: resultHashHex,
                    pubkeyHex: ownSig.pubkeyHex,
                    signatureHex: ownSig.signatureHex,
                },
                coExecutorPeerIds: otherCoExecutors,
                quorumThreshold,
                timeoutMs: 8_000,
            });
        } catch (_e) {
            // Best-effort verification helper — never throw into the P2P event handler.
        }
    }

    private async processTask(task: SwarmTask): Promise<void> {
        // Normalize: completions.ts uses task_id, internal tasks use id
        if (!(task as any).id && (task as any).task_id) {
            (task as any).id = (task as any).task_id;
        }
        const taskId = (task as any).id || (task as any).task_id || 'unknown';
        this.stats.tasksProcessing++;
        logActivity(`Processing task: ${task.type} (${taskId.slice(0, 8)}...) reward: ${task.reward_gstd} GSTD`, 'info');

        try {
            const result = await this.computeTaskResult(task);

            // Quorum gate: for inference tasks, require quorum when the network
            // can support it (≥2 peers + identity loaded). Nodes without peers
            // operate in degraded mode and report without quorum.
            // See docs/superpowers/specs/2026-08-27-quorum-real-gate-design.md
            if (task.type === 'inference') {
                if (this.canAttemptQuorum()) {
                    const quorumReached = await this.attemptQuorumSettlement(task, taskId, result).catch(() => false);
                    if (!quorumReached) {
                        this.stats.tasksCompleted++;
                        this.stats.tasksByType[task.type] = (this.stats.tasksByType[task.type] || 0) + 1;
                        this.stats.quorumGateFailed++;
                        logActivity(`Task ${taskId.slice(0, 8)} computed — quorum not reached, reward forfeited`, 'warn');
                        return;
                    }
                    // quorum reached — fall through to /tasks/complete
                } else {
                    logActivity(
                        `Task ${taskId.slice(0, 8)} — no-quorum mode ` +
                        `(peers: ${this.p2pNode ? (this.p2pNode.getPeers() as any[]).length : 0}, ` +
                        `identity: ${!!this.identity})`,
                        'info'
                    );
                    // fall through to /tasks/complete without quorum gate
                }
            }

            // Report completion — include campaign_id and reward so treasury accounting works.
            // apiCall() swallows failures and returns null rather than throwing —
            // if the platform is unreachable, queue the report and retry rather
            // than falsely recording locally-earned stats the platform never saw
            // (identical failure mode already fixed for quorum settlement above).
            const completionPayload = {
                task_id:      taskId,
                job_id:       (task as any).payload?.job_id || undefined,
                node_id:      this.config.nodeId,
                result,
                wallet_address: this.wallet.getAddress(),
                reward_gstd:  task.reward_gstd,
                protocol_fee: (task as any).protocol_fee || 0,
                campaign_id:  (task as any).campaign_id || null,
            };
            const reported = await this.apiCall('/tasks/complete', completionPayload);

            // Local processing stats reflect real work done regardless of
            // reporting outcome, but the reward is only ever recorded as
            // *verified* once the platform actually confirms it -- either
            // now, or later via the retry queue (see recordTaskEarning()).
            this.stats.tasksCompleted++;
            this.stats.tasksByType[task.type] = (this.stats.tasksByType[task.type] || 0) + 1;

            if (reported) {
                this.recordTaskEarning(task, taskId);
            } else {
                this.queuePendingTaskReport('/tasks/complete', completionPayload, task.type, taskId);
                logActivity(`Task ${taskId.slice(0, 8)} completed but platform unreachable — queued for retry, reward not yet counted`, 'info');
            }

            // Save to collective memory if inference
            if (task.type === 'inference' && task.prompt && result?.response) {
                await this.memory.store(task.prompt, result.response, task.model || 'unknown', 0.8);
            }

        } catch (e: any) {
            this.stats.tasksFailed++;
            logActivity(`Task ${taskId.slice(0, 8)} failed: ${e.message}`, 'error');

            await this.apiCall('/tasks/fail', {
                task_id: taskId,
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
        const model    = task.model || this.config.models.available[0] || 'llama3.2:3b';
        const messages = (task as any).messages || [{ role: 'user', content: task.prompt }];
        const maxTok   = (task as any).max_tokens || (task.payload?.max_tokens) || 2048;
        const temp     = (task as any).temperature ?? 0.7;
        const startMs  = Date.now();

        let data: any;

        // Backend priority:
        // 1. Ollama (local sovereign — no external deps)
        // 2. Any OpenAI-compatible API at GSTD_INFERENCE_URL + GSTD_INFERENCE_KEY
        const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
        const customUrl = (process.env.GSTD_INFERENCE_URL || '').replace(/\/$/, '');
        const customKey = process.env.GSTD_INFERENCE_KEY;

        if (ollamaUrl) {
            // Ollama: try the requested model; fall back to first available local model
            let ollamaModel = model;
            try {
                const tagsResp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
                if (tagsResp.ok) {
                    const tags: any = await tagsResp.json();
                    const available: string[] = (tags.models || []).map((m: any) => m.name);
                    const hasExact = available.includes(model) ||
                        available.some(m => m.replace(/[^a-z0-9]/gi, '').toLowerCase()
                            === model.replace(/[^a-z0-9]/gi, '').toLowerCase());
                    if (!hasExact && available.length > 0) {
                        ollamaModel = available[0]; // use first installed model
                        logActivity(`Model ${model} not in Ollama, using ${ollamaModel}`, 'warn');
                    }
                }
            } catch (_e) { /* use requested model anyway */ }
            data = await this.callOpenAICompat(`${ollamaUrl}/v1`, undefined, ollamaModel, messages, maxTok, temp);
        } else if (customUrl) {
            data = await this.callOpenAICompat(`${customUrl}/v1`, customKey, model, messages, maxTok, temp);
        } else {
            throw new Error('No AI backend configured. Set OLLAMA_URL or GSTD_INFERENCE_URL in .env');
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
        const resultTaskId = (task as any).task_id || task.id;
        if (resultTaskId) {
            this.apiCall('/tasks/result', {
                task_id:    resultTaskId,
                node_id:    this.config.nodeId,
                result,
                latency_ms: latencyMs,
                model,
            }).catch(() => {});
        }

        return result;
    }

    private async processFinetune(task: SwarmTask): Promise<any> {
        const p = (task as any).payload || {};
        const jobId   = p.job_id   || '';
        const shardId = p.shard_id || ((task as any).task_id || task.id);

        if (!this.trainingCapable) {
            throw new Error('finetune capability not verified on this node');
        }

        const taskFile = join(tmpdir(), `gstd_finetune_task_${shardId}.json`);
        writeFileSync(taskFile, JSON.stringify({
            job_id:     jobId,
            shard_id:   shardId,
            base_model: p.base_model || 'qwen2.5:0.5b',
            domain:     p.domain     || 'general',
            shard_url:  p.shard_url  || '',
            steps:      p.steps      || 100,
        }));

        const scriptPath = join(this.config.installDir, 'scripts', 'finetune.py');
        const budgetSecs   = parseInt(process.env.GSTD_FINETUNE_MAX_SECONDS || '180', 10);
        const downloadSecs = parseInt(process.env.GSTD_FINETUNE_DOWNLOAD_BUDGET_SECONDS || '300', 10); // cold HF model download (~1GB) on a slow link
        const uploadSecs    = parseInt(process.env.GSTD_FINETUNE_UPLOAD_BUDGET_SECONDS || '60', 10);    // save_pretrained + tar + IPFS upload
        // training budget + cold-download allowance (first run, HF cache cold) + post-training
        // save/tar/IPFS-upload allowance -- budgetSecs alone only bounds the training loop inside
        // finetune.py and leaves everything else unaccounted for.
        const timeoutMs = (budgetSecs + downloadSecs + uploadSecs) * 1000;

        let stdout: string;
        try {
            stdout = await this.runPythonScript([scriptPath, taskFile], timeoutMs);
        } finally {
            try { unlinkSync(taskFile); } catch (_e) { /* best effort cleanup */ }
        }

        const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
        if (!result.success) {
            throw new Error(result.error || 'finetune subprocess failed');
        }
        if (result.metacognitive_score < 0.3) {
            // Honest reporting: a low-quality shard should not count as done or
            // earn a reward. Throwing routes to /tasks/fail via processTask()'s
            // catch block instead of /tasks/complete.
            throw new Error(`metacognitive_score ${result.metacognitive_score} below 0.3 threshold`);
        }

        logActivity(`Finetune shard ${shardId.slice(0, 10)} complete — model: ${result.model}, score: ${result.metacognitive_score.toFixed(2)}`, 'success');

        return {
            job_id:               jobId,
            shard_id:             shardId,
            base_model:           result.model,
            domain:               p.domain || 'general',
            metacognitive_score:  result.metacognitive_score,
            gradient_norm:        result.gradient_norm,
            val_loss_improvement: result.val_loss_improvement,
            lora_path:            `ipfs://${result.lora_cid}`,
            duration_ms:          Math.round(result.training_seconds * 1000),
            steps_run:            result.steps_run,
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
            models: this.config.models.available,
            max_cpu: this.config.swarm.maxCPU,
            max_ram: this.config.swarm.maxRAM,
            mode: this.config.mode,
            version: this.config.version,
        };
    }

    // ─── Python training subprocess bridge ────────────────────────
    private runPythonScript(args: string[], timeoutMs: number): Promise<string> {
        const pythonBin = join(this.config.installDir, 'venv-training', 'bin', 'python3');
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonBin, args, { cwd: this.config.installDir });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                reject(new Error(`python subprocess timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve(stdout);
                else reject(new Error(`python exited ${code}: ${stderr.slice(0, 500)}`));
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    private async checkTrainingCapable(): Promise<boolean> {
        const scriptPath = join(this.config.installDir, 'scripts', 'finetune.py');
        try {
            // Importing torch+transformers+peft alone takes 17-21s standalone on
            // this Pi, and measurably longer during actual node startup (P2P mesh,
            // wallet init, etc. competing for CPU concurrently) -- 30s was still
            // observed to fail intermittently during real startup even though it
            // comfortably passes in isolation. 60s gives real margin under
            // startup-time contention instead of chasing this again per-restart.
            const stdout = await this.runPythonScript([scriptPath, '--check'], 60_000);
            const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
            return result.capable === true;
        } catch (e: any) {
            // Log why -- this check failing silently (as it did twice before this
            // comment was added) is exactly what makes a too-short timeout hard to
            // diagnose from the outside.
            console.log(`    ⚠ Fine-tuning capability check failed: ${e.message || e}`);
            return false;
        }
    }

    private async apiCall(endpoint: string, data: any, method?: string, query?: string): Promise<any> {
        // Heartbeat and register are exempt from the circuit breaker: skipping either
        // risks the platform's 10-min node TTL expiring with no re-registration path,
        // silently dropping the node from the network until a manual restart.
        const isCriticalEndpoint = endpoint === '/nodes/heartbeat' || endpoint === '/nodes/register';
        if (!isCriticalEndpoint && !platformHealth.shouldAttempt()) return null;
        const url = this.config.swarm.apiUrl + endpoint + (query || '');
        const walletAddr = this.wallet.getAddress() || '';
        const isGet = method === 'GET' || endpoint.startsWith('/nodes/public');
        // /nodes/heartbeat and /nodes/register have been observed taking ~18-22s in
        // production (same root cause already fixed in uptime_daemon.ts) -- give them
        // more headroom than the fast, frequently-polled endpoints like /tasks/poll,
        // which should keep failing fast to avoid piling up calls on a 5s interval.
        const timeoutMs = isCriticalEndpoint ? 25_000 : 10_000;
        try {
            const resp = await fetch(url, {
                method: isGet ? 'GET' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': walletAddr,
                    'X-Node-Id': this.config.nodeId,
                },
                body: isGet ? undefined : JSON.stringify(data),
                signal: AbortSignal.timeout(timeoutMs),
            });
            // Any HTTP response means the platform is reachable —
            // only network failures (catch) should trip the circuit breaker.
            platformHealth.recordSuccess();
            if (resp.ok) {
                return await resp.json().catch(() => ({ ok: true }));
            }
            return null;
        } catch (_e) {
            platformHealth.recordFailure();
            return null;
        }
    }
}
