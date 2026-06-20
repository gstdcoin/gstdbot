/**
 * GSTD Fee Ledger — decentralized fee collection & distribution
 *
 * Every operation in the GSTD network has a fee:
 *   AI inference:  0.001 GSTD / request
 *   Storage:       0.01  GSTD / MB / day
 *   Relay:         0.005 GSTD / GB
 *
 * Each fee is split:
 *   50% → Ecosystem Treasury  (accumulates → buybacks)
 *   30% → Node operator (who processed the request)
 *   20% → Dev Fund      (protocol development)
 *
 * Ledger is stored locally in fees_ledger.json.
 * No external API needed. Settlement to TON happens in batches
 * when the treasury wallet is configured.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const LEDGER_FILE = join(
    process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot',
    'fees_ledger.json'
);

// ─── Split ratios ─────────────────────────────────────────────────
const SPLIT = {
    gold_reserve: 0.50,
    node_operator: 0.30,
    dev_fund:      0.20,
};

// ─── Fee rates (GSTD) ─────────────────────────────────────────────
export const FEE_RATES = {
    inference_per_request: 0.001,   // per AI query
    inference_per_1k_tokens: 0.0005, // additional per 1K output tokens
    storage_per_mb_day: 0.00001,    // per MB stored per day
    relay_per_gb: 0.005,            // per GB relayed
    pin_per_mb_day: 0.000005,       // per MB pinned per day
};

export type FeeType = 'inference' | 'storage' | 'relay' | 'pin';

export interface FeeEvent {
    id:            string;
    type:          FeeType;
    total:         number;    // total GSTD fee
    gold_reserve:  number;    // 50%
    node_operator: number;    // 30%
    dev_fund:      number;    // 20%
    description:   string;
    metadata:      Record<string, any>;
    timestamp:     string;
    settled_chain: boolean;   // true when sent to TON
    tx_hash?:      string;
}

export interface ReserveStats {
    gold_reserve_gstd:  number;   // total accumulated
    node_earnings_gstd: number;   // total to operators
    dev_fund_gstd:      number;   // total to dev fund
    total_fees_gstd:    number;
    total_events:       number;
    by_type: Record<FeeType, { total: number; events: number }>;
    settled_gstd:       number;   // sent to chain
    pending_gstd:       number;   // not yet settled
    first_event?:       string;
    last_event?:        string;
}

// ─── Fee Ledger ───────────────────────────────────────────────────
export class FeeLedger {
    private events: FeeEvent[] = [];
    private totals = {
        gold_reserve:  0,
        node_operator: 0,
        dev_fund:      0,
        total:         0,
        settled:       0,
    };
    private byType: Record<FeeType, { total: number; events: number }> = {
        inference: { total: 0, events: 0 },
        storage:   { total: 0, events: 0 },
        relay:     { total: 0, events: 0 },
        pin:       { total: 0, events: 0 },
    };
    private onNodeEarning: ((amount: number, type: FeeType) => void) | null = null;

    constructor() {
        this.load();
    }

    /** Hook to notify RevenueEngine when node_operator share is credited */
    onNodeEarned(cb: (amount: number, type: FeeType) => void): void {
        this.onNodeEarning = cb;
    }

    // ─── Record fees ──────────────────────────────────────────────

    /** AI inference completed */
    chargeInference(model: string, tokens: number): FeeEvent {
        const base    = FEE_RATES.inference_per_request;
        const tokenFee = Math.floor(tokens / 1000) * FEE_RATES.inference_per_1k_tokens;
        const total   = Math.round((base + tokenFee) * 1e6) / 1e6;
        return this.record('inference', total, `AI inference (${model}, ${tokens} tokens)`, { model, tokens });
    }

    /** File uploaded to IPFS storage */
    chargeStorage(sizeBytes: number, durationDays: number): FeeEvent {
        const mb    = sizeBytes / (1024 * 1024);
        const total = Math.round(mb * durationDays * FEE_RATES.storage_per_mb_day * 1e6) / 1e6;
        return this.record('storage', total, `Storage ${mb.toFixed(2)} MB × ${durationDays}d`, { size_bytes: sizeBytes, days: durationDays });
    }

    /** CID pinned on this node */
    chargePin(sizeBytes: number, durationDays: number): FeeEvent {
        const mb    = sizeBytes / (1024 * 1024);
        const total = Math.round(mb * durationDays * FEE_RATES.pin_per_mb_day * 1e6) / 1e6;
        return this.record('pin', total, `Pin ${mb.toFixed(2)} MB × ${durationDays}d`, { size_bytes: sizeBytes, days: durationDays });
    }

    /** Data relayed through this node */
    chargeRelay(bytes: number): FeeEvent {
        const gb    = bytes / (1024 * 1024 * 1024);
        const total = Math.round(gb * FEE_RATES.relay_per_gb * 1e6) / 1e6;
        return this.record('relay', total, `Relay ${gb.toFixed(3)} GB`, { bytes });
    }

    // ─── Core ─────────────────────────────────────────────────────

    private record(type: FeeType, total: number, description: string, metadata: Record<string, any>): FeeEvent {
        const gold_reserve  = Math.round(total * SPLIT.gold_reserve  * 1e6) / 1e6;
        const node_operator = Math.round(total * SPLIT.node_operator * 1e6) / 1e6;
        const dev_fund      = Math.round(total * SPLIT.dev_fund      * 1e6) / 1e6;

        const event: FeeEvent = {
            id:            `${type}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
            type, total, gold_reserve, node_operator, dev_fund,
            description, metadata,
            timestamp:     new Date().toISOString(),
            settled_chain: false,
        };

        this.events.push(event);

        this.totals.gold_reserve  += gold_reserve;
        this.totals.node_operator += node_operator;
        this.totals.dev_fund      += dev_fund;
        this.totals.total         += total;
        this.byType[type].total   += total;
        this.byType[type].events  += 1;

        // Notify RevenueEngine about node's share
        if (node_operator > 0) {
            this.onNodeEarning?.(node_operator, type);
        }

        // Persist every 10 events to avoid excessive writes
        if (this.events.length % 10 === 0) this.save();

        return event;
    }

    // ─── Stats & access ───────────────────────────────────────────

    getStats(): ReserveStats {
        return {
            gold_reserve_gstd:  Math.round(this.totals.gold_reserve  * 1e6) / 1e6,
            node_earnings_gstd: Math.round(this.totals.node_operator * 1e6) / 1e6,
            dev_fund_gstd:      Math.round(this.totals.dev_fund      * 1e6) / 1e6,
            total_fees_gstd:    Math.round(this.totals.total         * 1e6) / 1e6,
            total_events:       this.events.length,
            by_type:            { ...this.byType },
            settled_gstd:       Math.round(this.totals.settled       * 1e6) / 1e6,
            pending_gstd:       Math.round((this.totals.gold_reserve - this.totals.settled) * 1e6) / 1e6,
            first_event:        this.events[0]?.timestamp,
            last_event:         this.events[this.events.length - 1]?.timestamp,
        };
    }

    getRecentEvents(limit = 50): FeeEvent[] {
        return this.events.slice(-limit).reverse();
    }

    /** Mark gold_reserve portion as settled (sent to TON) */
    markSettled(amount: number, txHash: string): void {
        this.totals.settled += amount;
        // Mark recent unsettled events
        let remaining = amount;
        for (let i = this.events.length - 1; i >= 0 && remaining > 0; i--) {
            const e = this.events[i];
            if (!e.settled_chain) {
                e.settled_chain = true;
                e.tx_hash = txHash;
                remaining -= e.gold_reserve;
            }
        }
        this.save();
    }

    // ─── Persistence ──────────────────────────────────────────────

    private load(): void {
        try {
            if (!existsSync(LEDGER_FILE)) return;
            const raw = JSON.parse(readFileSync(LEDGER_FILE, 'utf-8'));
            this.events   = raw.events   || [];
            this.totals   = raw.totals   || this.totals;
            this.byType   = raw.by_type  || this.byType;
        } catch { /* corrupt file → start fresh */ }
    }

    save(): void {
        try {
            writeFileSync(LEDGER_FILE, JSON.stringify({
                events:  this.events.slice(-10_000), // keep last 10K events
                totals:  this.totals,
                by_type: this.byType,
            }, null, 2), 'utf-8');
        } catch { /* ignore */ }
    }
}
