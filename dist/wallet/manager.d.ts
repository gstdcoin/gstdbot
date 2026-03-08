/**
 * GSTD Node OS — Wallet Manager
 *
 * Full wallet management with:
 * - GSTD token tracking
 * - Earnings history
 * - Staking (future)
 * - TON integration (future)
 */
import type { NodeConfig } from '../index.js';
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
export declare class NodeWallet {
    private config;
    private wallet;
    private earnings;
    private localBalance;
    private readonly configDir;
    private readonly walletFile;
    private readonly earningsFile;
    constructor(config: NodeConfig);
    init(): Promise<void>;
    getAddress(): string | null;
    getBalance(): WalletBalance;
    getStats(): WalletStats;
    addEarning(amount: number, type: EarningEntry['type'], description: string, taskId?: string): void;
    private earnUptime;
    private createWallet;
    private refreshBalance;
    saveEarnings(): void;
}
export declare function getWallet(): WalletData | null;
export declare function getBalance(): Promise<WalletBalance>;
//# sourceMappingURL=manager.d.ts.map