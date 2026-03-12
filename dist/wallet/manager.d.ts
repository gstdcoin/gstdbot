/**
 * GSTD Node OS — Wallet Manager
 *
 * Security model:
 * - wallet.json stores ONLY address + publicKey (safe to expose)
 * - Seed is encrypted in wallet_seed.enc (AES-256-CBC, chmod 600)
 * - Even if node is hacked, funds are safe without real wallet
 * - All financial operations require external wallet signature
 */
import type { NodeConfig } from '../index.js';
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
    recordVerifiedEarning(amount: number, type: EarningEntry['type'], description: string, taskId?: string): void;
    /**
     * Send heartbeat to backend — backend decides reward based on
     * uptime, node status, and available reward pool.
     * Node does NOT self-award tokens.
     */
    private sendHeartbeat;
    private queriesServedSinceLastHeartbeat;
    recordQueryServed(): void;
    private createWallet;
    private refreshBalance;
    saveEarnings(): void;
    /**
     * Sync accumulated local earnings to the backend so they appear in
     * the user's pending_balance_gstd and can be withdrawn.
     */
    private unsyncedAmount;
    syncEarningsToBackend(): Promise<void>;
    /**
     * Link an external wallet (e.g. Tonkeeper) for receiving rewards.
     * This calls the backend to update the node's wallet_address so
     * all future rewards go to the external wallet.
     */
    linkExternal(externalAddress: string): Promise<boolean>;
}
export { getWallet } from './wallet.js';
export declare function getBalance(): Promise<WalletBalance>;
//# sourceMappingURL=manager.d.ts.map