/**
 * GSTD Bot — Omega Gateway + Node OS
 *
 * The sovereign control plane for the decentralized AI assistant.
 * Handles: WebSocket sessions, channel routing, tool dispatch, skills, swarm,
 * Dashboard UI, App Store, and all Node OS functions — all on one port.
 */
import { NodeWallet } from '../wallet/manager.js';
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
    private wallet;
    private security;
    private orchestrator;
    private subsystems;
    private metrics;
    constructor(config?: Partial<GatewayConfig>);
    /** Inject wallet after it's initialized (wallet created after gateway) */
    setWallet(wallet: NodeWallet): void;
    /** Inject subsystems for full status reporting */
    setSubsystems(subs: {
        memory?: any;
        trainer?: any;
        resources?: any;
        swarm?: any;
        blockchain?: any;
        security?: any;
        orchestrator?: any;
    }): void;
    /** Get the actual port the gateway is listening on (may differ from requested if auto-reassigned) */
    getPort(): number;
    private setupAPI;
    private setupNodeOS;
    private getFallbackHTML;
    private getCertExpiry;
    private setupWebSocket;
    private handleWSMessage;
    private handleCommand;
    private updateMetrics;
    private splitIntoChunks;
    private isLocalRequest;
    start(): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map