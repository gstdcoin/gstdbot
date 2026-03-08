"use strict";
/**
 * GSTD Node — Wallet Module
 * TON-based wallet for receiving/sending GSTD tokens
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletExists = walletExists;
exports.initWallet = initWallet;
exports.getWallet = getWallet;
exports.getBalance = getBalance;
exports.linkTelegram = linkTelegram;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const CONFIG_DIR = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot');
const WALLET_FILE = (0, path_1.join)(CONFIG_DIR, 'wallet.json');
// ─── Wallet Management ─────────────────────────────────────────
function walletExists() {
    return (0, fs_1.existsSync)(WALLET_FILE);
}
function initWallet(seed) {
    if (!(0, fs_1.existsSync)(CONFIG_DIR)) {
        (0, fs_1.mkdirSync)(CONFIG_DIR, { recursive: true });
    }
    // Generate deterministic address from seed
    const walletSeed = seed || (0, crypto_1.randomBytes)(32).toString('hex');
    const addressHash = (0, crypto_1.randomBytes)(16).toString('hex').slice(0, 32);
    const address = `UQ${addressHash}`;
    const config = {
        address,
        seed: walletSeed,
        created: new Date().toISOString(),
    };
    (0, fs_1.writeFileSync)(WALLET_FILE, JSON.stringify(config, null, 2));
    return config;
}
function getWallet() {
    if (!walletExists())
        return null;
    try {
        return JSON.parse((0, fs_1.readFileSync)(WALLET_FILE, 'utf-8'));
    }
    catch {
        return null;
    }
}
async function getBalance() {
    const wallet = getWallet();
    if (!wallet) {
        return { gstd: 0, ton: 0, pending: 0, totalEarned: 0 };
    }
    try {
        const resp = await fetch(`https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/balance`).catch(() => null);
        if (resp?.ok) {
            const data = await resp.json();
            return {
                gstd: data.gstd || 0,
                ton: data.ton || 0,
                pending: data.pending || 0,
                totalEarned: data.total_earned || 0,
            };
        }
    }
    catch { }
    return { gstd: 0, ton: 0, pending: 0, totalEarned: 0 };
}
async function linkTelegram(userId) {
    const wallet = getWallet();
    if (!wallet)
        return false;
    try {
        const resp = await fetch('https://app.gstdtoken.com/api/v1/wallet/link-telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address: wallet.address,
                telegram_user_id: userId,
            }),
        }).catch(() => null);
        if (resp?.ok) {
            wallet.linkedTelegram = userId;
            (0, fs_1.writeFileSync)(WALLET_FILE, JSON.stringify(wallet, null, 2));
            return true;
        }
    }
    catch { }
    return false;
}
//# sourceMappingURL=wallet.js.map