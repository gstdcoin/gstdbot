/**
 * GSTD Node OS — Wallet Manager
 *
 * Security model:
 * - wallet.json stores ONLY address + publicKey (safe to expose)
 * - Seed is encrypted in wallet_seed.enc (AES-256-CBC, chmod 600)
 * - Even if node is hacked, funds are safe without real wallet
 * - All financial operations require external wallet signature
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import { initWallet, type WalletConfig } from './wallet.js';

// ─── Types ───────────────────────────────────────────────────────
export interface WalletData {
    address: string;
    publicKey: string;
    created: string;
    linkedTelegram?: string;
    linkedExternalWallet?: string;
}

export interface WalletBalance {
    gstd: number;
    ton: number;
    pending: number;
    totalEarned: number;
}

export interface EarningEntry {
    timestamp: string;
    amount: number;
    type: 'uptime' | 'inference' | 'embedding' | 'verification' | 'storage' | 'staking' | 'bonus' | 'bridge_verify';
    taskId?: string;
    description: string;
}

export interface WalletStats {
    address: string | null;
    balance: WalletBalance;
    earningsToday: number;
    earningsWeek: number;
    earningsMonth: number;
    earningsTotal: number;
    earningsHistory: EarningEntry[];
    staking: {
        staked: number;
        apy: number;
        rewardsPending: number;
    };
}

// ─── Wallet Manager ─────────────────────────────────────────────
export class NodeWallet {
    private config: NodeConfig;
    private wallet: WalletConfig | null = null;
    private earnings: EarningEntry[] = [];
    private localBalance: WalletBalance = { gstd: 0, ton: 0, pending: 0, totalEarned: 0 };

    private readonly configDir: string;
    private readonly walletFile: string;
    private readonly earningsFile: string;

    constructor(config: NodeConfig) {
        this.config = config;
        this.configDir = join(homedir(), '.config', 'gstdbot');
        this.walletFile = join(this.configDir, 'wallet.json');
        this.earningsFile = join(this.configDir, 'earnings.json');
    }

    async init(): Promise<void> {
        if (!existsSync(this.configDir)) {
            mkdirSync(this.configDir, { recursive: true });
        }

        // Load or create wallet
        if (existsSync(this.walletFile)) {
            try {
                this.wallet = JSON.parse(readFileSync(this.walletFile, 'utf-8'));
                console.log('    Wallet: ' + this.wallet!.address.slice(0, 12) + '...');
            } catch (_e) {
                this.createWallet();
            }
        } else {
            this.createWallet();
        }

        // Load earnings history
        if (existsSync(this.earningsFile)) {
            try {
                this.earnings = JSON.parse(readFileSync(this.earningsFile, 'utf-8'));
            } catch (_e) {
                this.earnings = [];
            }
        }

        // Fetch real balance from platform
        await this.refreshBalance();

        // NOTE: Heartbeat is handled by SwarmAgent (swarm/agent.ts) — no duplicate here.
        // Only wallet-level balance refresh and earnings persistence below.

        // Refresh balance from platform every 5 minutes
        setInterval(() => this.refreshBalance(), 5 * 60 * 1000);

        // Save earnings log periodically
        setInterval(() => this.saveEarnings(), 5 * 60 * 1000);
    }

    getAddress(): string | null {
        return this.wallet?.address || null;
    }

    getBalance(): WalletBalance {
        return { ...this.localBalance };
    }

    getStats(): WalletStats {
        const now = Date.now();
        const dayAgo = now - 24 * 60 * 60 * 1000;
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

        const earningsToday = this.earnings
            .filter(e => new Date(e.timestamp).getTime() > dayAgo)
            .reduce((sum, e) => sum + e.amount, 0);
        const earningsWeek = this.earnings
            .filter(e => new Date(e.timestamp).getTime() > weekAgo)
            .reduce((sum, e) => sum + e.amount, 0);
        const earningsMonth = this.earnings
            .filter(e => new Date(e.timestamp).getTime() > monthAgo)
            .reduce((sum, e) => sum + e.amount, 0);

        return {
            address: this.wallet?.address || null,
            balance: this.getBalance(),
            earningsToday: Math.round(earningsToday * 10000) / 10000,
            earningsWeek: Math.round(earningsWeek * 10000) / 10000,
            earningsMonth: Math.round(earningsMonth * 10000) / 10000,
            earningsTotal: this.localBalance.totalEarned,
            earningsHistory: this.earnings.slice(0, 50), // Last 50
            staking: {
                staked: 0,
                apy: 0,
                rewardsPending: 0,
            },
        };
    }

    // ─── Record verified earning (only called after backend confirms) ──
    recordVerifiedEarning(amount: number, type: EarningEntry['type'], description: string, taskId?: string): void {
        const entry: EarningEntry = {
            timestamp: new Date().toISOString(),
            amount,
            type,
            taskId,
            description,
        };

        this.earnings.unshift(entry);
        if (this.earnings.length > 1000) this.earnings.length = 1000;

        this.localBalance.totalEarned += amount;
        this.localBalance.gstd += amount;

        logActivity(`+${amount.toFixed(4)} GSTD (${type}: ${description}) [verified]`, 'success');
    }

    /**
     * Send heartbeat to backend — backend decides reward based on
     * uptime, node status, and available reward pool.
     * Node does NOT self-award tokens.
     */
    /**
     * Heartbeat is now centralized in SwarmAgent (swarm/agent.ts) to avoid
     * triple-sending (index.ts + agent.ts + wallet.ts all had their own).
     * The SwarmAgent calls wallet.recordVerifiedEarning() when backend
     * returns a reward.
     */

    // Track queries served for heartbeat reporting
    private queriesServedSinceLastHeartbeat = 0;
    recordQueryServed(): void {
        this.queriesServedSinceLastHeartbeat++;
    }

    // ─── Wallet CRUD ─────────────────────────────────────────────
    private createWallet(): void {
        // Use secure wallet module — seed encrypted separately
        this.wallet = initWallet();
        console.log('    New wallet created: ' + this.wallet.address.slice(0, 12) + '...');
        logActivity('Wallet created: ' + this.wallet.address.slice(0, 16) + '... (seed encrypted)', 'success');
    }

    private async refreshBalance(): Promise<void> {
        if (!this.wallet) return;

        try {
            const resp = await fetch(
                `${this.config.swarm.apiUrl}/wallet/${this.wallet.address}/balance`,
                { signal: AbortSignal.timeout(5000) }
            ).catch(() => null);

            if (resp?.ok) {
                const data: any = await resp.json();
                this.localBalance = {
                    gstd: data.gstd || 0,
                    ton: data.ton || 0,
                    pending: data.pending || 0,
                    totalEarned: data.total_earned || 0,
                };
            }
        } catch (_e) { }
    }

    saveEarnings(): void {
        try {
            writeFileSync(this.earningsFile, JSON.stringify(this.earnings, null, 2));
        } catch (_e) { }
    }

    /**
     * Sync accumulated local earnings to the backend so they appear in
     * the user's pending_balance_gstd and can be withdrawn.
     */
    private unsyncedAmount = 0;
    async syncEarningsToBackend(): Promise<void> {
        if (this.unsyncedAmount <= 0 || !this.wallet) return;
        const amount = this.unsyncedAmount;
        try {
            const resp = await fetch(
                `${this.config.swarm.apiUrl}/api/v1/nodes/sync-earnings`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        wallet_address: this.wallet.address,
                        amount,
                        earning_type: 'node_sync',
                        description: `Node earnings sync (${amount.toFixed(4)} GSTD)`,
                    }),
                    signal: AbortSignal.timeout(10000),
                }
            ).catch(() => null);
            if (resp?.ok) {
                this.unsyncedAmount = 0;
                logActivity(`Earnings synced to backend: ${amount.toFixed(4)} GSTD`, 'success');
            }
        } catch (_e) { }
    }

    /**
     * Link an external wallet (e.g. Tonkeeper) for receiving rewards.
     * This calls the backend to update the node's wallet_address so
     * all future rewards go to the external wallet.
     */
    async linkExternal(externalAddress: string): Promise<boolean> {
        if (!this.wallet) return false;
        try {
            const { linkExternalWallet } = require('./wallet.js');
            linkExternalWallet(externalAddress);

            const resp = await fetch(
                `${this.config.swarm.apiUrl}/api/v1/wallet/link-external`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_address: this.wallet.address,
                        external_address: externalAddress,
                    }),
                    signal: AbortSignal.timeout(10000),
                }
            ).catch(() => null);
            if (resp?.ok) {
                logActivity(`External wallet linked: ${externalAddress.slice(0, 12)}...`, 'success');
                return true;
            }

            // Fallback to node-binding endpoint used by Node OS flow.
            const bindResp = await fetch(
                `${this.config.swarm.apiUrl}/api/v1/nodes/bind-wallet`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_id: process.env.GSTD_NODE_ID || `node-${process.pid}`,
                        owner_wallet: externalAddress,
                        node_address: this.wallet.address,
                    }),
                    signal: AbortSignal.timeout(10000),
                }
            ).catch(() => null);
            if (bindResp?.ok) {
                logActivity(`External wallet linked via nodes/bind-wallet: ${externalAddress.slice(0, 12)}...`, 'success');
                return true;
            }
        } catch (_e) { }
        return false;
    }

}

// ─── Legacy compatibility exports ────────────────────────────────
export { getWallet } from './wallet.js';

export function getBalance(): Promise<WalletBalance> {
    const { getWallet: getW } = require('./wallet.js');
    const wallet = getW();
    if (!wallet) return Promise.resolve({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 });

    return fetch(`https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/balance`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : { gstd: 0, ton: 0, pending: 0, totalEarned: 0 })
        .then((d: any) => ({ gstd: d.gstd || 0, ton: d.ton || 0, pending: d.pending || 0, totalEarned: d.total_earned || 0 }))
        .catch(() => ({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 }));
}
