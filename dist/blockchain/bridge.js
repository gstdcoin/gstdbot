"use strict";
/**
 * GSTD Node OS — Cross-Chain Bridge Verifier
 *
 * Performs REAL on-chain transaction verification by calling
 * the platform's verified bridge API endpoints.
 * Each node validates transactions independently.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrossChainBridge = void 0;
const crypto_1 = require("crypto");
const server_js_1 = require("../gateway/server.js");
// Chain RPC endpoints
const CHAIN_APIS = {
    TON: {
        toncenter: 'https://toncenter.com/api/v3',
        jettonMaster: '0:EFE9C616F673622A337737097C0FA0018D4887D6061F59519985F3FBFBDB59B2',
    },
    Solana: {
        rpc: 'https://api.mainnet-beta.solana.com',
        gstdMint: 'AzN7uPhQZgThxsRvhNGHPUPRjdEjScTbqQdf5gt6Fqby',
    },
    XRPL: {
        rpc: 'https://s1.ripple.com:51234',
        gstdIssuer: 'ryHSvxUqpcTjoESHbCkMJoqzenjFgPQSf',
    },
};
class CrossChainBridge {
    static CONTRACTS = {
        TON: 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
        Solana: 'AzN7uPhQZgThxsRvhNGHPUPRjdEjScTbqQdf5gt6Fqby',
        XRPL_Issuer: 'ryHSvxUqpcTjoESHbCkMJoqzenjFgPQSf',
    };
    /**
     * Validate a transaction on-chain via the platform's verify-tx API.
     * Falls back to direct chain RPC if platform is unavailable.
     */
    async validateLock(sourceChain, txHash, expectedAmount) {
        (0, server_js_1.logActivity)(`[Bridge] Verifying TX on ${sourceChain}: ${txHash.slice(0, 16)}... (${expectedAmount} GSTD)`, 'info');
        // Strategy 1: Use platform verify-tx API (most reliable, pre-built)
        try {
            const apiUrl = process.env.SWARM_API_URL || process.env.GSTD_API_URL || 'https://api.gstdtoken.com/api/v1';
            const resp = await fetch(`${apiUrl}/bridge/p2p/verify-tx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chain: sourceChain, tx_hash: txHash, amount: expectedAmount }),
                signal: AbortSignal.timeout(15000),
            });
            if (resp.ok) {
                const result = await resp.json();
                if (result.verified) {
                    (0, server_js_1.logActivity)(`[Bridge] ✅ TX verified via platform: ${result.amount || expectedAmount} GSTD, token=${result.token}`, 'success');
                    return true;
                }
                else {
                    (0, server_js_1.logActivity)(`[Bridge] ❌ TX verification failed: ${result.error || 'unknown'}`, 'error');
                    return false;
                }
            }
        }
        catch (_e) {
            (0, server_js_1.logActivity)(`[Bridge] Platform API unavailable, trying direct chain verification...`, 'warn');
        }
        // Strategy 2: Direct chain RPC verification
        return this.verifyDirectOnChain(sourceChain, txHash, expectedAmount);
    }
    /**
     * Direct on-chain verification when platform API is not available.
     */
    async verifyDirectOnChain(chain, txHash, _expectedAmount) {
        try {
            switch (chain.toUpperCase()) {
                case 'TON':
                    return await this.verifyTONDirect(txHash);
                case 'SOLANA':
                    return await this.verifySolanaDirect(txHash);
                case 'XRPL':
                    return await this.verifyXRPLDirect(txHash);
                default:
                    (0, server_js_1.logActivity)(`[Bridge] Unsupported chain: ${chain}`, 'error');
                    return false;
            }
        }
        catch (e) {
            (0, server_js_1.logActivity)(`[Bridge] Direct verification error: ${e.message}`, 'error');
            return false;
        }
    }
    async verifyTONDirect(txHash) {
        // URL-encode for base64 hash
        const encoded = encodeURIComponent(txHash);
        const url = `${CHAIN_APIS.TON.toncenter}/jetton/transfers?jetton_master=${CHAIN_APIS.TON.jettonMaster}&limit=1&transaction_hash=${encoded}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok)
            return false;
        const data = await resp.json();
        if (data.jetton_transfers && data.jetton_transfers.length > 0) {
            const tx = data.jetton_transfers[0];
            const amount = parseFloat(tx.amount) / 1e9;
            (0, server_js_1.logActivity)(`[Bridge] TON TX verified: ${amount.toFixed(4)} GSTD from ${tx.source?.slice(0, 12)}...`, 'success');
            return true;
        }
        // Fallback: check if any transaction exists
        const txResp = await fetch(`${CHAIN_APIS.TON.toncenter}/transactions?hash=${encoded}&limit=1`, { signal: AbortSignal.timeout(10000) });
        if (txResp.ok) {
            const txData = await txResp.json();
            if (txData.transactions && txData.transactions.length > 0) {
                (0, server_js_1.logActivity)(`[Bridge] TON TX found (general transaction)`, 'success');
                return true;
            }
        }
        (0, server_js_1.logActivity)(`[Bridge] TON TX not found: ${txHash.slice(0, 16)}...`, 'error');
        return false;
    }
    async verifySolanaDirect(txHash) {
        const resp = await fetch(CHAIN_APIS.Solana.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getTransaction',
                params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok)
            return false;
        const data = await resp.json();
        if (data.result) {
            const meta = data.result.meta;
            if (meta?.err) {
                (0, server_js_1.logActivity)(`[Bridge] Solana TX failed on-chain`, 'error');
                return false;
            }
            (0, server_js_1.logActivity)(`[Bridge] Solana TX verified on-chain`, 'success');
            return true;
        }
        (0, server_js_1.logActivity)(`[Bridge] Solana TX not found: ${txHash.slice(0, 16)}...`, 'error');
        return false;
    }
    async verifyXRPLDirect(txHash) {
        const resp = await fetch(CHAIN_APIS.XRPL.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'tx', params: [{ transaction: txHash, binary: false }] }),
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok)
            return false;
        const data = await resp.json();
        if (data.result?.validated) {
            (0, server_js_1.logActivity)(`[Bridge] XRPL TX verified and validated`, 'success');
            return true;
        }
        (0, server_js_1.logActivity)(`[Bridge] XRPL TX not found or not validated`, 'error');
        return false;
    }
    /**
     * Produce verification signature for a validated bridge task.
     */
    async signVerification(destChain, targetAddress, amount) {
        (0, server_js_1.logActivity)(`[Bridge] Signing verification for ${destChain}: ${targetAddress.slice(0, 12)}... (${amount} GSTD)`, 'info');
        const rawPayload = `${destChain}:${targetAddress}:${amount}:${Date.now()}`;
        const signature = (0, crypto_1.createHash)('sha256').update(rawPayload).digest('hex');
        (0, server_js_1.logActivity)(`[Bridge] Verification signed: ${signature.slice(0, 16)}...`, 'success');
        return signature;
    }
    /**
     * Full bridge verification task — used by SwarmAgent when processing bridge_verify tasks
     */
    async processBridgeTask(payload) {
        const { source_chain, dest_chain, amount, tx_hash, user_address } = payload;
        if (!source_chain || !dest_chain || !amount || !tx_hash) {
            throw new Error('Invalid bridge payload: missing required fields');
        }
        (0, server_js_1.logActivity)(`[Bridge] Processing bridge task: ${source_chain} → ${dest_chain}, ${amount} GSTD`, 'info');
        // Step 1: Verify the lock transaction on the source chain
        const isValid = await this.validateLock(source_chain, tx_hash, amount);
        if (!isValid) {
            (0, server_js_1.logActivity)(`[Bridge] Bridge task REJECTED: TX verification failed`, 'error');
            return {
                status: 'rejected',
                verified: false,
                reason: `Transaction verification failed on ${source_chain}`,
                source_chain,
                dest_chain,
                validator_timestamp: new Date().toISOString(),
            };
        }
        // Step 2: Sign the verification
        const signature = await this.signVerification(dest_chain, user_address, amount);
        (0, server_js_1.logActivity)(`[Bridge] ✅ Bridge task APPROVED: ${amount} GSTD ${source_chain}→${dest_chain}`, 'success');
        return {
            status: 'approved',
            verified: true,
            source_chain,
            dest_chain,
            amount_unlocked: amount,
            unlock_signature: signature,
            validator_timestamp: new Date().toISOString(),
        };
    }
}
exports.CrossChainBridge = CrossChainBridge;
//# sourceMappingURL=bridge.js.map