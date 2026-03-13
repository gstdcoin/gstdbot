/**
 * GSTD Node OS — TON WalletKit Integration
 *
 * Transforms the node into a wallet-enabled smart node using @ton/walletkit.
 * - Handles TON Connect sessions with dApps
 * - Signs transactions for GSTD reward claims
 * - Sends/receives Jetton transfers (GSTD token)
 * - Bridge for mobile node operators to manage their wallets
 *
 * Architecture:
 *   Mobile User (Telegram) → TMA Mini App → WalletKit → TON Blockchain
 *   Desktop User → Dashboard → WalletKit → TON Blockchain
 */
export interface TonConnectConfig {
    /** TON API endpoint */
    toncenterUrl: string;
    /** Optional Toncenter API key */
    toncenterKey?: string;
    /** TON Connect bridge URL */
    bridgeUrl: string;
    /** Wallet mnemonic (24 words), encrypted at rest */
    mnemonic?: string;
    /** Network: mainnet or testnet */
    network: 'mainnet' | 'testnet';
    /** GSTD Jetton master address */
    gstdJettonAddress: string;
}
export interface WalletKitState {
    initialized: boolean;
    address: string | null;
    balance: {
        ton: string;
        gstd: string;
    };
    connectedDApps: number;
    network: string;
}
export interface TransactionRequest {
    to: string;
    amount: string;
    comment?: string;
    jettonAddress?: string;
}
export declare class TonConnectManager {
    private config;
    private kit;
    private wallet;
    private state;
    private pendingConnects;
    private pendingTransactions;
    constructor(config?: Partial<TonConnectConfig>);
    /**
     * Initialize TonWalletKit with mnemonic.
     * If no mnemonic provided, generates a new one.
     */
    init(mnemonic?: string[]): Promise<void>;
    /**
     * Setup TON Connect event handlers for dApp interactions
     */
    private setupEventHandlers;
    /**
     * Send TON to an address
     */
    sendTon(to: string, amountTon: number, comment?: string): Promise<string | null>;
    /**
     * Send GSTD Jettons to an address
     */
    sendGSTD(to: string, amount: number): Promise<string | null>;
    /**
     * Handle a TON Connect deep link (QR code or tc:// URL)
     */
    handleTonConnectUrl(url: string): Promise<boolean>;
    /**
     * Refresh wallet balance
     */
    refreshBalance(): Promise<WalletKitState>;
    getPendingConnects(): Array<{
        id: string;
        dAppName: string;
        timestamp: number;
    }>;
    approveConnect(requestId: string): Promise<boolean>;
    rejectConnect(requestId: string): Promise<boolean>;
    getPendingTransactions(): Array<{
        id: string;
        preview: any;
        timestamp: number;
    }>;
    approveTransaction(requestId: string): Promise<boolean>;
    rejectTransaction(requestId: string): Promise<boolean>;
    getState(): WalletKitState;
    isReady(): boolean;
    getAddress(): string | null;
    /**
     * Cleanup resources on shutdown
     */
    close(): Promise<void>;
}
//# sourceMappingURL=tonconnect.d.ts.map