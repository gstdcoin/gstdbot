/**
 * GSTD SuperNode — Unified Revenue Engine
 *
 * All 6 revenue streams in one engine, all interacting with GSTD token on TON:
 *   1. 💾 Storage Provider  — earn for hosting data shards (Storj/Filecoin)
 *   2. 💻 GPU Compute       — earn for running containers/jobs (Akash/io.net)
 *   3. 🧠 AI Inference      — earn for answering queries (GSTD native)
 *   4. 📡 Traffic Relay     — earn for proxying/CDN (Helium-style)
 *   5. 🎓 Model Training    — earn for federated training (io.net)
 *   6. 🪙 Staking           — earn passive APY (GSTD native)
 *
 * Every earn event is:
 *   1. Recorded locally (instant feedback)
 *   2. Reported to platform API (settlement batching)
 *   3. Settled on-chain via SettlementRouter.tact (real GSTD transfer)
 */

import { logActivity } from '../gateway/server.js';

// ─── Revenue Stream Types ────────────────────────────────────────
export type RevenueStream = 'storage' | 'compute' | 'inference' | 'relay' | 'training';

export interface EarningEvent {
    id: string;
    stream: RevenueStream;
    amount: number;             // GSTD earned
    description: string;
    timestamp: string;
    settled: boolean;           // true = confirmed on-chain
    txHash?: string;            // TON transaction hash when settled
    metadata?: Record<string, any>;
}

export interface RevenueStats {
    totalEarned: number;
    totalPending: number;
    totalSettled: number;
    byStream: Record<RevenueStream, { earned: number; pending: number; events: number }>;
    lastSettlement: string | null;
    settlementsCount: number;
    uptime: number;             // hours
}

export interface RevenueRates {
    storage_per_gb_day: number;
    compute_per_gpu_hour: number;
    inference_per_query: number;
    relay_per_gb: number;
    training_per_epoch: number;
}

// ─── Default GSTD Reward Rates ──────────────────────────────────
const DEFAULT_RATES: RevenueRates = {
    storage_per_gb_day: 0.01,     // 0.01 GSTD per GB per day
    compute_per_gpu_hour: 0.5,    // 0.5 GSTD per GPU-hour
    inference_per_query: 0.001,   // 0.001 GSTD per AI query
    relay_per_gb: 0.005,          // 0.005 GSTD per GB relayed
    training_per_epoch: 0.05,     // 0.05 GSTD per training epoch
};

const PLATFORM_API = process.env.GSTD_API_URL || 'https://platform.gstdtoken.com/api/v1';
const SETTLEMENT_BATCH_SIZE = 50;       // Settle after 50 events
const SETTLEMENT_INTERVAL_MS = 300_000; // Or every 5 minutes

// ─── Revenue Engine ─────────────────────────────────────────────
export class RevenueEngine {
    private walletAddress: string = '';
    private nodeId: string;
    private rates: RevenueRates;
    private events: EarningEvent[] = [];
    private pendingSettlement: EarningEvent[] = [];
    private stats: RevenueStats;
    private settlementTimer: NodeJS.Timeout | null = null;
    private startTime: number = Date.now();

    constructor(nodeId: string, walletAddress?: string) {
        this.nodeId = nodeId;
        this.walletAddress = walletAddress || '';
        this.rates = { ...DEFAULT_RATES };
        this.stats = {
            totalEarned: 0,
            totalPending: 0,
            totalSettled: 0,
            byStream: {
                storage: { earned: 0, pending: 0, events: 0 },
                compute: { earned: 0, pending: 0, events: 0 },
                inference: { earned: 0, pending: 0, events: 0 },
                relay: { earned: 0, pending: 0, events: 0 },
                training: { earned: 0, pending: 0, events: 0 },
            },
            lastSettlement: null,
            settlementsCount: 0,
            uptime: 0,
        };
    }

    async init(): Promise<void> {
        // Fetch latest rates from platform
        await this.fetchRates();

        // Start settlement loop
        this.settlementTimer = setInterval(() => {
            this.settlePending().catch(() => {});
        }, SETTLEMENT_INTERVAL_MS);

        logActivity(`Revenue Engine started — inference earnings active, wallet: ${this.walletAddress.slice(0,8)}...`, 'success');
    }

    setWalletAddress(addr: string): void {
        this.walletAddress = addr;
    }

    async stop(): Promise<void> {
        if (this.settlementTimer) clearInterval(this.settlementTimer);
        // Final settlement
        await this.settlePending();
    }

    // ─── Record Earnings ─────────────────────────────────────────

    /** 💾 Storage: node stored data shards */
    earnStorage(gbStored: number, durationHours: number): EarningEvent {
        const days = durationHours / 24;
        const amount = Math.round(gbStored * this.rates.storage_per_gb_day * days * 10000) / 10000;
        return this.recordEarning('storage', amount, `Stored ${gbStored.toFixed(1)} GB for ${durationHours}h`, {
            gb_stored: gbStored, duration_hours: durationHours,
        });
    }

    /** 💻 Compute: node ran a GPU/CPU job */
    earnCompute(gpuHours: number, gpuModel: string, jobId: string): EarningEvent {
        const multiplier = this.getGPUMultiplier(gpuModel);
        const amount = Math.round(gpuHours * this.rates.compute_per_gpu_hour * multiplier * 10000) / 10000;
        return this.recordEarning('compute', amount, `GPU job ${jobId} (${gpuModel}, ${gpuHours.toFixed(2)}h)`, {
            gpu_hours: gpuHours, gpu_model: gpuModel, job_id: jobId, multiplier,
        });
    }

    /** 🧠 Inference: node answered an AI query */
    earnInference(model: string, tokensUsed: number): EarningEvent {
        const tokenMultiplier = Math.max(1, tokensUsed / 500); // More tokens = more reward
        const amount = Math.round(this.rates.inference_per_query * tokenMultiplier * 10000) / 10000;
        return this.recordEarning('inference', amount, `AI inference (${model}, ${tokensUsed} tokens)`, {
            model, tokens: tokensUsed,
        });
    }

    /** 📡 Relay: node proxied traffic (VPN/CDN/API) */
    earnRelay(bytesRelayed: number, relayType: 'vpn' | 'cdn' | 'api_proxy'): EarningEvent {
        const gb = bytesRelayed / (1024 * 1024 * 1024);
        const amount = Math.round(gb * this.rates.relay_per_gb * 10000) / 10000;
        return this.recordEarning('relay', amount, `${relayType} relay ${gb.toFixed(3)} GB`, {
            bytes: bytesRelayed, relay_type: relayType,
        });
    }

    /** 🎓 Training: node participated in federated training */
    earnTraining(epochs: number, baseModel: string, jobId: string): EarningEvent {
        const amount = Math.round(epochs * this.rates.training_per_epoch * 10000) / 10000;
        return this.recordEarning('training', amount, `Training ${baseModel} (${epochs} epochs, job ${jobId})`, {
            epochs, base_model: baseModel, job_id: jobId,
        });
    }

    // ─── Core Recording ──────────────────────────────────────────
    private recordEarning(stream: RevenueStream, amount: number, description: string, metadata?: Record<string, any>): EarningEvent {
        if (amount <= 0) {
            return { id: '', stream, amount: 0, description, timestamp: new Date().toISOString(), settled: false };
        }

        const event: EarningEvent = {
            id: `${stream}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            stream,
            amount,
            description,
            timestamp: new Date().toISOString(),
            settled: false,
            metadata,
        };

        this.events.push(event);
        this.pendingSettlement.push(event);

        // Update stats
        this.stats.totalEarned += amount;
        this.stats.totalPending += amount;
        this.stats.byStream[stream].earned += amount;
        this.stats.byStream[stream].pending += amount;
        this.stats.byStream[stream].events++;

        // Auto-settle if batch size reached
        if (this.pendingSettlement.length >= SETTLEMENT_BATCH_SIZE) {
            this.settlePending().catch(() => {});
        }

        return event;
    }

    // ─── Settlement (Report to Platform → On-chain GSTD) ─────────
    private async settlePending(): Promise<void> {
        if (this.pendingSettlement.length === 0 || !this.walletAddress) return;

        const batch = this.pendingSettlement.splice(0, SETTLEMENT_BATCH_SIZE);
        const totalAmount = batch.reduce((sum, e) => sum + e.amount, 0);

        // Group by stream for the report
        const breakdown: Record<string, number> = {};
        for (const e of batch) {
            breakdown[e.stream] = (breakdown[e.stream] || 0) + e.amount;
        }

        try {
            const resp = await fetch(`${PLATFORM_API}/settlement/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                },
                body: JSON.stringify({
                    node_id: this.nodeId,
                    wallet_address: this.walletAddress,
                    total_amount: totalAmount,
                    events_count: batch.length,
                    breakdown,
                    events: batch.map(e => ({
                        id: e.id,
                        stream: e.stream,
                        amount: e.amount,
                        timestamp: e.timestamp,
                        metadata: e.metadata,
                    })),
                }),
                signal: AbortSignal.timeout(15000),
            });

            if (resp.ok) {
                const result: any = await resp.json();
                // Mark all as settled
                for (const e of batch) {
                    e.settled = true;
                    e.txHash = result.tx_hash || result.batch_id;
                    this.stats.byStream[e.stream].pending -= e.amount;
                }
                this.stats.totalPending -= totalAmount;
                this.stats.totalSettled += totalAmount;
                this.stats.lastSettlement = new Date().toISOString();
                this.stats.settlementsCount++;

                logActivity(
                    `💰 Settlement: +${totalAmount.toFixed(4)} GSTD (${batch.length} events) → ${result.tx_hash || 'queued'}`,
                    'success'
                );
            } else {
                // Put back in queue for retry
                this.pendingSettlement.unshift(...batch);
            }
        } catch (_e) {
            // Network error — re-queue
            this.pendingSettlement.unshift(...batch);
        }
    }

    // ─── Rate Management ─────────────────────────────────────────
    private async fetchRates(): Promise<void> {
        try {
            const resp = await fetch(`${PLATFORM_API}/rewards/rates`, {
                signal: AbortSignal.timeout(5000),
            }).catch(() => null);

            if (resp?.ok) {
                const data: any = await resp.json();
                if (data.rates) {
                    this.rates = {
                        storage_per_gb_day: data.rates.storage_per_gb_day ?? this.rates.storage_per_gb_day,
                        compute_per_gpu_hour: data.rates.compute_per_gpu_hour ?? this.rates.compute_per_gpu_hour,
                        inference_per_query: data.rates.inference_per_query ?? this.rates.inference_per_query,
                        relay_per_gb: data.rates.relay_per_gb ?? this.rates.relay_per_gb,
                        training_per_epoch: data.rates.training_per_epoch ?? this.rates.training_per_epoch,
                    };
                }
            }
        } catch (_e) {}
    }

    private getGPUMultiplier(model: string): number {
        const m = model.toLowerCase();
        if (m.includes('h100') || m.includes('h200')) return 3.0;
        if (m.includes('a100')) return 2.5;
        if (m.includes('a6000') || m.includes('l40')) return 2.0;
        if (m.includes('4090') || m.includes('3090')) return 1.5;
        if (m.includes('4080') || m.includes('3080')) return 1.2;
        return 1.0;
    }

    // ─── Stats ───────────────────────────────────────────────────
    getStats(): RevenueStats {
        this.stats.uptime = (Date.now() - this.startTime) / 3600000;
        return { ...this.stats };
    }

    getRates(): RevenueRates {
        return { ...this.rates };
    }

    getRecentEvents(limit = 20): EarningEvent[] {
        return this.events.slice(-limit).reverse();
    }

    getPendingCount(): number {
        return this.pendingSettlement.length;
    }
}
