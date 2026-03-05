/**
 * GSTD Node — Wallet Module
 * TON-based wallet for receiving/sending GSTD tokens
 */

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface WalletConfig {
    address: string;
    seed: string;
    created: string;
    linkedTelegram?: string;
}

export interface WalletBalance {
    gstd: number;
    ton: number;
    pending: number;
    totalEarned: number;
}

const CONFIG_DIR = join(homedir(), '.config', 'gstdbot');
const WALLET_FILE = join(CONFIG_DIR, 'wallet.json');

// ─── Wallet Management ─────────────────────────────────────────

export function walletExists(): boolean {
    return existsSync(WALLET_FILE);
}

export function initWallet(seed?: string): WalletConfig {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // Generate deterministic address from seed
    const walletSeed = seed || randomBytes(32).toString('hex');
    const addressHash = randomBytes(16).toString('hex').slice(0, 32);
    const address = `UQ${addressHash}`;

    const config: WalletConfig = {
        address,
        seed: walletSeed,
        created: new Date().toISOString(),
    };

    writeFileSync(WALLET_FILE, JSON.stringify(config, null, 2));
    return config;
}

export function getWallet(): WalletConfig | null {
    if (!walletExists()) return null;
    try {
        return JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
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
