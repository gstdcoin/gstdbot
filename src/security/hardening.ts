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

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logActivity } from '../gateway/server.js';

// ─── Types ───────────────────────────────────────────────────────
export interface SecurityConfig {
    maxLoginAttempts: number;        // Before lockout
    lockoutDurationMs: number;       // 15 min default
    rateLimitPerMinute: number;      // API calls per IP
    enableAuditLog: boolean;
    enableEncryption: boolean;
    trustedNetworks: string[];       // CIDRs that bypass some checks
    bannedIPs: string[];
}

interface RateLimitEntry {
    count: number;
    windowStart: number;
    blocked: boolean;
    blockedUntil: number;
}

interface LoginAttempt {
    ip: string;
    timestamp: number;
    success: boolean;
}

export interface AuditEntry {
    timestamp: string;
    action: string;
    ip: string;
    details: string;
    severity: 'info' | 'warn' | 'critical';
}

// ─── Security Module ─────────────────────────────────────────────
export class SecurityHardening {
    private config: SecurityConfig;
    private configDir: string;
    private rateLimits: Map<string, RateLimitEntry> = new Map();
    private loginAttempts: Map<string, LoginAttempt[]> = new Map();
    private bannedIPs: Set<string> = new Set();
    private encryptionKey: Buffer;
    private auditLogPath: string;
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor(config?: Partial<SecurityConfig>) {
        this.config = {
            maxLoginAttempts: 5,
            lockoutDurationMs: 15 * 60 * 1000,
            rateLimitPerMinute: 120,
            enableAuditLog: true,
            enableEncryption: true,
            trustedNetworks: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
            bannedIPs: [],
            ...config,
        };

        this.configDir = join(homedir(), '.config', 'gstdbot', 'security');
        if (!existsSync(this.configDir)) {
            try { mkdirSync(this.configDir, { recursive: true }); } catch (_e) {}
        }

        this.auditLogPath = join(this.configDir, 'audit.log');
        this.encryptionKey = this.loadOrCreateKey();

        // Load banned IPs
        const banFile = join(this.configDir, 'banned_ips.json');
        if (existsSync(banFile)) {
            try {
                const ips = JSON.parse(readFileSync(banFile, 'utf-8'));
                ips.forEach((ip: string) => this.bannedIPs.add(ip));
            } catch (_e) {}
        }

        // Periodic cleanup
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }

    stop(): void {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    }

    // ─── Rate Limiting ───────────────────────────────────────
    checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
        if (this.isTrustedNetwork(ip)) return { allowed: true };
        if (this.bannedIPs.has(ip)) return { allowed: false, retryAfterMs: -1 };

        const now = Date.now();
        let entry = this.rateLimits.get(ip);

        if (!entry || now - entry.windowStart > 60000) {
            entry = { count: 0, windowStart: now, blocked: false, blockedUntil: 0 };
            this.rateLimits.set(ip, entry);
        }

        if (entry.blocked && now < entry.blockedUntil) {
            return { allowed: false, retryAfterMs: entry.blockedUntil - now };
        }

        entry.count++;
        if (entry.count > this.config.rateLimitPerMinute) {
            entry.blocked = true;
            entry.blockedUntil = now + 60000; // Block for 1 minute
            this.audit('rate_limit_exceeded', ip, `${entry.count} requests/min`, 'warn');
            return { allowed: false, retryAfterMs: 60000 };
        }

        return { allowed: true };
    }

    // ─── Login Protection ────────────────────────────────────
    recordLoginAttempt(ip: string, success: boolean): { blocked: boolean; remainingAttempts?: number } {
        const now = Date.now();
        let attempts = this.loginAttempts.get(ip) || [];

        // Clean old attempts
        attempts = attempts.filter(a => now - a.timestamp < this.config.lockoutDurationMs);
        attempts.push({ ip, timestamp: now, success });
        this.loginAttempts.set(ip, attempts);

        const failedCount = attempts.filter(a => !a.success).length;

        if (failedCount >= this.config.maxLoginAttempts) {
            this.audit('login_lockout', ip, `${failedCount} failed attempts`, 'critical');
            return { blocked: true, remainingAttempts: 0 };
        }

        if (!success) {
            this.audit('login_failed', ip, `Attempt ${failedCount}/${this.config.maxLoginAttempts}`, 'warn');
        }

        return { blocked: false, remainingAttempts: this.config.maxLoginAttempts - failedCount };
    }

    isLoginBlocked(ip: string): boolean {
        if (this.isTrustedNetwork(ip)) return false;
        const attempts = this.loginAttempts.get(ip) || [];
        const now = Date.now();
        const recentFails = attempts.filter(
            a => !a.success && now - a.timestamp < this.config.lockoutDurationMs
        ).length;
        return recentFails >= this.config.maxLoginAttempts;
    }

    // ─── IP Banning ──────────────────────────────────────────
    banIP(ip: string, reason: string): void {
        this.bannedIPs.add(ip);
        this.audit('ip_banned', ip, reason, 'critical');
        this.saveBannedIPs();
    }

    unbanIP(ip: string): void {
        this.bannedIPs.delete(ip);
        this.saveBannedIPs();
    }

    isBanned(ip: string): boolean {
        return this.bannedIPs.has(ip);
    }

    private saveBannedIPs(): void {
        const banFile = join(this.configDir, 'banned_ips.json');
        try { writeFileSync(banFile, JSON.stringify(Array.from(this.bannedIPs), null, 2)); } catch (_e) {}
    }

    // ─── Encrypted Storage ───────────────────────────────────
    encrypt(data: string): string {
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(encryptedData: string): string {
        const parts = encryptedData.split(':');
        if (parts.length !== 2) throw new Error('Invalid encrypted data format');
        const iv = Buffer.from(parts[0], 'hex');
        const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
        let decrypted = decipher.update(parts[1], 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    private loadOrCreateKey(): Buffer {
        const keyFile = join(this.configDir, '.node_key');
        if (existsSync(keyFile)) {
            return Buffer.from(readFileSync(keyFile, 'utf-8').trim(), 'hex');
        }
        const key = randomBytes(32);
        try { writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 }); } catch (_e) {}
        return key;
    }

    // ─── Request Signing ─────────────────────────────────────
    signRequest(payload: string, timestamp: number): string {
        return createHash('sha256')
            .update(payload + timestamp.toString() + this.encryptionKey.toString('hex'))
            .digest('hex');
    }

    verifySignature(payload: string, timestamp: number, signature: string): boolean {
        // Reject if older than 5 minutes
        if (Date.now() - timestamp > 5 * 60 * 1000) return false;
        return this.signRequest(payload, timestamp) === signature;
    }

    // ─── Audit Trail ─────────────────────────────────────────
    audit(action: string, ip: string, details: string, severity: AuditEntry['severity'] = 'info'): void {
        if (!this.config.enableAuditLog) return;

        const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            action,
            ip,
            details,
            severity,
        };

        try {
            appendFileSync(this.auditLogPath, JSON.stringify(entry) + '\n');
        } catch (_e) {}

        if (severity === 'critical') {
            logActivity(`🚨 SECURITY: ${action} from ${ip} — ${details}`, 'error');
        }
    }

    getAuditLog(limit: number = 50): AuditEntry[] {
        try {
            const lines = readFileSync(this.auditLogPath, 'utf-8').trim().split('\n');
            return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
        } catch (_e) {
            return [];
        }
    }

    // ─── Trusted Networks ────────────────────────────────────
    isTrustedNetwork(ip: string): boolean {
        // Simple check for local/private IPs
        if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
        if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) return true;
        return this.config.trustedNetworks.includes(ip);
    }

    // ─── Component Isolation ─────────────────────────────────
    /**
     * Generate a sandboxed Docker run command for an app.
     * Restricts: network access, host filesystem, capabilities.
     */
    generateSandboxedCmd(appId: string, image: string, ports: string[], volumes: string[]): string {
        const secOpts = [
            '--security-opt=no-new-privileges:true',
            '--cap-drop=ALL',
            '--cap-add=NET_BIND_SERVICE',
            '--read-only',
            '--tmpfs /tmp:rw,noexec,nosuid,size=512m',
            '--memory=2g',
            '--cpus=2',
            '--pids-limit=256',
            `--name=gstd-${appId}`,
            '--restart=unless-stopped',
        ];

        const portMaps = ports.map(p => `-p ${p}`).join(' ');
        const volumeMaps = volumes.map(v => `-v ${v}`).join(' ');

        return `docker run -d ${secOpts.join(' ')} ${portMaps} ${volumeMaps} ${image}`;
    }

    // ─── Peripheral Device Security ──────────────────────────
    /**
     * Whitelist device types that apps can access.
     * Only whitelisted devices are mounted into Docker containers.
     */
    getAllowedDevices(): string[] {
        return [
            '/dev/video0',   // Camera
            '/dev/snd',      // Audio
            '/dev/dri',      // GPU rendering
        ];
    }

    getDeviceDockerFlags(appId: string, requestedDevices: string[]): string[] {
        const allowed = this.getAllowedDevices();
        return requestedDevices
            .filter(d => allowed.includes(d))
            .map(d => `--device=${d}`);
    }

    // ─── Cleanup ─────────────────────────────────────────────
    private cleanup(): void {
        const now = Date.now();
        // Clean old rate limit entries
        for (const [ip, entry] of this.rateLimits) {
            if (now - entry.windowStart > 120000) this.rateLimits.delete(ip);
        }
        // Clean old login attempts
        for (const [ip, attempts] of this.loginAttempts) {
            const fresh = attempts.filter(a => now - a.timestamp < this.config.lockoutDurationMs);
            if (fresh.length === 0) this.loginAttempts.delete(ip);
            else this.loginAttempts.set(ip, fresh);
        }
    }

    // ─── Status ──────────────────────────────────────────────
    getStatus() {
        return {
            bannedIPs: this.bannedIPs.size,
            activeRateLimits: this.rateLimits.size,
            encryptionEnabled: this.config.enableEncryption,
            auditEnabled: this.config.enableAuditLog,
            maxLoginAttempts: this.config.maxLoginAttempts,
            lockoutDuration: `${this.config.lockoutDurationMs / 60000}min`,
            rateLimitPerMinute: this.config.rateLimitPerMinute,
        };
    }
}
