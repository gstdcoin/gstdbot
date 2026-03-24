"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockchainManager = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const server_js_1 = require("../gateway/server.js");
// ─── GSTD Smart Contract Addresses (TON Mainnet) ────────────────
// GSTD Jetton Contract — deployed & verified on TON mainnet
// https://tonviewer.com/EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO
const CONTRACTS = {
    GSTD_TOKEN: process.env.GSTD_CONTRACT_TOKEN || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
    STAKING: process.env.GSTD_CONTRACT_STAKING || 'EQAIYlrr3UiMJ9fqI-B4j2nJdiiD7WzyaNL1MX_wiONc4OUi',
    SWARM_REWARDS: process.env.GSTD_CONTRACT_REWARDS || 'EQAIYlrr3UiMJ9fqI-B4j2nJdiiD7WzyaNL1MX_wiONc4OUi',
    DEX_POOL: process.env.GSTD_CONTRACT_DEX || 'EQDMb3DFJ8mshc67BL8CtKJG3Mfz5kZxjGhVygR2dz3-sGMM', // StonFi GSTD/TON
    GOVERNANCE: process.env.GSTD_CONTRACT_GOV || 'UQCkXFlNRsubUp7Uh7lg_ScUqLCiff1QCLsdQU0a7kphqQED', // Platform wallet
};
const PLATFORM_API = process.env.GSTD_API_URL || 'https://api.gstdtoken.com/api/v1';
// ─── Blockchain Manager ─────────────────────────────────────────
class BlockchainManager {
    walletAddress = null;
    walletSeed = null;
    transactions = [];
    cachedBalance = null;
    cachedPrice = null;
    stakingInfo;
    refreshTimer = null;
    configDir;
    constructor() {
        this.configDir = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot');
        this.stakingInfo = {
            staked: 0,
            apy: 12,
            rewardsPending: 0,
            rewardsTotal: 0,
            stakedSince: null,
            lockPeriodDays: 30,
            nextReward: null,
        };
    }
    async init() {
        // Load wallet
        const walletFile = (0, path_1.join)(this.configDir, 'wallet.json');
        if ((0, fs_1.existsSync)(walletFile)) {
            try {
                const data = JSON.parse((0, fs_1.readFileSync)(walletFile, 'utf-8'));
                this.walletAddress = data.address;
                // Seed is encrypted in wallet_seed.enc, not in wallet.json
            }
            catch (_e) { }
        }
        // Load transaction history
        const txFile = (0, path_1.join)(this.configDir, 'transactions.json');
        if ((0, fs_1.existsSync)(txFile)) {
            try {
                this.transactions = JSON.parse((0, fs_1.readFileSync)(txFile, 'utf-8'));
            }
            catch (_e) {
                this.transactions = [];
            }
        }
        // Load staking info
        const stakeFile = (0, path_1.join)(this.configDir, 'staking.json');
        if ((0, fs_1.existsSync)(stakeFile)) {
            try {
                this.stakingInfo = JSON.parse((0, fs_1.readFileSync)(stakeFile, 'utf-8'));
            }
            catch (_e) { }
        }
        // Refresh balance and price
        await this.refreshBalance();
        await this.refreshPrice();
        // Auto-refresh every 5 minutes
        this.refreshTimer = setInterval(async () => {
            await this.refreshBalance();
            await this.refreshPrice();
            this.calculateStakingRewards();
        }, 5 * 60 * 1000);
        console.log('    Blockchain: ' + (this.walletAddress ? this.walletAddress.slice(0, 12) + '...' : 'no wallet'));
    }
    async close() {
        if (this.refreshTimer)
            clearInterval(this.refreshTimer);
        this.saveTransactions();
    }
    // ─── Balance ─────────────────────────────────────────────────
    async getBalance() {
        if (this.cachedBalance)
            return { ...this.cachedBalance };
        await this.refreshBalance();
        return this.cachedBalance || { gstd: 0, ton: 0, staked: 0, pending: 0, totalEarned: 0, totalSpent: 0 };
    }
    async refreshBalance() {
        if (!this.walletAddress)
            return;
        try {
            const resp = await fetch(`${PLATFORM_API}/wallet/${this.walletAddress}/balance`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
            if (resp?.ok) {
                const data = await resp.json();
                this.cachedBalance = {
                    gstd: data.gstd || 0,
                    ton: data.ton || 0,
                    staked: data.staked || this.stakingInfo.staked,
                    pending: data.pending || 0,
                    totalEarned: data.total_earned || 0,
                    totalSpent: data.total_spent || 0,
                };
            }
        }
        catch (_e) { }
    }
    // ─── Price ───────────────────────────────────────────────────
    async getPrice() {
        if (this.cachedPrice)
            return { ...this.cachedPrice };
        await this.refreshPrice();
        return this.cachedPrice || {
            usd: 0.001,
            ton: 0.0001,
            change24h: 0,
            marketCap: 0,
            volume24h: 0,
            lastUpdated: new Date().toISOString(),
        };
    }
    async refreshPrice() {
        try {
            const resp = await fetch(`${PLATFORM_API}/market/price`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
            if (resp?.ok) {
                const data = await resp.json();
                this.cachedPrice = {
                    usd: data.price_usd || data.usd || 0.001,
                    ton: data.price_ton || data.ton || 0.0001,
                    change24h: data.change_24h || 0,
                    marketCap: data.market_cap || 0,
                    volume24h: data.volume_24h || 0,
                    lastUpdated: new Date().toISOString(),
                };
            }
        }
        catch (_e) { }
    }
    // ─── Transfer GSTD ──────────────────────────────────────────
    async transfer(toAddress, amount, memo) {
        if (!this.walletAddress || !this.walletSeed) {
            (0, server_js_1.logActivity)('Transfer failed: no wallet configured', 'error');
            return null;
        }
        if (amount <= 0)
            return null;
        const balance = await this.getBalance();
        if (balance.gstd < amount) {
            (0, server_js_1.logActivity)(`Transfer failed: insufficient GSTD (${balance.gstd} < ${amount})`, 'error');
            return null;
        }
        const tx = {
            hash: 'tx_' + (0, crypto_1.randomBytes)(16).toString('hex'),
            type: 'transfer_out',
            amount,
            token: 'GSTD',
            from: this.walletAddress,
            to: toAddress,
            timestamp: new Date().toISOString(),
            status: 'pending',
            description: memo || `Transfer ${amount} GSTD`,
        };
        this.transactions.unshift(tx);
        try {
            // Submit to platform for on-chain processing
            const resp = await fetch(`${PLATFORM_API}/wallet/transfer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                },
                body: JSON.stringify({
                    to: toAddress,
                    amount,
                    description: memo || `Transfer ${amount} GSTD`,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (resp.ok) {
                const result = await resp.json();
                tx.status = 'confirmed';
                tx.hash = result.hash || tx.hash;
                tx.blockHeight = result.block_height;
                (0, server_js_1.logActivity)(`Sent ${amount} GSTD to ${toAddress.slice(0, 10)}...`, 'success');
            }
            else {
                tx.status = 'failed';
                (0, server_js_1.logActivity)('Transfer failed: platform rejected', 'error');
            }
        }
        catch (e) {
            tx.status = 'failed';
            (0, server_js_1.logActivity)('Transfer failed: ' + (e.message || 'network error'), 'error');
        }
        this.saveTransactions();
        return tx;
    }
    // ─── Staking ─────────────────────────────────────────────────
    async stake(amount) {
        if (!this.walletAddress)
            return false;
        const balance = await this.getBalance();
        if (balance.gstd < amount) {
            (0, server_js_1.logActivity)(`Stake failed: insufficient GSTD (${balance.gstd} < ${amount})`, 'error');
            return false;
        }
        try {
            const resp = await fetch(`${PLATFORM_API}/staking/stake`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                },
                body: JSON.stringify({ amount }),
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                this.stakingInfo.staked += amount;
                this.stakingInfo.stakedSince = this.stakingInfo.stakedSince || new Date().toISOString();
                this.saveStaking();
                const tx = {
                    hash: 'tx_' + (0, crypto_1.randomBytes)(16).toString('hex'),
                    type: 'stake',
                    amount,
                    token: 'GSTD',
                    from: this.walletAddress,
                    to: CONTRACTS.STAKING,
                    timestamp: new Date().toISOString(),
                    status: 'confirmed',
                    description: `Staked ${amount} GSTD (APY: ${this.stakingInfo.apy}%)`,
                };
                this.transactions.unshift(tx);
                this.saveTransactions();
                (0, server_js_1.logActivity)(`Staked ${amount} GSTD (APY: ${this.stakingInfo.apy}%)`, 'success');
                return true;
            }
        }
        catch (_e) { }
        (0, server_js_1.logActivity)('Staking failed', 'error');
        return false;
    }
    async unstake(amount) {
        if (!this.walletAddress)
            return false;
        if (this.stakingInfo.staked < amount)
            return false;
        try {
            const resp = await fetch(`${PLATFORM_API}/staking/unstake`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                },
                body: JSON.stringify({ amount }),
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                this.stakingInfo.staked -= amount;
                if (this.stakingInfo.staked <= 0) {
                    this.stakingInfo.staked = 0;
                    this.stakingInfo.stakedSince = null;
                }
                this.saveStaking();
                const tx = {
                    hash: 'tx_' + (0, crypto_1.randomBytes)(16).toString('hex'),
                    type: 'unstake',
                    amount,
                    token: 'GSTD',
                    from: CONTRACTS.STAKING,
                    to: this.walletAddress,
                    timestamp: new Date().toISOString(),
                    status: 'confirmed',
                    description: `Unstaked ${amount} GSTD`,
                };
                this.transactions.unshift(tx);
                this.saveTransactions();
                (0, server_js_1.logActivity)(`Unstaked ${amount} GSTD`, 'success');
                return true;
            }
        }
        catch (_e) { }
        return false;
    }
    calculateStakingRewards() {
        if (this.stakingInfo.staked <= 0 || !this.stakingInfo.stakedSince)
            return;
        const daysSinceStake = (Date.now() - new Date(this.stakingInfo.stakedSince).getTime()) / 86400000;
        const dailyRate = this.stakingInfo.apy / 365 / 100;
        const pendingReward = this.stakingInfo.staked * dailyRate * daysSinceStake;
        this.stakingInfo.rewardsPending = Math.round(pendingReward * 10000) / 10000;
    }
    getStakingInfo() {
        this.calculateStakingRewards();
        return { ...this.stakingInfo };
    }
    // ─── Transaction History ─────────────────────────────────────
    getTransactions(limit = 50, type) {
        let txs = this.transactions;
        if (type)
            txs = txs.filter(t => t.type === type);
        return txs.slice(0, limit);
    }
    recordEarning(amount, description) {
        if (!this.walletAddress)
            return;
        const tx = {
            hash: 'tx_' + (0, crypto_1.randomBytes)(16).toString('hex'),
            type: 'earn',
            amount,
            token: 'GSTD',
            from: CONTRACTS.SWARM_REWARDS,
            to: this.walletAddress,
            timestamp: new Date().toISOString(),
            status: 'confirmed',
            description,
        };
        this.transactions.unshift(tx);
        if (this.transactions.length > 1000)
            this.transactions.length = 1000;
        this.saveTransactions();
    }
    // ─── Full Blockchain Status ──────────────────────────────────
    async getFullStatus() {
        const [balance, price, staking] = await Promise.all([
            this.getBalance(),
            this.getPrice(),
            Promise.resolve(this.getStakingInfo()),
        ]);
        return {
            wallet: {
                address: this.walletAddress,
                connected: !!this.walletAddress,
            },
            balance,
            price,
            staking,
            transactions: this.getTransactions(20),
            contracts: CONTRACTS,
            valueUsd: balance.gstd * price.usd,
            valueTon: balance.gstd * price.ton,
        };
    }
    // ─── Persistence ─────────────────────────────────────────────
    saveTransactions() {
        try {
            (0, fs_1.writeFileSync)((0, path_1.join)(this.configDir, 'transactions.json'), JSON.stringify(this.transactions.slice(0, 1000), null, 2));
        }
        catch (_e) { }
    }
    saveStaking() {
        try {
            (0, fs_1.writeFileSync)((0, path_1.join)(this.configDir, 'staking.json'), JSON.stringify(this.stakingInfo, null, 2));
        }
        catch (_e) { }
    }
}
exports.BlockchainManager = BlockchainManager;
//# sourceMappingURL=token.js.map