"use strict";
/**
 * GSTD Node OS — Wallet Manager
 *
 * Full wallet management with:
 * - GSTD token tracking
 * - Earnings history
 * - Staking (future)
 * - TON integration (future)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeWallet = void 0;
exports.getWallet = getWallet;
exports.getBalance = getBalance;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const server_js_1 = require("../gateway/server.js");
// ─── Wallet Manager ─────────────────────────────────────────────
class NodeWallet {
    config;
    wallet = null;
    earnings = [];
    localBalance = { gstd: 0, ton: 0, pending: 0, totalEarned: 0 };
    configDir;
    walletFile;
    earningsFile;
    constructor(config) {
        this.config = config;
        this.configDir = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot');
        this.walletFile = (0, path_1.join)(this.configDir, 'wallet.json');
        this.earningsFile = (0, path_1.join)(this.configDir, 'earnings.json');
    }
    async init() {
        if (!(0, fs_1.existsSync)(this.configDir)) {
            (0, fs_1.mkdirSync)(this.configDir, { recursive: true });
        }
        // Load or create wallet
        if ((0, fs_1.existsSync)(this.walletFile)) {
            try {
                this.wallet = JSON.parse((0, fs_1.readFileSync)(this.walletFile, 'utf-8'));
                console.log('    Wallet: ' + this.wallet.address.slice(0, 12) + '...');
            }
            catch {
                this.createWallet();
            }
        }
        else {
            this.createWallet();
        }
        // Load earnings history
        if ((0, fs_1.existsSync)(this.earningsFile)) {
            try {
                this.earnings = JSON.parse((0, fs_1.readFileSync)(this.earningsFile, 'utf-8'));
            }
            catch {
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
    getAddress() {
        return this.wallet?.address || null;
    }
    getBalance() {
        return { ...this.localBalance };
    }
    getStats() {
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
    addEarning(amount, type, description, taskId) {
        const entry = {
            timestamp: new Date().toISOString(),
            amount,
            type,
            taskId,
            description,
        };
        this.earnings.unshift(entry);
        if (this.earnings.length > 1000)
            this.earnings.length = 1000;
        this.localBalance.totalEarned += amount;
        this.localBalance.gstd += amount;
        this.localBalance.pending += amount;
        (0, server_js_1.logActivity)(`+${amount.toFixed(4)} GSTD (${type}: ${description})`, 'success');
    }
    earnUptime() {
        const reward = 0.1; // 0.1 GSTD per hour of uptime
        this.addEarning(reward, 'uptime', '1 hour uptime reward');
    }
    // ─── Wallet CRUD ─────────────────────────────────────────────
    createWallet() {
        const seed = (0, crypto_1.randomBytes)(32).toString('hex');
        const addressHash = (0, crypto_1.createHash)('sha256').update(seed).digest('hex').slice(0, 32);
        const address = `UQ${addressHash}`;
        this.wallet = {
            address,
            seed,
            created: new Date().toISOString(),
        };
        (0, fs_1.writeFileSync)(this.walletFile, JSON.stringify(this.wallet, null, 2));
        console.log('    New wallet created: ' + address.slice(0, 12) + '...');
        (0, server_js_1.logActivity)('Wallet created: ' + address.slice(0, 16) + '...', 'success');
    }
    async refreshBalance() {
        if (!this.wallet)
            return;
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/wallet/${this.wallet.address}/balance`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
            if (resp?.ok) {
                const data = await resp.json();
                this.localBalance = {
                    gstd: data.gstd || 0,
                    ton: data.ton || 0,
                    pending: data.pending || 0,
                    totalEarned: data.total_earned || 0,
                };
            }
        }
        catch { }
    }
    saveEarnings() {
        try {
            (0, fs_1.writeFileSync)(this.earningsFile, JSON.stringify(this.earnings, null, 2));
        }
        catch { }
    }
}
exports.NodeWallet = NodeWallet;
// ─── Legacy compatibility exports ────────────────────────────────
function getWallet() {
    const walletFile = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot', 'wallet.json');
    if (!(0, fs_1.existsSync)(walletFile))
        return null;
    try {
        return JSON.parse((0, fs_1.readFileSync)(walletFile, 'utf-8'));
    }
    catch {
        return null;
    }
}
function getBalance() {
    const wallet = getWallet();
    if (!wallet)
        return Promise.resolve({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 });
    return fetch(`https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/balance`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : { gstd: 0, ton: 0, pending: 0, totalEarned: 0 })
        .then((d) => ({ gstd: d.gstd || 0, ton: d.ton || 0, pending: d.pending || 0, totalEarned: d.total_earned || 0 }))
        .catch(() => ({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 }));
}
//# sourceMappingURL=manager.js.map