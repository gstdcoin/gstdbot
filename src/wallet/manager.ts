/**
 * GSTD Node OS — Wallet Manager
 *
 * Full wallet management with:
 * - GSTD token tracking
 * - Earnings history
 * - Staking (future)
 * - TON integration (future)
 */

import { randomBytes, createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logActivity } from '../dashboard/server.js';
import type { NodeConfig } from '../index.js';

// ─── Types ───────────────────────────────────────────────────────
export interface WalletData {
    address: string;
    seed: string;
    created: string;
    linkedTelegram?: string;
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
    private wallet: WalletData | null = null;
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
        const seed = randomBytes(32).toString('hex');
        const addressHash = createHash('sha256').update(seed).digest('hex').slice(0, 32);
        const address = `UQ${addressHash}`;

        this.wallet = {
            address,
            seed,
            created: new Date().toISOString(),
        };

        writeFileSync(this.walletFile, JSON.stringify(this.wallet, null, 2));
        console.log('    New wallet created: ' + address.slice(0, 12) + '...');
        logActivity('Wallet created: ' + address.slice(0, 16) + '...', 'success');
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

    private saveEarnings(): void {
        try {
            writeFileSync(this.earningsFile, JSON.stringify(this.earnings, null, 2));
        } catch { }
    }
}

// ─── Legacy compatibility exports ────────────────────────────────
export function getWallet(): WalletData | null {
    const walletFile = join(homedir(), '.config', 'gstdbot', 'wallet.json');
    if (!existsSync(walletFile)) return null;
    try { return JSON.parse(readFileSync(walletFile, 'utf-8')); }
    catch { return null; }
}

export function getBalance(): Promise<WalletBalance> {
    const wallet = getWallet();
    if (!wallet) return Promise.resolve({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 });

    return fetch(`https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/balance`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : { gstd: 0, ton: 0, pending: 0, totalEarned: 0 })
        .then((d: any) => ({ gstd: d.gstd || 0, ton: d.ton || 0, pending: d.pending || 0, totalEarned: d.total_earned || 0 }))
        .catch(() => ({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 }));
}
