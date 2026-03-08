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

import { randomBytes, createHash, createHmac } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import WebSocket from 'ws';
import { logActivity } from '../gateway/server.js';

// ─── Types ───────────────────────────────────────────────────────
export interface AccessToken {
    token: string;
    name: string;
    permissions: ('read' | 'control' | 'admin')[];
    createdAt: string;
    expiresAt: string | null;  // null = never expires
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
    relayUrl: string;           // Platform relay endpoint
    torEnabled: boolean;
    torOnion: string | null;    // .onion address
    wgEnabled: boolean;
    wgPublicKey: string | null;
    authRequired: boolean;
}

// ─── Remote Access Manager ───────────────────────────────────────
export class RemoteAccessManager {
    private tokens: AccessToken[] = [];
    private sessions: Map<string, RemoteSession> = new Map();
    private relayWs: WebSocket | null = null;
    private config: RemoteConfig;
    private nodeId: string;
    private configDir: string;
    private tokensFile: string;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(nodeId: string) {
        this.nodeId = nodeId;
        this.configDir = join(homedir(), '.config', 'gstdbot');
        this.tokensFile = join(this.configDir, 'access_tokens.json');

        this.config = {
            enabled: process.env.GSTD_REMOTE !== 'false',
            relayUrl: process.env.GSTD_RELAY_URL || 'wss://relay.gstdtoken.com/node',
            torEnabled: process.env.GSTD_TOR === 'true',
            torOnion: null,
            wgEnabled: process.env.GSTD_WG === 'true',
            wgPublicKey: null,
            authRequired: true,
        };
    }

    async init(): Promise<void> {
        if (!existsSync(this.configDir)) {
            mkdirSync(this.configDir, { recursive: true });
        }

        // Load saved tokens
        this.loadTokens();

        // Generate default admin token if none exist
        if (this.tokens.length === 0) {
            const token = this.generateToken('default-admin', ['read', 'control', 'admin']);
            console.log('    🔑 Admin token: ' + token.token);
            console.log('    ⚠  Save this token! Use it to manage your node remotely.');
            logActivity('Admin access token generated — save it!', 'warn');
        }

        if (!this.config.enabled) {
            console.log('    Remote access: disabled');
            return;
        }

        // Connect to platform relay for remote access
        await this.connectRelay();

        // Setup Tor if enabled
        if (this.config.torEnabled) {
            await this.setupTor();
        }

        const methods = [];
        if (this.relayWs) methods.push('Relay');
        if (this.config.torOnion) methods.push('Tor');
        if (this.config.wgEnabled) methods.push('WG');
        methods.push('LAN');

        console.log('    Remote access: ' + methods.join(' + '));
    }

    async stop(): Promise<void> {
        if (this.relayWs) {
            this.relayWs.close();
            this.relayWs = null;
        }
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
        }
    }

    // ─── Token Management ────────────────────────────────────────
    generateToken(
        name: string = 'remote',
        permissions: AccessToken['permissions'] = ['read', 'control'],
        expiresInDays: number | null = null
    ): AccessToken {
        const token: AccessToken = {
            token: 'gstd_' + randomBytes(32).toString('hex'),
            name,
            permissions,
            createdAt: new Date().toISOString(),
            expiresAt: expiresInDays
                ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
                : null,
            lastUsed: null,
            remoteIp: null,
        };

        this.tokens.push(token);
        this.saveTokens();
        logActivity(`Access token "${name}" created (${permissions.join(',')})`, 'info');
        return token;
    }

    revokeToken(tokenStr: string): boolean {
        const idx = this.tokens.findIndex(t => t.token === tokenStr);
        if (idx >= 0) {
            const removed = this.tokens.splice(idx, 1)[0];
            this.saveTokens();
            logActivity(`Access token "${removed.name}" revoked`, 'warn');
            return true;
        }
        return false;
    }

    listTokens(): Omit<AccessToken, 'token'>[] {
        return this.tokens.map(t => ({
            ...t,
            token: t.token.slice(0, 12) + '...' + t.token.slice(-4),
        }));
    }

    validateToken(tokenStr: string): AccessToken | null {
        const token = this.tokens.find(t => t.token === tokenStr);
        if (!token) return null;

        // Check expiry
        if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
            return null;
        }

        // Update last used
        token.lastUsed = new Date().toISOString();
        this.saveTokens();
        return token;
    }

    hasPermission(tokenStr: string, perm: 'read' | 'control' | 'admin'): boolean {
        const token = this.validateToken(tokenStr);
        if (!token) return false;
        return token.permissions.includes(perm) || token.permissions.includes('admin');
    }

    // ─── Authentication Middleware ────────────────────────────────
    authMiddleware() {
        return (req: any, res: any, next: any) => {
            // Always allow local access (localhost / LAN)
            const ip = req.ip || req.connection?.remoteAddress || '';
            if (this.isLocalAccess(ip)) {
                req.nodeAuth = { permissions: ['admin'], local: true };
                next();
                return;
            }

            // Remote access requires token
            if (!this.config.authRequired) {
                req.nodeAuth = { permissions: ['read'], local: false };
                next();
                return;
            }

            const authHeader = req.headers.authorization;
            const tokenParam = req.query?.token;
            const tokenStr = authHeader?.replace('Bearer ', '') || tokenParam;

            if (!tokenStr) {
                res.status(401).json({ error: 'Authentication required', hint: 'Use Authorization: Bearer <token>' });
                return;
            }

            const token = this.validateToken(tokenStr);
            if (!token) {
                res.status(403).json({ error: 'Invalid or expired token' });
                return;
            }

            token.remoteIp = ip;
            req.nodeAuth = { permissions: token.permissions, local: false, tokenName: token.name };
            next();
        };
    }

    private isLocalAccess(ip: string): boolean {
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
            || ip.startsWith('192.168.') || ip.startsWith('10.')
            || ip.startsWith('172.16.') || ip.startsWith('172.17.')
            || ip.startsWith('172.18.') || ip.startsWith('172.19.')
            || ip.startsWith('172.2') || ip.startsWith('172.3');
    }

    // ─── Platform Relay (WebSocket tunnel) ───────────────────────
    // Allows remote access without port forwarding:
    // User → relay.gstdtoken.com → WebSocket → your node
    private async connectRelay(): Promise<void> {
        try {
            const url = `${this.config.relayUrl}?node_id=${this.nodeId}`;

            this.relayWs = new WebSocket(url, {
                headers: {
                    'X-Node-Id': this.nodeId,
                    'X-Node-Version': '3.1.0',
                },
            });

            this.relayWs.on('open', () => {
                logActivity('Connected to relay (remote access enabled)', 'success');
            });

            this.relayWs.on('message', async (data: Buffer) => {
                try {
                    const msg = JSON.parse(data.toString());
                    await this.handleRelayMessage(msg);
                } catch { }
            });

            this.relayWs.on('close', () => {
                this.relayWs = null;
                // Auto-reconnect every 30s
                if (!this.reconnectTimer) {
                    this.reconnectTimer = setInterval(() => {
                        if (!this.relayWs) this.connectRelay().catch(() => { });
                    }, 30_000);
                }
            });

            this.relayWs.on('error', () => {
                // Silently handle — will reconnect
            });
        } catch {
            logActivity('Relay connection failed — will retry', 'warn');
        }
    }

    private async handleRelayMessage(msg: any): Promise<void> {
        // Remote command via relay
        if (msg.type === 'auth') {
            const token = this.validateToken(msg.token);
            if (token) {
                this.relayWs?.send(JSON.stringify({
                    type: 'auth_ok',
                    requestId: msg.requestId,
                    permissions: token.permissions,
                }));
                logActivity(`Remote auth from ${msg.ip || 'relay'} (${token.name})`, 'info');
            } else {
                this.relayWs?.send(JSON.stringify({
                    type: 'auth_fail',
                    requestId: msg.requestId,
                }));
            }
        }

        if (msg.type === 'api_request') {
            // Proxy API request from remote user through relay
            const token = this.validateToken(msg.token);
            if (!token) return;

            // Emit the response back through relay
            this.relayWs?.send(JSON.stringify({
                type: 'api_response',
                requestId: msg.requestId,
                // Actual API handling would be done by the express server
                data: { ok: true, nodeId: this.nodeId },
            }));
        }
    }

    // ─── Tor Hidden Service ──────────────────────────────────────
    private async setupTor(): Promise<void> {
        try {
            const { execSync } = require('child_process');

            // Check if Tor is installed
            try { execSync('which tor', { encoding: 'utf-8' }); } catch {
                logActivity('Tor not installed — skipping .onion setup', 'warn');
                return;
            }

            // Create Tor hidden service config
            const torDir = join(this.configDir, 'tor');
            if (!existsSync(torDir)) mkdirSync(torDir, { recursive: true });

            const torrc = `
HiddenServiceDir ${torDir}/hidden_service/
HiddenServicePort 80 127.0.0.1:8080
HiddenServicePort 443 127.0.0.1:8080
`;
            writeFileSync(join(torDir, 'torrc'), torrc);

            // Check if hidden service already exists
            const hostnameFile = join(torDir, 'hidden_service', 'hostname');
            if (existsSync(hostnameFile)) {
                this.config.torOnion = readFileSync(hostnameFile, 'utf-8').trim();
                logActivity(`Tor: ${this.config.torOnion}`, 'success');
            } else {
                logActivity('Tor hidden service will be created on Tor start', 'info');
            }
        } catch { }
    }

    // ─── Remote Access Info ──────────────────────────────────────
    getAccessInfo(): any {
        return {
            enabled: this.config.enabled,
            methods: {
                lan: { url: `http://localhost:8080`, status: 'active' },
                relay: {
                    status: this.relayWs?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
                    url: `https://relay.gstdtoken.com/node/${this.nodeId}`,
                },
                tor: this.config.torEnabled ? {
                    status: this.config.torOnion ? 'active' : 'pending',
                    onion: this.config.torOnion,
                } : { status: 'disabled' },
                wireguard: this.config.wgEnabled ? {
                    status: this.config.wgPublicKey ? 'active' : 'pending',
                    publicKey: this.config.wgPublicKey,
                } : { status: 'disabled' },
            },
            sessions: Array.from(this.sessions.values()),
            tokens: this.listTokens().length,
        };
    }

    // ─── Persistence ─────────────────────────────────────────────
    private loadTokens(): void {
        if (existsSync(this.tokensFile)) {
            try {
                this.tokens = JSON.parse(readFileSync(this.tokensFile, 'utf-8'));
            } catch { this.tokens = []; }
        }
    }

    private saveTokens(): void {
        try {
            writeFileSync(this.tokensFile, JSON.stringify(this.tokens, null, 2));
        } catch { }
    }
}
