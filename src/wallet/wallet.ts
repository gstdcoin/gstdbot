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

import { walletLinkHeaders } from '../lib/wallet-link-headers.js';

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
const API_BASE = process.env.GSTD_API_URL || 'https://app.gstdtoken.com/api/v1';

// ─── Encryption helpers ──────────────────────────────────────

function deriveKey(): Buffer {
    // Derive encryption key from machine-specific data
    const machineId = (() => {
        try {
            return readFileSync('/etc/machine-id', 'utf-8').trim();
        } catch (_e) {
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

    // Real Ed25519 keypair derived from the seed — @ton/crypto's
    // keyPairFromSeed(), the same primitive TON's own wallet contracts and
    // this codebase's P2P attestor identity (src/p2p/identity.ts) use.
    // Previously this used SHA256(seed || "ton-pubkey") as a stand-in
    // "public key" fed straight into WalletContractV4.create() — that
    // produces a valid-looking address, but since it was never derived
    // from a real keypair, no private key exists that could ever sign a
    // transaction from it. Any funds sent there would be permanently
    // unspendable. Existing nodes are unaffected: initWallet() only runs
    // on first setup (see manager.ts's init()) — an already-created
    // wallet.json is loaded as-is on every later run, so this only
    // changes address generation for new node installs going forward.
    const { keyPairFromSeed } = require('@ton/crypto');
    const { WalletContractV4 } = require('@ton/ton');

    const walletSeed = seed || randomBytes(32).toString('hex');
    const seedBuf = createHash('sha256').update(walletSeed).digest(); // exactly 32 bytes
    const keyPair = keyPairFromSeed(seedBuf);
    const publicKeyHex = keyPair.publicKey.toString('hex');

    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const address = wallet.address.toString({ bounceable: false, testOnly: false });

    // Store public info in wallet.json (safe to expose)
    const config: WalletConfig = {
        address,
        publicKey: publicKeyHex!,
        created: new Date().toISOString(),
    };
    writeFileSync(WALLET_FILE, JSON.stringify(config, null, 2));

    // Store encrypted seed separately (chmod 600)
    writeFileSync(SEED_FILE, encryptSeed(walletSeed!));
    try { chmodSync(SEED_FILE, 0o600); } catch (_e) { /* Windows compat */ }

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
            try { chmodSync(SEED_FILE, 0o600); } catch (_e) { }

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
    } catch (_e) { /* Migration is best-effort */ }
}

export function getWallet(): WalletConfig | null {
    if (!walletExists()) return null;
    try {
        // Auto-migrate old format
        migrateOldWallet();
        return JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
    } catch (_e) {
        return null;
    }
}

export function getSeed(): string | null {
    try {
        if (!existsSync(SEED_FILE)) return null;
        const encrypted = readFileSync(SEED_FILE, 'utf-8');
        return decryptSeed(encrypted);
    } catch (_e) {
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
            `${API_BASE}/wallet/${wallet.address}/balance`
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
    } catch (_e) { }

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
            `${API_BASE}/wallet/link-telegram`,
            {
                method: 'POST',
                headers: walletLinkHeaders(),
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
    } catch (_e) { }

    return false;
}
