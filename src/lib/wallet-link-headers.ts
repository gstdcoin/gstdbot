/**
 * Backend POST /api/v1/wallet/link-telegram and /wallet/link-external require
 * either a browser session or X-Wallet-Link-Secret matching server WALLET_LINK_SECRET.
 */
export function walletLinkHeaders(base: Record<string, string> = {}): Record<string, string> {
    const secret = process.env.WALLET_LINK_SECRET || process.env.GSTD_WALLET_LINK_SECRET || '';
    const h: Record<string, string> = { ...base, 'Content-Type': 'application/json' };
    if (secret) {
        h['X-Wallet-Link-Secret'] = secret;
    }
    return h;
}
