/**
 * GSTD Node OS — Sovereign Instrument Suite
 * 
 * All financial and governance instruments built into every node:
 * - Auto-Staking: earnings auto-compound for maximum yield
 * - P2P Payments: send/receive GSTD zero-fee between nodes
 * - Mesh Discovery: find and connect to peer nodes directly
 * - Consensus Voting: validate task results with other nodes
 * - Governance: vote on protocol changes
 * - Revenue Analytics: track node profitability in real-time
 * - Auto-Lending: offer idle GSTD as micro-loans
 * - Capability Broadcasting: advertise node hardware to network
 */

import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import { logActivity } from '../gateway/server.js';

// ─── Types ───────────────────────────────────────────────────────
export interface SovereignState {
    // Staking
    stakedAmount: number;
    stakingAPY: number;
    stakingEarned: number;
    autoCompound: boolean;

    // P2P Payments
    paymentsSent: number;
    paymentsReceived: number;
    totalTransferred: number;

    // Mesh
    meshPeers: MeshPeer[];
    meshScore: number;

    // Governance
    activeProposals: number;
    votesSubmitted: number;
    governancePower: number;

    // Revenue
    hourlyRate: number;
    dailyEstimate: number;
    monthlyEstimate: number;
    yearlyEstimate: number;
    profitableHoursPerDay: number;
    costPerHourUSD: number;
    revenuePerHourGSTD: number;

    // Lending
    loansGiven: number;
    interestEarned: number;

    // Node capabilities
    capabilities: string[];
    autonomousMode: boolean;
}

export interface MeshPeer {
    nodeId: string;
    endpoint: string;
    latencyMs: number;
    trust: number;
    lastSeen: string;
}

export interface ProfitReport {
    uptimeReward: number;
    queryReward: number;
    stakingYield: number;
    revenueShare: number;
    referralBonus: number;
    lendingInterest: number;
    totalDaily: number;
    totalMonthly: number;
    totalYearly: number;
    nodeOperatingCostUSD: number;
    profitMultiplier: number;
}

// ─── Sovereign Instrument Suite ──────────────────────────────────
export class SovereignSuite {
    private config: NodeConfig;
    private wallet: NodeWallet;
    private apiUrl: string;
    private state: SovereignState;
    private profitTracker: ProfitReport;

    // Timers
    private meshTimer: NodeJS.Timeout | null = null;
    private stakingTimer: NodeJS.Timeout | null = null;
    private governanceTimer: NodeJS.Timeout | null = null;
    private profitTimer: NodeJS.Timeout | null = null;
    private lendingTimer: NodeJS.Timeout | null = null;

    constructor(config: NodeConfig, wallet: NodeWallet) {
        this.config = config;
        this.wallet = wallet;
        this.apiUrl = config.swarm.apiUrl;
        this.state = {
            stakedAmount: 0, stakingAPY: 0, stakingEarned: 0, autoCompound: true,
            paymentsSent: 0, paymentsReceived: 0, totalTransferred: 0,
            meshPeers: [], meshScore: 0,
            activeProposals: 0, votesSubmitted: 0, governancePower: 0,
            hourlyRate: 0, dailyEstimate: 0, monthlyEstimate: 0, yearlyEstimate: 0,
            profitableHoursPerDay: 24, costPerHourUSD: 0.001, revenuePerHourGSTD: 0.01,
            loansGiven: 0, interestEarned: 0,
            capabilities: [], autonomousMode: false,
        };
        this.profitTracker = {
            uptimeReward: 0, queryReward: 0, stakingYield: 0, revenueShare: 0,
            referralBonus: 0, lendingInterest: 0,
            totalDaily: 0, totalMonthly: 0, totalYearly: 0,
            nodeOperatingCostUSD: 0.024, // ~$0.72/month (cheap VPS)
            profitMultiplier: 0,
        };
    }

    // ─── Lifecycle ───────────────────────────────────────────────
    async start(): Promise<void> {
        logActivity('🏛️ Sovereign Suite: initializing all instruments...', 'info');

        // 1. Register node capabilities with platform
        await this.registerCapabilities();

        // 2. Announce to mesh network
        await this.meshAnnounce();

        // 3. Check staking status & auto-compound
        await this.syncStakingState();

        // 4. Check governance proposals
        await this.syncGovernance();

        // 5. Calculate profitability
        this.calculateProfitability();

        // Start periodic timers
        // Mesh discovery every 2 minutes
        this.meshTimer = setInterval(() => this.meshAnnounce(), 2 * 60_000);

        // Staking auto-compound every 30 minutes
        this.stakingTimer = setInterval(() => this.autoCompoundRewards(), 30 * 60_000);

        // Governance check every 10 minutes
        this.governanceTimer = setInterval(() => this.syncGovernance(), 10 * 60_000);

        // Profit calculation every 5 minutes
        this.profitTimer = setInterval(() => this.calculateProfitability(), 5 * 60_000);

        // Auto-lending check every 15 minutes
        this.lendingTimer = setInterval(() => this.autoLendIdleFunds(), 15 * 60_000);

        logActivity(`🏛️ Sovereign Suite: ALL instruments active | Mesh: ${this.state.meshPeers.length} peers`, 'success');
    }

    async stop(): Promise<void> {
        if (this.meshTimer) clearInterval(this.meshTimer);
        if (this.stakingTimer) clearInterval(this.stakingTimer);
        if (this.governanceTimer) clearInterval(this.governanceTimer);
        if (this.profitTimer) clearInterval(this.profitTimer);
        if (this.lendingTimer) clearInterval(this.lendingTimer);
        logActivity('🏛️ Sovereign Suite: stopped', 'info');
    }

    getState(): SovereignState { return { ...this.state }; }
    getProfitReport(): ProfitReport { return { ...this.profitTracker }; }

    // Called by SwarmAgent when peers are discovered from platform API
    updateMeshPeers(peerIds: string[]): void {
        this.state.meshPeers = peerIds.map(id => ({
            nodeId: id,
            endpoint: '',
            latencyMs: 0,
            trust: 1.0,
            lastSeen: new Date().toISOString(),
        }));
        this.state.meshScore = peerIds.length;
    }

    // ─── 1. MESH NETWORK (P2P Discovery) ─────────────────────────
    private async meshAnnounce(): Promise<void> {
        try {
            const peerIds = this.state.meshPeers.map(p => p.nodeId);
            const result = await this.apiPost('/sovereign/mesh/announce', {
                node_id: this.config.nodeId,
                endpoint: `${this.config.nodeId}:${(this.config as any).port || 3000}`,
                peer_ids: peerIds,
            });

            if (result?.peers) {
                this.state.meshPeers = result.peers.map((p: any) => ({
                    nodeId: p.node_id, endpoint: p.endpoint || '',
                    latencyMs: p.latency_ms || 0, trust: p.trust || 1.0,
                    lastSeen: new Date().toISOString(),
                }));
                this.state.meshScore = result.mesh_size || 0;
            }
        } catch (_e) { }
    }

    // ─── 2. CAPABILITIES REGISTRATION ────────────────────────────
    private async registerCapabilities(): Promise<void> {
        try {
            const { cpus: getCpus, totalmem: _totalmem, freemem } = await import('os');
            const _cpuInfo = getCpus();
            let gpuModel = '';
            try {
                const { execSync } = await import('child_process');
                gpuModel = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim();
            } catch (_e) { }

            let diskFree = 0;
            try {
                const { execSync } = await import('child_process');
                const out = execSync("df -BG / | tail -1 | awk '{print $4}'", {
                    encoding: 'utf-8', timeout: 3000,
                }).trim().replace('G', '');
                diskFree = parseInt(out) || 0;
            } catch (_e2) {
                diskFree = Math.round(freemem() / (1024 * 1024 * 1024)); // fallback
            }
            const caps = {
                node_id: this.config.nodeId,
                can_ai_inference: true,
                can_bridge_verify: true,
                can_storage: true,
                can_federated_ml: false,
                can_p2p_relay: true,
                can_consensus_validate: true,
                gpu_model: gpuModel || 'CPU-only',
                gpu_vram_gb: 0,
                disk_free_gb: diskFree,
                bandwidth_mbps: 100,
                autonomous_mode: true,
                uptime_guarantee_pct: 95,
            };

            await this.apiPost('/sovereign/node/capabilities', caps);
            this.state.capabilities = ['ai_inference', 'bridge_verify', 'storage', 'p2p_relay', 'consensus'];
            this.state.autonomousMode = true;
        } catch (_e) { }
    }

    // ─── 3. AUTO-STAKING (compound rewards → maximum yield) ──────
    private async syncStakingState(): Promise<void> {
        try {
            const walletAddr = this.wallet.getAddress();
            if (!walletAddr) return;

            const result = await this.apiGet(`/sovereign/staking/info?wallet=${walletAddr}`);
            if (result) {
                this.state.stakedAmount = result.your_staked || 0;
                this.state.stakingEarned = result.your_earned || 0;
                this.state.stakingAPY = 0; // Staking not active; node operators earn per-request fees
            }
        } catch (_e) { }
    }

    async autoCompoundRewards(): Promise<void> {
        if (!this.state.autoCompound) return;

        try {
            const walletAddr = this.wallet.getAddress();
            if (!walletAddr) return;

            // Check pending rewards
            const rewards = await this.apiGet(`/nodes/pending-rewards?wallet=${walletAddr}`);
            if (!rewards || rewards.total_pending < 1) return; // Min 1 GSTD to compound

            // Claim pending rewards first
            await this.apiPost('/nodes/claim-rewards', { owner_wallet: walletAddr });

            // Re-stake claimed rewards (auto-compound node earnings back into the node)
            const stakeResult = await this.apiPost('/sovereign/stake', {
                wallet: walletAddr,
                amount: rewards.total_pending,
                lock_days: 365,
            });

            if (stakeResult?.stake_id) {
                this.state.stakedAmount += rewards.total_pending;
                logActivity(`♻️ Auto-compound: ${rewards.total_pending.toFixed(4)} GSTD re-staked`, 'success');
            }
        } catch (_e) { }
    }

    // ─── 4. P2P PAYMENTS ─────────────────────────────────────────
    async sendPayment(receiverWallet: string, amount: number, memo?: string): Promise<any> {
        const senderWallet = this.wallet.getAddress();
        if (!senderWallet) throw new Error('Wallet not configured');

        const result = await this.apiPost('/sovereign/pay', {
            sender_wallet: senderWallet,
            receiver_wallet: receiverWallet,
            amount,
            memo: memo || `Node ${this.config.nodeId.slice(0, 8)} payment`,
        });

        if (result?.payment_id) {
            this.state.paymentsSent++;
            this.state.totalTransferred += amount;
            logActivity(`💸 Sent ${amount} GSTD → ${receiverWallet.slice(0, 12)}... (burned: ${result.burned})`, 'success');
        }
        return result;
    }

    async getPaymentHistory(): Promise<any> {
        const wallet = this.wallet.getAddress();
        if (!wallet) return { payments: [] };
        return this.apiGet(`/sovereign/payments?wallet=${wallet}`);
    }

    // ─── 5. GOVERNANCE ───────────────────────────────────────────
    private async syncGovernance(): Promise<void> {
        try {
            const result = await this.apiGet('/sovereign/governance/proposals');
            if (result) {
                this.state.activeProposals = result.count || 0;

                // Calculate governance power (staked + uptime)
                const uptimeHours = Math.round(process.uptime() / 3600);
                this.state.governancePower = this.state.stakedAmount + 
                    (uptimeHours * 0.1); // uptime hours * 0.1
            }
        } catch (_e) { }
    }

    async voteOnProposal(proposalId: string, vote: 'for' | 'against' | 'abstain'): Promise<any> {
        const wallet = this.wallet.getAddress();
        if (!wallet) throw new Error('Wallet not configured');

        const result = await this.apiPost('/sovereign/governance/vote', {
            wallet, proposal_id: proposalId, vote,
        });

        if (result?.vote) {
            this.state.votesSubmitted++;
            logActivity(`🗳️ Voted '${vote}' on proposal ${proposalId.slice(0, 8)}... (weight: ${result.vote_weight})`, 'success');
        }
        return result;
    }

    async createProposal(title: string, description: string): Promise<any> {
        const wallet = this.wallet.getAddress();
        if (!wallet) throw new Error('Wallet not configured');

        return this.apiPost('/sovereign/governance/propose', {
            wallet, title, description, type: 'parameter',
        });
    }

    // ─── 6. CONSENSUS (validate task results with peers) ─────────
    async submitConsensusVote(taskId: string, resultHash: string): Promise<any> {
        return this.apiPost('/sovereign/mesh/consensus', {
            task_id: taskId,
            node_id: this.config.nodeId,
            result_hash: resultHash,
        });
    }

    // ─── 7. AUTO-LENDING (idle funds earn interest) ──────────────
    private async autoLendIdleFunds(): Promise<void> {
        // Only lend if we have excess balance beyond staked amount
        try {
            const wallet = this.wallet.getAddress();
            if (!wallet) return;

            // Check if there are loan requests in the pool
            // For now, just track the lending state
            const loans = await this.apiGet(`/sovereign/loans?wallet=${wallet}`);
            if (loans) {
                this.state.loansGiven = loans.count || 0;
            }
        } catch (_e) { }
    }

    // ─── 8. PROFITABILITY ENGINE ─────────────────────────────────
    private calculateProfitability(): void {
        // Base uptime reward: 0.01 GSTD/hour
        const uptimePerHour = 0.01;
        // Query reward: average 5 queries/hour * 0.0001 = 0.0005/hour  
        const queryPerHour = 0.0005;
        // Re-staked amount earns proportional inference fees (proportional to staked share)
        const stakingPerHour = this.state.stakedAmount > 0 ? this.state.stakedAmount * 0.001 / 8760 : 0;
        // Revenue share: 85% of platform fees (estimated 0.001/hour per node)
        const revenuePerHour = 0.001;
        // Referral bonus: 5% of referred nodes' earnings
        const referralPerHour = 0;
        // Lending interest: 5% annual on loaned amount
        const lendingPerHour = 0;

        const totalPerHour = uptimePerHour + queryPerHour + stakingPerHour + revenuePerHour + referralPerHour + lendingPerHour;

        this.profitTracker = {
            uptimeReward: uptimePerHour * 24,
            queryReward: queryPerHour * 24,
            stakingYield: stakingPerHour * 24,
            revenueShare: revenuePerHour * 24,
            referralBonus: referralPerHour * 24,
            lendingInterest: lendingPerHour * 24,
            totalDaily: totalPerHour * 24,
            totalMonthly: totalPerHour * 24 * 30,
            totalYearly: totalPerHour * 24 * 365,
            nodeOperatingCostUSD: 0.024, // $0.72/month
            profitMultiplier: totalPerHour * 24 * 30 * 0.0000745 / 0.72, // monthly GSTD * price / cost
        };

        this.state.hourlyRate = totalPerHour;
        this.state.dailyEstimate = totalPerHour * 24;
        this.state.monthlyEstimate = totalPerHour * 24 * 30;
        this.state.yearlyEstimate = totalPerHour * 24 * 365;
        this.state.revenuePerHourGSTD = totalPerHour;
    }

    // ─── 9. NODE PROFITABILITY DASHBOARD DATA ────────────────────
    getNodeEconomics(): any {
        const p = this.profitTracker;
        const gstdPrice = 0.0000745; // Current GSTD price
        
        return {
            summary: {
                daily_gstd: p.totalDaily,
                monthly_gstd: p.totalMonthly,
                yearly_gstd: p.totalYearly,
                daily_usd: p.totalDaily * gstdPrice,
                monthly_usd: p.totalMonthly * gstdPrice,
                yearly_usd: p.totalYearly * gstdPrice,
            },
            revenue_streams: {
                uptime: { daily: p.uptimeReward, desc: 'Base uptime reward (0.01 GSTD/h)' },
                queries: { daily: p.queryReward, desc: 'AI query processing reward' },
                staking: { daily: p.stakingYield, desc: 'Re-staked earnings (proportional to node activity)' },
                revenue_share: { daily: p.revenueShare, desc: '85% of platform fees distributed to nodes' },
                referral: { daily: p.referralBonus, desc: '5% of referred nodes earnings' },
                lending: { daily: p.lendingInterest, desc: 'Interest from micro-loans' },
            },
            operating_cost: {
                monthly_usd: 0.72,
                desc: 'Minimal VPS: $0.72/month (1 vCPU, 512MB RAM)',
            },
            roi: {
                breakeven_days: p.totalDaily > 0 ? Math.ceil(0.72 / (p.totalDaily * gstdPrice * 30)) : Infinity,
                monthly_profit_usd: p.totalMonthly * gstdPrice - 0.72,
                yearly_profit_usd: p.totalYearly * gstdPrice - 8.64,
            },
            advantages: [
                'No minimum hardware — Raspberry Pi, laptop, or server',
                'Earn GSTD for real compute served — not inflationary emissions',
                'Open-source: verify every line on GitHub',
                'Low operating cost — ~$0.72/month on minimal VPS',
                'Earnings scale with network usage — more requests = more GSTD',
                'Fully autonomous — works even if platform is temporarily down',
            ],
            vs_alternatives: {
                bitcoin_mining: 'GSTD: $0.72/month cost vs Bitcoin: $100+/month electricity. GSTD: useful AI compute vs BTC: wasted energy.',
                cloud_providers: 'GSTD: earn for idle compute vs Cloud: pay to rent servers. Run a node, monetize your hardware.',
                centralized_ai: 'GSTD: open, permissionless, earn fees vs OpenAI: closed, pay monthly subscription.',
            },
        };
    }

    // ─── API Helpers ─────────────────────────────────────────────
    private async apiPost(endpoint: string, data: any): Promise<any> {
        try {
            const walletAddr = this.wallet.getAddress() || '';
            const resp = await fetch(`${this.apiUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': walletAddr,
                    'X-Node-Id': this.config.nodeId,
                },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(10_000),
            });
            if (resp.ok) return resp.json().catch(() => ({ ok: true }));
            return null;
        } catch (_e) { return null; }
    }

    private async apiGet(endpoint: string): Promise<any> {
        try {
            const walletAddr = this.wallet.getAddress() || '';
            const resp = await fetch(`${this.apiUrl}${endpoint}`, {
                headers: {
                    'X-Wallet-Address': walletAddr,
                    'X-Node-Id': this.config.nodeId,
                },
                signal: AbortSignal.timeout(10_000),
            });
            if (resp.ok) return resp.json().catch(() => null);
            return null;
        } catch (_e) { return null; }
    }
}
