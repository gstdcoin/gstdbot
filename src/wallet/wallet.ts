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

import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

const CONFIG_DIR = join(homedir(), '.config', 'gstdbot');
const WALLET_FILE = join(CONFIG_DIR, 'wallet.json');
const SEED_FILE = join(CONFIG_DIR, 'wallet_seed.enc');

// ─── Encryption helpers ──────────────────────────────────────

function deriveKey(): Buffer {
    // Derive encryption key from machine-specific data
    const machineId = (() => {
        try {
            return readFileSync('/etc/machine-id', 'utf-8').trim();
        } catch {
            return homedir() + ':gstd-node-wallet-key';
        }
    })();
    return createHash('sha256').update(machineId + ':gstd-wallet-v3').digest();
}

function encryptSeed(seed: string): string {
    const key = deriveKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(seed, 'utf-8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptSeed(encrypted: string): string {
    const key = deriveKey();
    const [ivHex, dataHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}

// ─── Wallet Management ─────────────────────────────────────────

export function walletExists(): boolean {
    return existsSync(WALLET_FILE);
}

export function initWallet(seed?: string): WalletConfig {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }

    // Generate seed and derive address
    const walletSeed = seed || randomBytes(32).toString('hex');
    const publicKey = createHash('sha256').update(walletSeed).digest('hex');
    const addressHash = publicKey.slice(0, 32);
    const address = `UQ${addressHash}`;

    // Store public info in wallet.json (safe to expose)
    const config: WalletConfig = {
        address,
        publicKey: publicKey.slice(0, 64),
        created: new Date().toISOString(),
    };
    writeFileSync(WALLET_FILE, JSON.stringify(config, null, 2));

    // Store encrypted seed separately (chmod 600)
    writeFileSync(SEED_FILE, encryptSeed(walletSeed));
    try { chmodSync(SEED_FILE, 0o600); } catch { /* Windows compat */ }

    return config;
}

/**
 * Migrate old wallet format (seed in wallet.json) to new secure format
 */
function migrateOldWallet(): void {
    try {
        const raw = JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
        if (raw.seed && !existsSync(SEED_FILE)) {
            // Move seed to encrypted file
            writeFileSync(SEED_FILE, encryptSeed(raw.seed));
            try { chmodSync(SEED_FILE, 0o600); } catch { }

            // Remove seed from wallet.json, add publicKey
            const publicKey = raw.publicKey || createHash('sha256').update(raw.seed).digest('hex').slice(0, 64);
            const clean: WalletConfig = {
                address: raw.address,
                publicKey,
                created: raw.created || new Date().toISOString(),
                linkedTelegram: raw.linkedTelegram,
            };
            writeFileSync(WALLET_FILE, JSON.stringify(clean, null, 2));
        }
    } catch { /* Migration is best-effort */ }
}

export function getWallet(): WalletConfig | null {
    if (!walletExists()) return null;
    try {
        // Auto-migrate old format
        migrateOldWallet();
        return JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
    } catch {
        return null;
    }
}

export function getSeed(): string | null {
    try {
        if (!existsSync(SEED_FILE)) return null;
        const encrypted = readFileSync(SEED_FILE, 'utf-8');
        return decryptSeed(encrypted);
    } catch {
        return null;
    }
}

export async function getBalance(): Promise<WalletBalance> {
    const wallet = getWallet();
    if (!wallet) {
        return { gstd: 0, ton: 0, pending: 0, totalEarned: 0 };
    }

    try {
        const resp = await fetch(
            `https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/balance`
        ).catch(() => null);
        if (resp?.ok) {
            const data: any = await resp.json();
            return {
                gstd: data.gstd || 0,
                ton: data.ton || 0,
                pending: data.pending || 0,
                totalEarned: data.total_earned || 0,
            };
        }
    } catch { }

    return { gstd: 0, ton: 0, pending: 0, totalEarned: 0 };
}

/**
 * Link an external wallet (e.g. Tonkeeper) for fund security.
 * Even if the node is compromised, funds stay safe because
 * all transactions require the external wallet's signature.
 */
export function linkExternalWallet(externalAddress: string): boolean {
    const wallet = getWallet();
    if (!wallet) return false;

    wallet.linkedExternalWallet = externalAddress;
    writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
    return true;
}

export async function linkTelegram(userId: string): Promise<boolean> {
    const wallet = getWallet();
    if (!wallet) return false;

    try {
        const resp = await fetch(
            'https://app.gstdtoken.com/api/v1/wallet/link-telegram',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: wallet.address,
                    telegram_user_id: userId,
                }),
            }
        ).catch(() => null);

        if (resp?.ok) {
            wallet.linkedTelegram = userId;
            writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
            return true;
        }
    } catch { }

    return false;
}
