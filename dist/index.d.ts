/**
 * GSTD Node OS — Main Orchestrator (gstdd)
 *
 * ═══════════════════════════════════════════════════════
 * Your node is a fully self-contained AI platform:
 * - No external websites needed — everything is built-in
 * - Connect from any device, anywhere (LAN/Relay/Tor)
 * - More nodes = stronger swarm + collective memory
 * - Earn GSTD tokens for sharing resources
 * - GSTD token = key to all platform functions
 * ═══════════════════════════════════════════════════════
 *
 * Boot sequence:
 *  1. AI Gateway (Groq + Ollama)
 *  2. Blockchain Manager (GSTD wallet + staking)
 *  3. Collective Memory (L1 Map + L2 Redis + L3 Platform)
 *  4. Swarm Agent (P2P task processing + earnings)
 *  5. Resource Sharing (sell compute/GPU for GSTD)
 *  6. Federated Training (distributed model training)
 *  7. Remote Access (token auth + relay + Tor)
 *  8. Telegram Channel
 *  9. Dashboard (all-in-one control panel on :8080)
 */
export interface NodeConfig {
    version: string;
    mode: 'cloud' | 'hybrid' | 'sovereign';
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