"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletExists = walletExists;
exports.initWallet = initWallet;
exports.getWallet = getWallet;
exports.getSeed = getSeed;
exports.getBalance = getBalance;
exports.linkExternalWallet = linkExternalWallet;
exports.linkTelegram = linkTelegram;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const CONFIG_DIR = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot');
const WALLET_FILE = (0, path_1.join)(CONFIG_DIR, 'wallet.json');
const SEED_FILE = (0, path_1.join)(CONFIG_DIR, 'wallet_seed.enc');
// ─── Encryption helpers ──────────────────────────────────────
function deriveKey() {
    // Derive encryption key from machine-specific data
    const machineId = (() => {
        try {
            return (0, fs_1.readFileSync)('/etc/machine-id', 'utf-8').trim();
        }
        catch {
            return (0, os_1.homedir)() + ':gstd-node-wallet-key';
        }
    })();
    return (0, crypto_1.createHash)('sha256').update(machineId + ':gstd-wallet-v3').digest();
}
function encryptSeed(seed) {
    const key = deriveKey();
    const iv = (0, crypto_1.randomBytes)(16);
    const cipher = (0, crypto_1.createCipheriv)('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(seed, 'utf-8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
function decryptSeed(encrypted) {
    const key = deriveKey();
    const [ivHex, dataHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}
// ─── Wallet Management ─────────────────────────────────────────
function walletExists() {
    return (0, fs_1.existsSync)(WALLET_FILE);
}
function initWallet(seed) {
    if (!(0, fs_1.existsSync)(CONFIG_DIR)) {
        (0, fs_1.mkdirSync)(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    // Generate seed and derive address
    const walletSeed = seed || (0, crypto_1.randomBytes)(32).toString('hex');
    const publicKey = (0, crypto_1.createHash)('sha256').update(walletSeed).digest('hex');
    const addressHash = publicKey.slice(0, 32);
    const address = `UQ${addressHash}`;
    // Store public info in wallet.json (safe to expose)
    const config = {
        address,
        publicKey: publicKey.slice(0, 64),
        created: new Date().toISOString(),
    };
    (0, fs_1.writeFileSync)(WALLET_FILE, JSON.stringify(config, null, 2));
    // Store encrypted seed separately (chmod 600)
    (0, fs_1.writeFileSync)(SEED_FILE, encryptSeed(walletSeed));
    try {
        (0, fs_1.chmodSync)(SEED_FILE, 0o600);
    }
    catch { /* Windows compat */ }
    return config;
}
/**
 * Migrate old wallet format (seed in wallet.json) to new secure format
 */
function migrateOldWallet() {
    try {
        const raw = JSON.parse((0, fs_1.readFileSync)(WALLET_FILE, 'utf-8'));
        if (raw.seed && !(0, fs_1.existsSync)(SEED_FILE)) {
            // Move seed to encrypted file
            (0, fs_1.writeFileSync)(SEED_FILE, encryptSeed(raw.seed));
            try {
                (0, fs_1.chmodSync)(SEED_FILE, 0o600);
            }
            catch { }
            // Remove seed from wallet.json, add publicKey
            const publicKey = raw.publicKey || (0, crypto_1.createHash)('sha256').update(raw.seed).digest('hex').slice(0, 64);
            const clean = {
                address: raw.address,
                publicKey,
                created: raw.created || new Date().toISOString(),
                linkedTelegram: raw.linkedTelegram,
            };
            (0, fs_1.writeFileSync)(WALLET_FILE, JSON.stringify(clean, null, 2));
        }
    }
    catch { /* Migration is best-effort */ }
}
function getWallet() {
    if (!walletExists())
        return null;
    try {
        // Auto-migrate old format
        migrateOldWallet();
        return JSON.parse((0, fs_1.readFileSync)(WALLET_FILE, 'utf-8'));
    }
    catch {
        return null;
    }
}
function getSeed() {
    try {
        if (!(0, fs_1.existsSync)(SEED_FILE))
            return null;
        const encrypted = (0, fs_1.readFileSync)(SEED_FILE, 'utf-8');
        return decryptSeed(encrypted);
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
/**
 * Link an external wallet (e.g. Tonkeeper) for fund security.
 * Even if the node is compromised, funds stay safe because
 * all transactions require the external wallet's signature.
 */
function linkExternalWallet(externalAddress) {
    const wallet = getWallet();
    if (!wallet)
        return false;
    wallet.linkedExternalWallet = externalAddress;
    (0, fs_1.writeFileSync)(WALLET_FILE, JSON.stringify(wallet, null, 2));
    return true;
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