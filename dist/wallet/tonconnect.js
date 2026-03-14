"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TonConnectManager = void 0;
const server_js_1 = require("../gateway/server.js");
// ─── Default Configuration ───────────────────────────────────────
const DEFAULT_CONFIG = {
    toncenterUrl: 'https://toncenter.com',
    bridgeUrl: 'https://connect.ton.org/bridge',
    network: 'mainnet',
    gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
};
// ─── TON Connect Manager ─────────────────────────────────────────
class TonConnectManager {
    config;
    kit = null;
    wallet = null;
    state = {
        initialized: false,
        address: null,
        balance: { ton: '0', gstd: '0' },
        connectedDApps: 0,
        network: 'mainnet',
    };
    // Pending dApp requests queue (for TMA approval UI)
    pendingConnects = new Map();
    pendingTransactions = new Map();
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Initialize TonWalletKit with mnemonic.
     * If no mnemonic provided, generates a new one.
     */
    async init(mnemonic) {
        try {
            // Dynamic import — @ton/walletkit is ESM-only
            const walletkit = await import('@ton/walletkit');
            const { TonWalletKit, Signer, WalletV5R1Adapter, Network, MemoryStorageAdapter, } = walletkit;
            const networkObj = this.config.network === 'testnet'
                ? Network.testnet()
                : Network.mainnet();
            // Build API client config
            const apiClientConfig = {
                url: this.config.toncenterUrl,
            };
            if (this.config.toncenterKey) {
                apiClientConfig.key = this.config.toncenterKey;
            }
            // Create kit instance
            this.kit = new TonWalletKit({
                deviceInfo: {
                    platform: 'linux',
                    appName: 'GSTD Node OS',
                    appVersion: '3.3.0',
                    maxProtocolVersion: 2,
                    features: [
                        { name: 'SendTransaction', maxMessages: 4 },
                    ],
                },
                walletManifest: {
                    url: 'https://app.gstdtoken.com',
                    name: 'GSTD Node OS',
                    iconUrl: 'https://app.gstdtoken.com/icon-512.png',
                },
                storage: new MemoryStorageAdapter({}),
                networks: {
                    [networkObj.chainId]: {
                        apiClient: apiClientConfig,
                    },
                },
                bridge: {
                    bridgeUrl: this.config.bridgeUrl,
                },
            });
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
            (0, server_js_1.logActivity)(`TonConnect initialized: ${this.state.address || 'no wallet'}`, 'success');
            console.log(`    TON Connect: ✓ initialized (${this.config.network})`);
        }
        catch (err) {
            console.log(`    TON Connect: ⚠ init deferred (${err.message?.substring(0, 60)})`);
            // Non-fatal — node works without wallet
            this.state.initialized = false;
        }
    }
    /**
     * Setup TON Connect event handlers for dApp interactions
     */
    setupEventHandlers() {
        if (!this.kit)
            return;
        // Connect requests from dApps
        this.kit.onConnectRequest(async (event) => {
            const requestId = `connect-${Date.now()}`;
            const dAppName = event.dAppInfo?.name || event.preview?.dAppInfo?.name || 'Unknown dApp';
            (0, server_js_1.logActivity)(`TON Connect request from: ${dAppName}`, 'info');
            // For autonomous node mode: auto-approve trusted dApps
            const trustedDapps = ['gstdtoken.com', 'app.gstdtoken.com', 'gstd'];
            const isTrusted = trustedDapps.some(d => dAppName.toLowerCase().includes(d) ||
                event.dAppInfo?.url?.includes(d));
            if (isTrusted && this.wallet) {
                // Auto-approve GSTD platform connections
                event.walletId = this.wallet.getWalletId();
                await this.kit.approveConnectRequest(event);
                this.state.connectedDApps++;
                (0, server_js_1.logActivity)(`Auto-approved TON Connect: ${dAppName}`, 'success');
            }
            else {
                // Queue for user approval via TMA
                this.pendingConnects.set(requestId, { event, dAppName, timestamp: Date.now() });
                (0, server_js_1.logActivity)(`Pending TON Connect approval: ${dAppName}`, 'info');
            }
        });
        // Transaction requests from dApps
        this.kit.onTransactionRequest(async (event) => {
            const requestId = `tx-${Date.now()}`;
            // For mobile node: queue transaction for user approval via TMA
            this.pendingTransactions.set(requestId, {
                event,
                timestamp: Date.now(),
                preview: event.preview,
            });
            (0, server_js_1.logActivity)(`Transaction request queued: ${requestId}`, 'info');
        });
        // Disconnect events
        this.kit.onDisconnect((event) => {
            this.state.connectedDApps = Math.max(0, this.state.connectedDApps - 1);
            (0, server_js_1.logActivity)(`dApp disconnected: ${event.walletAddress}`, 'info');
        });
    }
    // ─── Wallet Operations ───────────────────────────────────────
    /**
     * Send TON to an address
     */
    async sendTon(to, amountTon, comment) {
        if (!this.wallet || !this.kit)
            return null;
        try {
            const nanotons = BigInt(Math.floor(amountTon * 1e9));
            const txReq = {
                recipientAddress: to,
                transferAmount: nanotons.toString(),
            };
            if (comment)
                txReq.comment = comment;
            const tx = await this.wallet.createTransferTonTransaction(txReq);
            await this.kit.handleNewTransaction(this.wallet, tx);
            (0, server_js_1.logActivity)(`TON sent: ${amountTon} TON → ${to.slice(0, 8)}...`, 'success');
            return 'pending';
        }
        catch (err) {
            (0, server_js_1.logActivity)(`TON send failed: ${err.message}`, 'error');
            return null;
        }
    }
    /**
     * Send GSTD Jettons to an address
     */
    async sendGSTD(to, amount) {
        if (!this.wallet || !this.kit)
            return null;
        try {
            const rawAmount = BigInt(Math.floor(amount * 1e9)); // 9 decimals
            const txReq = {
                recipientAddress: to,
                jettonAddress: this.config.gstdJettonAddress,
                transferAmount: rawAmount.toString(),
                comment: 'GSTD Node Reward Claim',
            };
            const tx = await this.wallet.createTransferJettonTransaction(txReq);
            await this.kit.handleNewTransaction(this.wallet, tx);
            (0, server_js_1.logActivity)(`GSTD sent: ${amount} GSTD → ${to.slice(0, 8)}...`, 'success');
            return 'pending';
        }
        catch (err) {
            (0, server_js_1.logActivity)(`GSTD send failed: ${err.message}`, 'error');
            return null;
        }
    }
    /**
     * Handle a TON Connect deep link (QR code or tc:// URL)
     */
    async handleTonConnectUrl(url) {
        if (!this.kit)
            return false;
        try {
            await this.kit.handleTonConnectUrl(url);
            return true;
        }
        catch (err) {
            (0, server_js_1.logActivity)(`TON Connect URL failed: ${err.message}`, 'error');
            return false;
        }
    }
    /**
     * Refresh wallet balance
     */
    async refreshBalance() {
        if (!this.wallet)
            return this.state;
        try {
            const balance = await this.wallet.getBalance();
            this.state.balance.ton = (Number(balance) / 1e9).toFixed(4);
            // Try to get GSTD jetton balance 
            if (this.kit?.jettons) {
                const info = this.kit.jettons.getJettonInfo(this.config.gstdJettonAddress, this.config.network === 'testnet'
                    ? (await import('@ton/walletkit')).Network.testnet()
                    : (await import('@ton/walletkit')).Network.mainnet());
                if (info?.balance) {
                    this.state.balance.gstd = (Number(info.balance) / 1e9).toFixed(4);
                }
            }
        }
        catch (_e) { /* non-fatal */ }
        return { ...this.state };
    }
    // ─── Pending Requests (for TMA approval) ─────────────────────
    getPendingConnects() {
        return Array.from(this.pendingConnects.entries()).map(([id, data]) => ({
            id,
            dAppName: data.dAppName,
            timestamp: data.timestamp,
        }));
    }
    async approveConnect(requestId) {
        const pending = this.pendingConnects.get(requestId);
        if (!pending || !this.wallet || !this.kit)
            return false;
        try {
            pending.event.walletId = this.wallet.getWalletId();
            await this.kit.approveConnectRequest(pending.event);
            this.pendingConnects.delete(requestId);
            this.state.connectedDApps++;
            return true;
        }
        catch (_e) {
            return false;
        }
    }
    async rejectConnect(requestId) {
        const pending = this.pendingConnects.get(requestId);
        if (!pending || !this.kit)
            return false;
        try {
            await this.kit.rejectConnectRequest(pending.event, 'User rejected');
            this.pendingConnects.delete(requestId);
            return true;
        }
        catch (_e) {
            return false;
        }
    }
    getPendingTransactions() {
        return Array.from(this.pendingTransactions.entries()).map(([id, data]) => ({
            id,
            preview: data.preview,
            timestamp: data.timestamp,
        }));
    }
    async approveTransaction(requestId) {
        const pending = this.pendingTransactions.get(requestId);
        if (!pending || !this.kit)
            return false;
        try {
            await this.kit.approveTransactionRequest(pending.event);
            this.pendingTransactions.delete(requestId);
            return true;
        }
        catch (_e) {
            return false;
        }
    }
    async rejectTransaction(requestId) {
        const pending = this.pendingTransactions.get(requestId);
        if (!pending || !this.kit)
            return false;
        try {
            await this.kit.rejectTransactionRequest(pending.event, 'User rejected');
            this.pendingTransactions.delete(requestId);
            return true;
        }
        catch (_e) {
            return false;
        }
    }
    // ─── State ───────────────────────────────────────────────────
    getState() {
        return { ...this.state };
    }
    isReady() {
        return this.state.initialized && this.wallet !== null;
    }
    getAddress() {
        return this.state.address;
    }
    // ─── Helpers ─────────────────────────────────────────────────
    /**
     * Cleanup resources on shutdown
     */
    async close() {
        this.pendingConnects.clear();
        this.pendingTransactions.clear();
        this.kit = null;
        this.wallet = null;
        this.state.initialized = false;
    }
}
exports.TonConnectManager = TonConnectManager;
//# sourceMappingURL=tonconnect.js.map