/**
 * GSTD Node OS — Wallet Manager
 *
 * Security model:
 * - wallet.json stores ONLY address + publicKey (safe to expose)
 * - Seed is encrypted in wallet_seed.enc (AES-256-CBC, chmod 600)
 * - Even if node is hacked, funds are safe without real wallet
 * - All financial operations require external wallet signature
 */

import { randomBytes, createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import { initWallet, getWallet as getWalletSecure, type WalletConfig } from './wallet.js';

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
    type: 'uptime' | 'inference' | 'embedding' | 'verification' | 'storage' | 'staking' | 'bonus';
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
            } catch {
                this.createWallet();
            }
        } else {
            this.createWallet();
        }

        // Load earnings history
        if (existsSync(this.earningsFile)) {
            try {
                this.earnings = JSON.parse(readFileSync(this.earningsFile, 'utf-8'));
            } catch {
                this.earnings = [];
            }
        }

        // Fetch balance from platform
        await this.refreshBalance();

        // Start uptime earnings timer (every hour)
        setInterval(() => this.earnUptime(), 60 * 60 * 1000);

        // Save earnings periodically
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
                apy: 12,
                rewardsPending: 0,
            },
        };
    }

    // ─── Earn GSTD ──────────────────────────────────────────────
    addEarning(amount: number, type: EarningEntry['type'], description: string, taskId?: string): void {
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
        this.localBalance.pending += amount;

        logActivity(`+${amount.toFixed(4)} GSTD (${type}: ${description})`, 'success');
    }

    private earnUptime(): void {
        const reward = 0.1; // 0.1 GSTD per hour of uptime
        this.addEarning(reward, 'uptime', '1 hour uptime reward');
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
        } catch { }
    }

    saveEarnings(): void {
        try {
            writeFileSync(this.earningsFile, JSON.stringify(this.earnings, null, 2));
        } catch { }
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
