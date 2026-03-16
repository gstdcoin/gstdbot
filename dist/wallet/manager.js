"use strict";
/**
 * GSTD Node OS — Wallet Manager
 *
 * Security model:
 * - wallet.json stores ONLY address + publicKey (safe to expose)
 * - Seed is encrypted in wallet_seed.enc (AES-256-CBC, chmod 600)
 * - Even if node is hacked, funds are safe without real wallet
 * - All financial operations require external wallet signature
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWallet = exports.NodeWallet = void 0;
exports.getBalance = getBalance;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const server_js_1 = require("../gateway/server.js");
const wallet_js_1 = require("./wallet.js");
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
            catch (_e) {
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
            catch (_e) {
                this.earnings = [];
            }
        }
        // Fetch real balance from platform
        await this.refreshBalance();
        // NOTE: Heartbeat is handled by SwarmAgent (swarm/agent.ts) — no duplicate here.
        // Only wallet-level balance refresh and earnings persistence below.
        // Refresh balance from platform every 5 minutes
        setInterval(() => this.refreshBalance(), 5 * 60 * 1000);
        // Save earnings log periodically
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
                apy: 0,
                rewardsPending: 0,
            },
        };
    }
    // ─── Record verified earning (only called after backend confirms) ──
    recordVerifiedEarning(amount, type, description, taskId) {
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
        (0, server_js_1.logActivity)(`+${amount.toFixed(4)} GSTD (${type}: ${description}) [verified]`, 'success');
    }
    /**
     * Send heartbeat to backend — backend decides reward based on
     * uptime, node status, and available reward pool.
     * Node does NOT self-award tokens.
     */
    /**
     * Heartbeat is now centralized in SwarmAgent (swarm/agent.ts) to avoid
     * triple-sending (index.ts + agent.ts + wallet.ts all had their own).
     * The SwarmAgent calls wallet.recordVerifiedEarning() when backend
     * returns a reward.
     */
    // Track queries served for heartbeat reporting
    queriesServedSinceLastHeartbeat = 0;
    recordQueryServed() {
        this.queriesServedSinceLastHeartbeat++;
    }
    // ─── Wallet CRUD ─────────────────────────────────────────────
    createWallet() {
        // Use secure wallet module — seed encrypted separately
        this.wallet = (0, wallet_js_1.initWallet)();
        console.log('    New wallet created: ' + this.wallet.address.slice(0, 12) + '...');
        (0, server_js_1.logActivity)('Wallet created: ' + this.wallet.address.slice(0, 16) + '... (seed encrypted)', 'success');
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
        catch (_e) { }
    }
    saveEarnings() {
        try {
            (0, fs_1.writeFileSync)(this.earningsFile, JSON.stringify(this.earnings, null, 2));
        }
        catch (_e) { }
    }
    /**
     * Sync accumulated local earnings to the backend so they appear in
     * the user's pending_balance_gstd and can be withdrawn.
     */
    unsyncedAmount = 0;
    async syncEarningsToBackend() {
        if (this.unsyncedAmount <= 0 || !this.wallet)
            return;
        const amount = this.unsyncedAmount;
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/api/v1/nodes/sync-earnings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet_address: this.wallet.address,
                    amount,
                    earning_type: 'node_sync',
                    description: `Node earnings sync (${amount.toFixed(4)} GSTD)`,
                }),
                signal: AbortSignal.timeout(10000),
            }).catch(() => null);
            if (resp?.ok) {
                this.unsyncedAmount = 0;
                (0, server_js_1.logActivity)(`Earnings synced to backend: ${amount.toFixed(4)} GSTD`, 'success');
            }
        }
        catch (_e) { }
    }
    /**
     * Link an external wallet (e.g. Tonkeeper) for receiving rewards.
     * This calls the backend to update the node's wallet_address so
     * all future rewards go to the external wallet.
     */
    async linkExternal(externalAddress) {
        if (!this.wallet)
            return false;
        try {
            const { linkExternalWallet } = require('./wallet.js');
            linkExternalWallet(externalAddress);
            const resp = await fetch(`${this.config.swarm.apiUrl}/api/v1/wallet/link-external`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_address: this.wallet.address,
                    external_address: externalAddress,
                }),
                signal: AbortSignal.timeout(10000),
            }).catch(() => null);
            if (resp?.ok) {
                (0, server_js_1.logActivity)(`External wallet linked: ${externalAddress.slice(0, 12)}...`, 'success');
                return true;
            }
            // Fallback to node-binding endpoint used by Node OS flow.
            const bindResp = await fetch(`${this.config.swarm.apiUrl}/api/v1/nodes/bind-wallet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: process.env.GSTD_NODE_ID || `node-${process.pid}`,
                    owner_wallet: externalAddress,
                    node_address: this.wallet.address,
                }),
                signal: AbortSignal.timeout(10000),
            }).catch(() => null);
            if (bindResp?.ok) {
                (0, server_js_1.logActivity)(`External wallet linked via nodes/bind-wallet: ${externalAddress.slice(0, 12)}...`, 'success');
                return true;
            }
        }
        catch (_e) { }
        return false;
    }
}
exports.NodeWallet = NodeWallet;
// ─── Legacy compatibility exports ────────────────────────────────
var wallet_js_2 = require("./wallet.js");
Object.defineProperty(exports, "getWallet", { enumerable: true, get: function () { return wallet_js_2.getWallet; } });
function getBalance() {
    const { getWallet: getW } = require('./wallet.js');
    const wallet = getW();
    if (!wallet)
        return Promise.resolve({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 });
    return fetch(`https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/balance`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : { gstd: 0, ton: 0, pending: 0, totalEarned: 0 })
        .then((d) => ({ gstd: d.gstd || 0, ton: d.ton || 0, pending: d.pending || 0, totalEarned: d.total_earned || 0 }))
        .catch(() => ({ gstd: 0, ton: 0, pending: 0, totalEarned: 0 }));
}
//# sourceMappingURL=manager.js.map