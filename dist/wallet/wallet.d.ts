/**
 * GSTD Node — Wallet Module
 * TON-based wallet for receiving/sending GSTD tokens
 *
 * Security model:
 * - wallet.json stores ONLY address + publicKey (safe to expose)
 * - wallet_seed.enc stores encrypted seed (chmod 600)
 * - Even if node is hacked, attacker cannot access funds
 *   without the real TON wallet (e.g. Tonkeeper, TON Space)
 * - All write operations require signature from external wallet
 */
export interface WalletConfig {
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
export declare function walletExists(): boolean;
export declare function initWallet(seed?: string): WalletConfig;
export declare function getWallet(): WalletConfig | null;
export declare function getSeed(): string | null;
export declare function getBalance(): Promise<WalletBalance>;
/**
 * Link an external wallet (e.g. Tonkeeper) for fund security.
 * Even if the node is compromised, funds stay safe because
 * all transactions require the external wallet's signature.
 */
export declare function linkExternalWallet(externalAddress: string): boolean;
export declare function linkTelegram(userId: string): Promise<boolean>;
//# sourceMappingURL=wallet.d.ts.map