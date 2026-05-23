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

import { logActivity } from '../gateway/server.js';

// ─── Interfaces ──────────────────────────────────────────────────

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
    balance: { ton: string; gstd: string };
    connectedDApps: number;
    network: string;
}

export interface TransactionRequest {
    to: string;
    amount: string;
    comment?: string;
    jettonAddress?: string;
}

// ─── Default Configuration ───────────────────────────────────────

const DEFAULT_CONFIG: TonConnectConfig = {
    toncenterUrl: 'https://toncenter.com',
    bridgeUrl: 'https://connect.ton.org/bridge',
    network: 'mainnet',
    gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
};

// ─── TON Connect Manager ─────────────────────────────────────────

export class TonConnectManager {
    private config: TonConnectConfig;
    private kit: any = null;
    private wallet: any = null;
    private state: WalletKitState = {
        initialized: false,
        address: null,
        balance: { ton: '0', gstd: '0' },
        connectedDApps: 0,
        network: 'mainnet',
    };

    // Pending dApp requests queue (for TMA approval UI)
    private pendingConnects: Map<string, any> = new Map();
    private pendingTransactions: Map<string, any> = new Map();

    constructor(config?: Partial<TonConnectConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize TonWalletKit with mnemonic.
     * If no mnemonic provided, generates a new one.
     */
    async init(mnemonic?: string[]): Promise<void> {
        try {
            // CJS require — @ton/walletkit ESM bundle is broken (0.0.10 has missing dist/esm/core/TonWalletKit)
            // CJS works correctly via dist/cjs/index.js
            const walletkit = require('@ton/walletkit') as any;
            const {
                TonWalletKit,
                Signer,
                WalletV5R1Adapter,
                Network,
                MemoryStorageAdapter,
            } = walletkit;

            const networkObj = this.config.network === 'testnet'
                ? Network.testnet()
                : Network.mainnet();

            // Build API client config
            const apiClientConfig: any = {
                url: this.config.toncenterUrl,
            };
            if (this.config.toncenterKey) {
                apiClientConfig.key = this.config.toncenterKey;
            }

            // Create kit instance
            this.kit = new TonWalletKit({
                deviceInfo: {
                    platform: 'linux' as const,
                    appName: 'GSTD Node OS',
                    appVersion: '3.3.0',
                    maxProtocolVersion: 2,
                    features: [
                        { name: 'SendTransaction' as const, maxMessages: 4 },
                    ],
                } as any,
                walletManifest: {
                    url: 'https://gstdtoken.com',
                    name: 'GSTD Node OS',
                    iconUrl: 'https://gstdtoken.com/logogstd.png',
                } as any,
                storage: new MemoryStorageAdapter({}),
                networks: {
                    [networkObj.chainId]: {
                        apiClient: apiClientConfig,
                    },
                },
                bridge: {
                    bridgeUrl: this.config.bridgeUrl,
                },
            } as any);

            await this.kit.waitForReady();

            // Add wallet from mnemonic
            if (mnemonic && mnemonic.length >= 24) {
                const signer = await Signer.fromMnemonic(mnemonic, { type: 'ton' });
                const adapter = await WalletV5R1Adapter.create(signer, {
                    client: this.kit.getApiClient(networkObj),
                    network: networkObj,
                });

                this.wallet = await this.kit.addWallet(adapter);
                if (this.wallet) {
                    this.state.address = this.wallet.getAddress();
                    const balance = await this.wallet.getBalance().catch(() => BigInt(0));
                    this.state.balance.ton = (Number(balance) / 1e9).toFixed(4);
                }
            }

            // Register event handlers
            this.setupEventHandlers();

            this.state.initialized = true;
            this.state.network = this.config.network;

            logActivity(`TonConnect initialized: ${this.state.address || 'no wallet'}`, 'success');
            console.log(`    TON Connect: ✓ initialized (${this.config.network})`);

        } catch (err: any) {
            console.log(`    TON Connect: ⚠ init deferred (${err.message?.substring(0, 60)})`);
            // Non-fatal — node works without wallet
            this.state.initialized = false;
        }
    }

    /**
     * Setup TON Connect event handlers for dApp interactions
     */
    private setupEventHandlers(): void {
        if (!this.kit) return;

        // Connect requests from dApps
        this.kit.onConnectRequest(async (event: any) => {
            const requestId = `connect-${Date.now()}`;
            const dAppName = event.dAppInfo?.name || event.preview?.dAppInfo?.name || 'Unknown dApp';
            
            logActivity(`TON Connect request from: ${dAppName}`, 'info');
            
            // For autonomous node mode: auto-approve trusted dApps
            const trustedDapps = ['gstdtoken.com', 'gstd'];
            const isTrusted = trustedDapps.some(d => 
                dAppName.toLowerCase().includes(d) || 
                event.dAppInfo?.url?.includes(d)
            );

            if (isTrusted && this.wallet) {
                // Auto-approve GSTD platform connections
                event.walletId = this.wallet.getWalletId();
                await this.kit.approveConnectRequest(event);
                this.state.connectedDApps++;
                logActivity(`Auto-approved TON Connect: ${dAppName}`, 'success');
            } else {
                // Queue for user approval via TMA
                this.pendingConnects.set(requestId, { event, dAppName, timestamp: Date.now() });
                logActivity(`Pending TON Connect approval: ${dAppName}`, 'info');
            }
        });

        // Transaction requests from dApps
        this.kit.onTransactionRequest(async (event: any) => {
            const requestId = `tx-${Date.now()}`;
            
            // For mobile node: queue transaction for user approval via TMA
            this.pendingTransactions.set(requestId, { 
                event, 
                timestamp: Date.now(),
                preview: event.preview,
            });
            
            logActivity(`Transaction request queued: ${requestId}`, 'info');
        });

        // Disconnect events
        this.kit.onDisconnect((event: any) => {
            this.state.connectedDApps = Math.max(0, this.state.connectedDApps - 1);
            logActivity(`dApp disconnected: ${event.walletAddress}`, 'info');
        });
    }

    // ─── Wallet Operations ───────────────────────────────────────

    /**
     * Send TON to an address
     */
    async sendTon(to: string, amountTon: number, comment?: string): Promise<string | null> {
        if (!this.wallet || !this.kit) return null;

        try {
            const nanotons = BigInt(Math.floor(amountTon * 1e9));
            const txReq: any = {
                recipientAddress: to,
                transferAmount: nanotons.toString(),
            };
            if (comment) txReq.comment = comment;

            const tx = await this.wallet.createTransferTonTransaction(txReq);
            await this.kit.handleNewTransaction(this.wallet, tx);
            
            logActivity(`TON sent: ${amountTon} TON → ${to.slice(0, 8)}...`, 'success');
            return 'pending';
        } catch (err: any) {
            logActivity(`TON send failed: ${err.message}`, 'error');
            return null;
        }
    }

    /**
     * Send GSTD Jettons to an address
     */
    async sendGSTD(to: string, amount: number): Promise<string | null> {
        if (!this.wallet || !this.kit) return null;

        try {
            const rawAmount = BigInt(Math.floor(amount * 1e9)); // 9 decimals
            const txReq: any = {
                recipientAddress: to,
                jettonAddress: this.config.gstdJettonAddress,
                transferAmount: rawAmount.toString(),
                comment: 'GSTD Node Reward Claim',
            };

            const tx = await this.wallet.createTransferJettonTransaction(txReq);
            await this.kit.handleNewTransaction(this.wallet, tx);
            
            logActivity(`GSTD sent: ${amount} GSTD → ${to.slice(0, 8)}...`, 'success');
            return 'pending';
        } catch (err: any) {
            logActivity(`GSTD send failed: ${err.message}`, 'error');
            return null;
        }
    }

    /**
     * Handle a TON Connect deep link (QR code or tc:// URL)
     */
    async handleTonConnectUrl(url: string): Promise<boolean> {
        if (!this.kit) return false;
        try {
            await this.kit.handleTonConnectUrl(url);
            return true;
        } catch (err: any) {
            logActivity(`TON Connect URL failed: ${err.message}`, 'error');
            return false;
        }
    }

    /**
     * Refresh wallet balance
     */
    async refreshBalance(): Promise<WalletKitState> {
        if (!this.wallet) return this.state;

        try {
            const balance = await this.wallet.getBalance();
            this.state.balance.ton = (Number(balance) / 1e9).toFixed(4);

            // Try to get GSTD jetton balance 
            if (this.kit?.jettons) {
                    const { Network } = require('@ton/walletkit') as any;
                    const info = this.kit.jettons.getJettonInfo(
                        this.config.gstdJettonAddress,
                        this.config.network === 'testnet' 
                            ? Network.testnet()
                            : Network.mainnet()
                );
                if (info?.balance) {
                    this.state.balance.gstd = (Number(info.balance) / 1e9).toFixed(4);
                }
            }
        } catch (_e) { /* non-fatal */ }

        return { ...this.state };
    }

    // ─── Pending Requests (for TMA approval) ─────────────────────

    getPendingConnects(): Array<{ id: string; dAppName: string; timestamp: number }> {
        return Array.from(this.pendingConnects.entries()).map(([id, data]) => ({
            id,
            dAppName: data.dAppName,
            timestamp: data.timestamp,
        }));
    }

    async approveConnect(requestId: string): Promise<boolean> {
        const pending = this.pendingConnects.get(requestId);
        if (!pending || !this.wallet || !this.kit) return false;

        try {
            pending.event.walletId = this.wallet.getWalletId();
            await this.kit.approveConnectRequest(pending.event);
            this.pendingConnects.delete(requestId);
            this.state.connectedDApps++;
            return true;
        } catch (_e) { return false; }
    }

    async rejectConnect(requestId: string): Promise<boolean> {
        const pending = this.pendingConnects.get(requestId);
        if (!pending || !this.kit) return false;

        try {
            await this.kit.rejectConnectRequest(pending.event, 'User rejected');
            this.pendingConnects.delete(requestId);
            return true;
        } catch (_e) { return false; }
    }

    getPendingTransactions(): Array<{ id: string; preview: any; timestamp: number }> {
        return Array.from(this.pendingTransactions.entries()).map(([id, data]) => ({
            id,
            preview: data.preview,
            timestamp: data.timestamp,
        }));
    }

    async approveTransaction(requestId: string): Promise<boolean> {
        const pending = this.pendingTransactions.get(requestId);
        if (!pending || !this.kit) return false;

        try {
            await this.kit.approveTransactionRequest(pending.event);
            this.pendingTransactions.delete(requestId);
            return true;
        } catch (_e) { return false; }
    }

    async rejectTransaction(requestId: string): Promise<boolean> {
        const pending = this.pendingTransactions.get(requestId);
        if (!pending || !this.kit) return false;

        try {
            await this.kit.rejectTransactionRequest(pending.event, 'User rejected');
            this.pendingTransactions.delete(requestId);
            return true;
        } catch (_e) { return false; }
    }

    // ─── State ───────────────────────────────────────────────────

    getState(): WalletKitState {
        return { ...this.state };
    }

    isReady(): boolean {
        return this.state.initialized && this.wallet !== null;
    }

    getAddress(): string | null {
        return this.state.address;
    }

    // ─── Helpers ─────────────────────────────────────────────────




    /**
     * Cleanup resources on shutdown
     */
    async close(): Promise<void> {
        this.pendingConnects.clear();
        this.pendingTransactions.clear();
        this.kit = null;
        this.wallet = null;
        this.state.initialized = false;
    }
}
