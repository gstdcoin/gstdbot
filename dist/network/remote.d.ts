/**
 * GSTD Node OS — Remote Access Manager
 *
 * Allows secure remote management from anywhere in the world:
 * - Token-based authentication (GSTD Auth Tokens)
 * - Tunnel via platform relay (no port forwarding needed)
 * - Tor hidden service (optional, maximum privacy)
 * - WireGuard tunnel (optional, maximum performance)
 * - WebSocket real-time remote control channel
 */
export interface AccessToken {
    token: string;
    name: string;
    permissions: ('read' | 'control' | 'admin')[];
    createdAt: string;
    expiresAt: string | null;
    lastUsed: string | null;
    remoteIp: string | null;
}
export interface RemoteSession {
    id: string;
    token: string;
    ip: string;
    connectedAt: string;
    lastActivity: string;
    permissions: string[];
}
export interface RemoteConfig {
    enabled: boolean;
    relayUrl: string;
    torEnabled: boolean;
    torOnion: string | null;
    wgEnabled: boolean;
    wgPublicKey: string | null;
    authRequired: boolean;
}
export declare class RemoteAccessManager {
    private tokens;
    private sessions;
    private relayWs;
    private config;
    private nodeId;
    private configDir;
    private tokensFile;
    private reconnectTimer;
    constructor(nodeId: string);
    init(): Promise<void>;
    stop(): Promise<void>;
    generateToken(name?: string, permissions?: AccessToken['permissions'], expiresInDays?: number | null): AccessToken;
    revokeToken(tokenStr: string): boolean;
    listTokens(): Omit<AccessToken, 'token'>[];
    validateToken(tokenStr: string): AccessToken | null;
    hasPermission(tokenStr: string, perm: 'read' | 'control' | 'admin'): boolean;
    authMiddleware(): (req: any, res: any, next: any) => void;
    private isLocalAccess;
    private connectRelay;
    private handleRelayMessage;
    private setupTor;
    getAccessInfo(): any;
    private loadTokens;
    private saveTokens;
}
//# sourceMappingURL=remote.d.ts.map