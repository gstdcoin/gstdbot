/**
 * GSTD Node OS — Cross-Chain Bridge Verifier
 *
 * Performs REAL on-chain transaction verification by calling
 * the platform's verified bridge API endpoints.
 * Each node validates transactions independently.
 */
export interface BridgeTransaction {
    txId: string;
    sourceChain: 'TON' | 'Solana' | 'XRPL';
    destChain: 'TON' | 'Solana' | 'XRPL';
    amount: number;
    userAddress: string;
    status: 'locked' | 'unlocked' | 'failed' | 'processing';
    timestamp: string;
}
export declare class CrossChainBridge {
    private static CONTRACTS;
    /**
     * Validate a transaction on-chain via the platform's verify-tx API.
     * Falls back to direct chain RPC if platform is unavailable.
     */
    validateLock(sourceChain: string, txHash: string, expectedAmount: number): Promise<boolean>;
    /**
     * Direct on-chain verification when platform API is not available.
     */
    private verifyDirectOnChain;
    private verifyTONDirect;
    private verifySolanaDirect;
    private verifyXRPLDirect;
    /**
     * Produce verification signature for a validated bridge task.
     */
    signVerification(destChain: string, targetAddress: string, amount: number): Promise<string>;
    /**
     * Full bridge verification task — used by SwarmAgent when processing bridge_verify tasks
     */
    processBridgeTask(payload: any): Promise<any>;
}
//# sourceMappingURL=bridge.d.ts.map