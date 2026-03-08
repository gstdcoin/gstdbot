"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteAccessManager = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const ws_1 = __importDefault(require("ws"));
const server_js_1 = require("../gateway/server.js");
// ─── Remote Access Manager ───────────────────────────────────────
class RemoteAccessManager {
    tokens = [];
    sessions = new Map();
    relayWs = null;
    config;
    nodeId;
    configDir;
    tokensFile;
    reconnectTimer = null;
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.configDir = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot');
        this.tokensFile = (0, path_1.join)(this.configDir, 'access_tokens.json');
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
    async init() {
        if (!(0, fs_1.existsSync)(this.configDir)) {
            (0, fs_1.mkdirSync)(this.configDir, { recursive: true });
        }
        // Load saved tokens
        this.loadTokens();
        // Generate default admin token if none exist
        if (this.tokens.length === 0) {
            const token = this.generateToken('default-admin', ['read', 'control', 'admin']);
            console.log('    🔑 Admin token: ' + token.token);
            console.log('    ⚠  Save this token! Use it to manage your node remotely.');
            (0, server_js_1.logActivity)('Admin access token generated — save it!', 'warn');
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
        if (this.relayWs)
            methods.push('Relay');
        if (this.config.torOnion)
            methods.push('Tor');
        if (this.config.wgEnabled)
            methods.push('WG');
        methods.push('LAN');
        console.log('    Remote access: ' + methods.join(' + '));
    }
    async stop() {
        if (this.relayWs) {
            this.relayWs.close();
            this.relayWs = null;
        }
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
        }
    }
    // ─── Token Management ────────────────────────────────────────
    generateToken(name = 'remote', permissions = ['read', 'control'], expiresInDays = null) {
        const token = {
            token: 'gstd_' + (0, crypto_1.randomBytes)(32).toString('hex'),
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
        (0, server_js_1.logActivity)(`Access token "${name}" created (${permissions.join(',')})`, 'info');
        return token;
    }
    revokeToken(tokenStr) {
        const idx = this.tokens.findIndex(t => t.token === tokenStr);
        if (idx >= 0) {
            const removed = this.tokens.splice(idx, 1)[0];
            this.saveTokens();
            (0, server_js_1.logActivity)(`Access token "${removed.name}" revoked`, 'warn');
            return true;
        }
        return false;
    }
    listTokens() {
        return this.tokens.map(t => ({
            ...t,
            token: t.token.slice(0, 12) + '...' + t.token.slice(-4),
        }));
    }
    validateToken(tokenStr) {
        const token = this.tokens.find(t => t.token === tokenStr);
        if (!token)
            return null;
        // Check expiry
        if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
            return null;
        }
        // Update last used
        token.lastUsed = new Date().toISOString();
        this.saveTokens();
        return token;
    }
    hasPermission(tokenStr, perm) {
        const token = this.validateToken(tokenStr);
        if (!token)
            return false;
        return token.permissions.includes(perm) || token.permissions.includes('admin');
    }
    // ─── Authentication Middleware ────────────────────────────────
    authMiddleware() {
        return (req, res, next) => {
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
    isLocalAccess(ip) {
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
            || ip.startsWith('192.168.') || ip.startsWith('10.')
            || ip.startsWith('172.16.') || ip.startsWith('172.17.')
            || ip.startsWith('172.18.') || ip.startsWith('172.19.')
            || ip.startsWith('172.2') || ip.startsWith('172.3');
    }
    // ─── Platform Relay (WebSocket tunnel) ───────────────────────
    // Allows remote access without port forwarding:
    // User → relay.gstdtoken.com → WebSocket → your node
    async connectRelay() {
        try {
            const url = `${this.config.relayUrl}?node_id=${this.nodeId}`;
            this.relayWs = new ws_1.default(url, {
                headers: {
                    'X-Node-Id': this.nodeId,
                    'X-Node-Version': '3.1.0',
                },
            });
            this.relayWs.on('open', () => {
                (0, server_js_1.logActivity)('Connected to relay (remote access enabled)', 'success');
            });
            this.relayWs.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    await this.handleRelayMessage(msg);
                }
                catch { }
            });
            this.relayWs.on('close', () => {
                this.relayWs = null;
                // Auto-reconnect every 30s
                if (!this.reconnectTimer) {
                    this.reconnectTimer = setInterval(() => {
                        if (!this.relayWs)
                            this.connectRelay().catch(() => { });
                    }, 30_000);
                }
            });
            this.relayWs.on('error', () => {
                // Silently handle — will reconnect
            });
        }
        catch {
            (0, server_js_1.logActivity)('Relay connection failed — will retry', 'warn');
        }
    }
    async handleRelayMessage(msg) {
        // Remote command via relay
        if (msg.type === 'auth') {
            const token = this.validateToken(msg.token);
            if (token) {
                this.relayWs?.send(JSON.stringify({
                    type: 'auth_ok',
                    requestId: msg.requestId,
                    permissions: token.permissions,
                }));
                (0, server_js_1.logActivity)(`Remote auth from ${msg.ip || 'relay'} (${token.name})`, 'info');
            }
            else {
                this.relayWs?.send(JSON.stringify({
                    type: 'auth_fail',
                    requestId: msg.requestId,
                }));
            }
        }
        if (msg.type === 'api_request') {
            // Proxy API request from remote user through relay
            const token = this.validateToken(msg.token);
            if (!token)
                return;
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
    async setupTor() {
        try {
            const { execSync } = require('child_process');
            // Check if Tor is installed
            try {
                execSync('which tor', { encoding: 'utf-8' });
            }
            catch {
                (0, server_js_1.logActivity)('Tor not installed — skipping .onion setup', 'warn');
                return;
            }
            // Create Tor hidden service config
            const torDir = (0, path_1.join)(this.configDir, 'tor');
            if (!(0, fs_1.existsSync)(torDir))
                (0, fs_1.mkdirSync)(torDir, { recursive: true });
            const torrc = `
HiddenServiceDir ${torDir}/hidden_service/
HiddenServicePort 80 127.0.0.1:8080
HiddenServicePort 443 127.0.0.1:8080
`;
            (0, fs_1.writeFileSync)((0, path_1.join)(torDir, 'torrc'), torrc);
            // Check if hidden service already exists
            const hostnameFile = (0, path_1.join)(torDir, 'hidden_service', 'hostname');
            if ((0, fs_1.existsSync)(hostnameFile)) {
                this.config.torOnion = (0, fs_1.readFileSync)(hostnameFile, 'utf-8').trim();
                (0, server_js_1.logActivity)(`Tor: ${this.config.torOnion}`, 'success');
            }
            else {
                (0, server_js_1.logActivity)('Tor hidden service will be created on Tor start', 'info');
            }
        }
        catch { }
    }
    // ─── Remote Access Info ──────────────────────────────────────
    getAccessInfo() {
        return {
            enabled: this.config.enabled,
            methods: {
                lan: { url: `http://localhost:8080`, status: 'active' },
                relay: {
                    status: this.relayWs?.readyState === ws_1.default.OPEN ? 'connected' : 'disconnected',
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
    loadTokens() {
        if ((0, fs_1.existsSync)(this.tokensFile)) {
            try {
                this.tokens = JSON.parse((0, fs_1.readFileSync)(this.tokensFile, 'utf-8'));
            }
            catch {
                this.tokens = [];
            }
        }
    }
    saveTokens() {
        try {
            (0, fs_1.writeFileSync)(this.tokensFile, JSON.stringify(this.tokens, null, 2));
        }
        catch { }
    }
}
exports.RemoteAccessManager = RemoteAccessManager;
//# sourceMappingURL=remote.js.map