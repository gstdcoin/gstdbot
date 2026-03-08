/**
 * GSTD Node OS — Security Hardening
 *
 * Multi-layer security for autonomous node operation:
 * - Rate limiting per IP/endpoint
 * - Request signing & verification
 * - Brute-force protection (PIN, API)
 * - Component isolation (sandbox enforcement)
 * - Encrypted storage for secrets
 * - Audit trail for all actions
 * - Auto-ban on suspicious activity
 * - Peripheral device sandboxing
 */
export interface SecurityConfig {
    maxLoginAttempts: number;
    lockoutDurationMs: number;
    rateLimitPerMinute: number;
    enableAuditLog: boolean;
    enableEncryption: boolean;
    trustedNetworks: string[];
    bannedIPs: string[];
}
export interface AuditEntry {
    timestamp: string;
    action: string;
    ip: string;
    details: string;
    severity: 'info' | 'warn' | 'critical';
}
export declare class SecurityHardening {
    private config;
    private configDir;
    private rateLimits;
    private loginAttempts;
    private bannedIPs;
    private encryptionKey;
    private auditLogPath;
    private cleanupInterval;
    constructor(config?: Partial<SecurityConfig>);
    stop(): void;
    checkRateLimit(ip: string): {
        allowed: boolean;
        retryAfterMs?: number;
    };
    recordLoginAttempt(ip: string, success: boolean): {
        blocked: boolean;
        remainingAttempts?: number;
    };
    isLoginBlocked(ip: string): boolean;
    banIP(ip: string, reason: string): void;
    unbanIP(ip: string): void;
    isBanned(ip: string): boolean;
    private saveBannedIPs;
    encrypt(data: string): string;
    decrypt(encryptedData: string): string;
    private loadOrCreateKey;
    signRequest(payload: string, timestamp: number): string;
    verifySignature(payload: string, timestamp: number, signature: string): boolean;
    audit(action: string, ip: string, details: string, severity?: AuditEntry['severity']): void;
    getAuditLog(limit?: number): AuditEntry[];
    isTrustedNetwork(ip: string): boolean;
    /**
     * Generate a sandboxed Docker run command for an app.
     * Restricts: network access, host filesystem, capabilities.
     */
    generateSandboxedCmd(appId: string, image: string, ports: string[], volumes: string[]): string;
    /**
     * Whitelist device types that apps can access.
     * Only whitelisted devices are mounted into Docker containers.
     */
    getAllowedDevices(): string[];
    getDeviceDockerFlags(appId: string, requestedDevices: string[]): string[];
    private cleanup;
    getStatus(): {
        bannedIPs: number;
        activeRateLimits: number;
        encryptionEnabled: boolean;
        auditEnabled: boolean;
        maxLoginAttempts: number;
        lockoutDuration: string;
        rateLimitPerMinute: number;
    };
}
//# sourceMappingURL=hardening.d.ts.map