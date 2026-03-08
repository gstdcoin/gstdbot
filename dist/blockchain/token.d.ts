/**
 * GSTD Node OS — Blockchain Integration
 *
 * Full TON blockchain interaction:
 * - GSTD token operations (balance, transfer, stake)
 * - Smart contract interaction
 * - On-chain task verification
 * - Reward distribution
 * - DEX integration for GSTD/TON swaps
 * - Transaction history
 */
export interface TokenBalance {
    gstd: number;
    ton: number;
    staked: number;
    pending: number;
    totalEarned: number;
    totalSpent: number;
}
export interface Transaction {
    hash: string;
    type: 'earn' | 'spend' | 'transfer_in' | 'transfer_out' | 'stake' | 'unstake' | 'swap';
    amount: number;
    token: 'GSTD' | 'TON';
    from: string;
    to: string;
    timestamp: string;
    status: 'pending' | 'confirmed' | 'failed';
    description: string;
    blockHeight?: number;
}
export interface StakingInfo {
    staked: number;
    apy: number;
    rewardsPending: number;
    rewardsTotal: number;
    stakedSince: string | null;
    lockPeriodDays: number;
    nextReward: string | null;
}
export interface GSTDPrice {
    usd: number;
    ton: number;
    change24h: number;
    marketCap: number;
    volume24h: number;
    lastUpdated: string;
}
export declare class BlockchainManager {
    private walletAddress;
    private walletSeed;
    private transactions;
    private cachedBalance;
    private cachedPrice;
    private stakingInfo;
    private refreshTimer;
    private configDir;
    constructor();
    init(): Promise<void>;
    close(): Promise<void>;
    getBalance(): Promise<TokenBalance>;
    private refreshBalance;
    getPrice(): Promise<GSTDPrice>;
    private refreshPrice;
    transfer(toAddress: string, amount: number, memo?: string): Promise<Transaction | null>;
    stake(amount: number): Promise<boolean>;
    unstake(amount: number): Promise<boolean>;
    private calculateStakingRewards;
    getStakingInfo(): StakingInfo;
    getTransactions(limit?: number, type?: string): Transaction[];
    recordEarning(amount: number, description: string): void;
    getFullStatus(): Promise<any>;
    private saveTransactions;
    private saveStaking;
}
//# sourceMappingURL=token.d.ts.map