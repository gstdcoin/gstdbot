/**
 * GSTD NaaS — Revenue Flywheel Converter
 *
 * Economic cycle:
 *   Native tokens earned (ETH/SOL/BNB/etc.)
 *     → 90% paid to node operator (the node that served the request)
 *     → 10% → Protocol Treasury (→ buybacks + liquidity)
 *
 * Reports earnings to platform and triggers on-chain settlement.
 */

import { logActivity } from '../gateway/server.js';

const API_BASE = process.env.GSTD_API_URL || 'https://app.gstdtoken.com/api/v1';

export interface NativeEarning {
    chain:       string;  // 'ETH', 'SOL', etc.
    amount:      number;  // raw amount in native token
    usd_value:   number;  // estimated USD value
    earned_at:   string;
    source:      'rpc_fee' | 'relay_fee' | 'storage_fee';
}

export interface FlywheelResult {
    provider_gstd:  number;  // 90% → node operator
    treasury_gstd:  number;  // 10% → protocol treasury
    total_usd:      number;
    tx_hash?:       string;
}

// ─── Revenue Flywheel ────────────────────────────────────────────
export class RevenueFlywheelConverter {
    private pendingEarnings: NativeEarning[] = [];
    private totalEarned  = 0;
    private timer: NodeJS.Timeout | null = null;

    constructor(private apiKey: string) {}

    // Call this whenever the RPC proxy earns native token fees
    recordEarning(earning: NativeEarning): void {
        this.pendingEarnings.push(earning);
        this.totalEarned += earning.usd_value;
        logActivity(`💰 +${earning.amount} ${earning.chain} (≈$${earning.usd_value.toFixed(4)}) from ${earning.source}`);
    }

    // Start auto-settlement cycle (every 30 minutes)
    start(): void {
        logActivity('🔄 Revenue Flywheel started (settle every 30 min)', 'success');
        this.settle(); // immediate first settle
        this.timer = setInterval(() => this.settle(), 30 * 60 * 1000);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
    }

    private async settle(): Promise<void> {
        if (this.pendingEarnings.length === 0) return;

        const batch = [...this.pendingEarnings];
        this.pendingEarnings = [];

        const totalUSD = batch.reduce((s, e) => s + e.usd_value, 0);
        if (totalUSD < 0.01) return; // minimum batch threshold

        // Fetch current GSTD price to calculate GSTD amounts
        const gstdPrice = await this.getGSTDPrice();
        const totalGSTDEquiv = totalUSD / gstdPrice;

        // Apply flywheel split: 90% to node operator, 10% to protocol treasury
        const provider   = totalGSTDEquiv * 0.90;
        const treasury   = totalGSTDEquiv * 0.10;

        const payload = {
            batch_id:       `batch_${Date.now()}`,
            total_usd:      totalUSD,
            gstd_price:     gstdPrice,
            earnings:       batch.map(e => ({
                chain:      e.chain,
                amount:     e.amount,
                usd_value:  e.usd_value,
                source:     e.source,
            })),
            flywheel: {
                provider_gstd: provider,
                treasury_gstd: treasury,
                split: '90/10',
            },
        };

        // Report to platform for on-chain settlement
        try {
            const resp = await fetch(`${API_BASE}/naas/settle`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15_000),
            });

            if (resp.ok) {
                const data: any = await resp.json();
                logActivity(
                    `🔥 Flywheel settled: $${totalUSD.toFixed(4)} USD | ` +
                    `+${provider.toFixed(4)} GSTD to you | ` +
                    `${treasury.toFixed(4)} GSTD to treasury | ` +
                    `TxHash: ${data.tx_hash || 'pending'}`,
                    'success'
                );
            } else {
                // Re-queue on failure
                this.pendingEarnings.unshift(...batch);
                logActivity('Flywheel settlement failed — will retry next cycle', 'warn');
            }
        } catch (e: any) {
            this.pendingEarnings.unshift(...batch);
            logActivity(`Flywheel: network error — ${e.message}`, 'warn');
        }
    }

    private async getGSTDPrice(): Promise<number> {
        try {
            const resp = await fetch(`${API_BASE}/market/price`, {
                signal: AbortSignal.timeout(5000)
            });
            if (resp.ok) {
                const d: any = await resp.json();
                return d.price_usd || d.usd || 0.001;
            }
        } catch {}
        return 0.001; // fallback
    }

    getStats() {
        return {
            pending_earnings: this.pendingEarnings.length,
            total_earned_usd:  this.totalEarned,
            flywheel_split:    '90% provider / 10% protocol treasury',
        };
    }
}
