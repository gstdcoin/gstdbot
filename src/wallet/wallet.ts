/** Compatibility reader for watch-only node wallet metadata. */
import { existsSync, readFileSync, writeFileSync } from 'fs';
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
const API_BASE = process.env.GSTD_API_URL || 'https://app.gstdtoken.com/api/v1';

export function walletExists(): boolean {
    return existsSync(WALLET_FILE);
}

export function getWallet(): WalletConfig | null {
    try {
        const { address, publicKey, created, linkedTelegram, linkedExternalWallet } =
            JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
        if (typeof address !== 'string' || !address.trim()) return null;
        return { address, publicKey, created, linkedTelegram, linkedExternalWallet };
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

    try {
        const raw = JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
        if (raw.seed) return false; // Preserve older wallet files for owner-managed recovery.
        wallet.linkedExternalWallet = externalAddress;
        writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
        return true;
    } catch {
        return false;
    }
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
