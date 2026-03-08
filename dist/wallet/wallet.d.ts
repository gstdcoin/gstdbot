/**
 * GSTD Node — Wallet Module
 * TON-based wallet for receiving/sending GSTD tokens
 */
export interface WalletConfig {
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
export declare function walletExists(): boolean;
export declare function initWallet(seed?: string): WalletConfig;
export declare function getWallet(): WalletConfig | null;
export declare function getBalance(): Promise<WalletBalance>;
export declare function linkTelegram(userId: string): Promise<boolean>;
//# sourceMappingURL=wallet.d.ts.map