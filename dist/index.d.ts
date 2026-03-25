/**
 * GSTD SuperNode OS — Main Orchestrator (gstdd)
 *
 * ═══════════════════════════════════════════════════════
 * ONE NODE TO RULE THEM ALL — 6 Revenue Streams:
 *   💾 Storage Provider  — earn GSTD for hosting data (Storj/Filecoin)
 *   💻 GPU Compute       — earn GSTD for running jobs (Akash/io.net)
 *   🧠 AI Inference      — earn GSTD for answering queries (GSTD native)
 *   📡 Traffic Relay     — earn GSTD for proxying traffic (Helium DePIN)
 *   🎓 Model Training    — earn GSTD for federated training (io.net)
 *   🪙 Staking           — earn GSTD passive yield (12% APY)
 *
 * All earnings interact with real GSTD token on TON blockchain
 * via SettlementRouter.tact smart contract.
 * ═══════════════════════════════════════════════════════
 *
 * Boot sequence:
 *  1. AI Gateway (Groq + Ollama)
 *  2. Blockchain Manager (GSTD wallet + staking)
 *  3. Revenue Engine (unified 6-stream earnings tracker)
 *  4. Collective Memory (L1 Map + L2 Redis + L3 Platform)
 *  5. Swarm Agent (P2P task processing + earnings)
 *  6. Resource Sharing (sell compute/GPU for GSTD)
 *  7. Federated Training (distributed model training)
 *  8. Storage Vault (Storj/Filecoin-style shard storage)
 *  9. Compute Marketplace (Akash/io.net-style GPU jobs)
 * 10. Traffic Relay (Helium-style DePIN + PoC)
 * 11. Remote Access (token auth + relay + Tor)
 * 12. Telegram Channel
 * 13. TON Connect + Mobile Node TMA
 * 14. Dashboard (all-in-one control panel)
 */
export interface NodeConfig {
    version: string;
    mode: 'cloud' | 'hybrid' | 'sovereign' | 'platform';
    nodeId: string;
    nodeName: string;
    installDir: string;
    swarm: {
        enabled: boolean;
        maxCPU: number;
        maxRAM: number;
        apiUrl: string;
    };
    dashboard: {
        host: string;
        port: number;
        enabled: boolean;
    };
    groq: {
        models: string[];
    };
    memory: {
        redisUrl: string;
        chromaUrl: string;
        enabled: boolean;
    };
    apps: {
        enabled: boolean;
        dataDir: string;
    };
    tonconnect: {
        enabled: boolean;
        network: 'mainnet' | 'testnet';
        bridgeUrl: string;
    };
    mobileNode: {
        enabled: boolean;
    };
}
//# sourceMappingURL=index.d.ts.map