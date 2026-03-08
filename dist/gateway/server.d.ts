/**
 * GSTD Bot — Omega Gateway + Node OS
 *
 * The sovereign control plane for the decentralized AI assistant.
 * Handles: WebSocket sessions, channel routing, tool dispatch, skills, swarm,
 * Dashboard UI, App Store, and all Node OS functions — all on one port.
 */
export interface GatewayConfig {
    port: number;
    apiPort: number;
    swarmUrl: string;
    cocoonEnabled: boolean;
    sovereigntyMode: 'full' | 'hybrid' | 'fallback';
}
export declare function logActivity(msg: string, type?: string): void;
export declare class OmegaGateway {
    private wss;
    private app;
    private server;
    private router;
    private sessions;
    private config;
    private clients;
    private appManager;
    private metrics;
    constructor(config?: Partial<GatewayConfig>);
    private setupAPI;
    private setupNodeOS;
    private getFallbackHTML;
    private setupWebSocket;
    private handleWSMessage;
    private handleCommand;
    private updateMetrics;
    private splitIntoChunks;
    start(): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map