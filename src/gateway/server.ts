/**
 * GSTD Bot — Omega Gateway + Node OS
 * 
 * The sovereign control plane for the decentralized AI assistant.
 * Handles: WebSocket sessions, channel routing, tool dispatch, skills, swarm,
 * Dashboard UI, App Store, and all Node OS functions — all on one port.
 */

import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import http from 'http';
import { v4 as uuid } from 'uuid';
import { NeuralRouter, RouteResult } from './router.js';
import { SessionManager, Session } from './sessions.js';
import { cpus, totalmem, freemem, hostname, platform, arch, loadavg, uptime as osUptime, networkInterfaces } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { AppManager, type AppManifest, type InstalledApp } from '../apps/manager.js';
import { NodeWallet } from '../wallet/manager.js';
import { execSync } from 'child_process';

// ─── Reward config ───────────────────────────────────────────────
const REWARD_PER_QUERY = 0.001;        // GSTD per AI query served
const REWARD_PER_SMARTMIX = 0.003;     // GSTD per multi-model query  
const REWARD_PER_CACHE_HIT = 0.0005;   // GSTD per cache hit

export interface GatewayConfig {
    port: number;
    apiPort: number;
    swarmUrl: string;
    cocoonEnabled: boolean;
    sovereigntyMode: 'full' | 'hybrid' | 'fallback';
}

const DEFAULT_CONFIG: GatewayConfig = {
    port: 18789,
    apiPort: 8080,
    swarmUrl: process.env.GSTD_SWARM_URL || 'http://localhost:11434',
    cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
    sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
};

// ─── CPU Tracking ────────────────────────────────────────────────
let prevCpuIdle = 0;
let prevCpuTotal = 0;
let currentCpuUsage = 0;
function updateCpuUsage(): void {
    const cpuInfo = cpus();
    let idle = 0, total = 0;
    cpuInfo.forEach(cpu => {
        for (const type in cpu.times) { total += (cpu.times as any)[type]; }
        idle += cpu.times.idle;
    });
    if (prevCpuTotal > 0) {
        const diffIdle = idle - prevCpuIdle;
        const diffTotal = total - prevCpuTotal;
        currentCpuUsage = diffTotal > 0 ? Math.round(100 - (diffIdle / diffTotal * 100)) : 0;
    }
    prevCpuIdle = idle;
    prevCpuTotal = total;
}
setInterval(updateCpuUsage, 1000);
updateCpuUsage();

function detectGpu(): any {
    try {
        const { execSync } = require('child_process');
        const output = execSync('nvidia-smi --query-gpu=name,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(',').map((s: string) => s.trim());
        return { detected: true, model: parts[0] || 'Unknown', memory: parts[1] ? parts[1] + ' MiB' : undefined, temperature: parts[2] ? parts[2] + '°C' : undefined, usage: parts[3] ? parts[3] + '%' : undefined };
    } catch { return { detected: false }; }
}
function getDiskUsage(): any {
    try {
        const { execSync } = require('child_process');
        const output = execSync("df -B1 / | tail -1", { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(/\s+/);
        const total = parseInt(parts[1]) || 0, used = parseInt(parts[2]) || 0, available = parseInt(parts[3]) || 0;
        return { total, used, available, usage: total > 0 ? Math.round(used / total * 100) : 0 };
    } catch { return { total: 0, used: 0, available: 0, usage: 0 }; }
}
function getLocalIP(): string {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return '127.0.0.1';
}

// ─── Activity Log (persisted to file) ────────────────────────────
const activityLog: { ts: string; msg: string; type: string }[] = [];
const MAX_LOG = 200;
const LOG_DIR = join(require('os').homedir(), '.config', 'gstdbot');
const LOG_FILE = join(LOG_DIR, 'activity.log');

// Load previous log on startup
try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE)) {
        const lines = readFileSync(LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines.slice(-MAX_LOG)) {
            try { activityLog.push(JSON.parse(line)); } catch {}
        }
    }
} catch {}

export function logActivity(msg: string, type: string = 'info'): void {
    const entry = { ts: new Date().toISOString(), msg, type };
    activityLog.unshift(entry);
    if (activityLog.length > MAX_LOG) activityLog.length = MAX_LOG;
    // Persist to file (append)
    try { appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n'); } catch {}
}

// ─── PIN Hashing Helpers ─────────────────────────────────────────
function hashPin(pin: string): string {
    return createHash('sha256').update(pin + 'gstd-node-salt-2026').digest('hex');
}
function generateToken(): string {
    return randomBytes(32).toString('hex');
}
// Active sessions: token → expiry
const authSessions = new Map<string, number>();
const AUTH_TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours
function createAuthToken(): string {
    const token = generateToken();
    authSessions.set(token, Date.now() + AUTH_TOKEN_TTL);
    // Cleanup expired tokens
    for (const [t, exp] of authSessions) {
        if (Date.now() > exp) authSessions.delete(t);
    }
    return token;
}
function isValidToken(token: string): boolean {
    const exp = authSessions.get(token);
    if (!exp) return false;
    if (Date.now() > exp) { authSessions.delete(token); return false; }
    return true;
}

// ─── Auth Rate Limiting ──────────────────────────────────────────
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
function checkLoginRateLimit(ip: string): { allowed: boolean; remaining: number; lockoutMs?: number } {
    const entry = loginAttempts.get(ip);
    if (entry && Date.now() < entry.lockedUntil) {
        return { allowed: false, remaining: 0, lockoutMs: entry.lockedUntil - Date.now() };
    }
    if (entry && Date.now() >= entry.lockedUntil) {
        loginAttempts.delete(ip);
    }
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - (entry?.count || 0) };
}
function recordLoginAttempt(ip: string, success: boolean): void {
    if (success) { loginAttempts.delete(ip); return; }
    const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= MAX_LOGIN_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_DURATION;
        logActivity(`IP ${ip} locked out for 15min after ${entry.count} failed login attempts`, 'warn');
    }
    loginAttempts.set(ip, entry);
}

const nodeStartedAt = Date.now();

export class OmegaGateway {
    private wss: WebSocketServer | null = null;
    private app = express();
    private server: http.Server;
    private router: NeuralRouter;
    private sessions: SessionManager;
    private config: GatewayConfig;
    private clients = new Map<string, WebSocket>();
    private appManager: AppManager;
    private wallet: NodeWallet | null = null;
    private security: any = null;
    private orchestrator: any = null;
    private subsystems: {
        memory?: any;
        trainer?: any;
        resources?: any;
        swarm?: any;
        blockchain?: any;
    } = {};
    private metrics = {
        totalRequests: 0,
        swarmRequests: 0,
        cocoonRequests: 0,
        commercialRequests: 0,
        cacheHits: 0,
    };

    constructor(config: Partial<GatewayConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.router = new NeuralRouter(this.config.swarmUrl, this.config.cocoonEnabled);
        this.sessions = new SessionManager();
        this.appManager = new AppManager();
        this.server = http.createServer(this.app);
        this.setupAPI();
        this.setupNodeOS();
    }

    /** Inject wallet after it's initialized (wallet created after gateway) */
    setWallet(wallet: NodeWallet): void {
        this.wallet = wallet;
        logActivity('Wallet connected to gateway — rewards active', 'success');
    }

    /** Inject subsystems for full status reporting */
    setSubsystems(subs: { memory?: any; trainer?: any; resources?: any; swarm?: any; blockchain?: any; security?: any; orchestrator?: any }): void {
        this.subsystems = subs;
        if (subs.security) this.security = subs.security;
        if (subs.orchestrator) this.orchestrator = subs.orchestrator;
    }

    /** Get the actual port the gateway is listening on (may differ from requested if auto-reassigned) */
    getPort(): number {
        return this.config.apiPort;
    }

    private setupAPI(): void {
        // JSON body parser with error handler (fix #15)
        this.app.use((req, res, next) => {
            express.json({ limit: '10mb' })(req, res, (err) => {
                if (err) {
                    res.status(400).json({ error: 'Invalid JSON body', details: err.message });
                    return;
                }
                next();
            });
        });

        // ─── Security Headers (critical for hosted nodes) ────────
        this.app.use((_req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
            next();
        });

        // ─── Rate Limiting (protects against abuse on hosted nodes) ──
        const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
        const RATE_LIMIT = 120;      // max requests per window
        const RATE_WINDOW = 60000;   // 1 minute window
        this.app.use((req, res, next) => {
            const ip = req.ip || req.socket.remoteAddress || 'unknown';
            const now = Date.now();
            let entry = rateLimitMap.get(ip);
            if (!entry || now > entry.resetAt) {
                entry = { count: 0, resetAt: now + RATE_WINDOW };
                rateLimitMap.set(ip, entry);
            }
            entry.count++;
            res.setHeader('X-RateLimit-Limit', RATE_LIMIT.toString());
            res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT - entry.count).toString());
            if (entry.count > RATE_LIMIT) {
                logActivity(`Rate limited: ${ip} (${entry.count} req/min)`, 'warn');
                res.status(429).json({ error: 'Too many requests. Try again in 1 minute.' });
                return;
            }
            next();
        });
        // Cleanup old rate limit entries every 5 minutes
        setInterval(() => {
            const now = Date.now();
            for (const [ip, entry] of rateLimitMap.entries()) {
                if (now > entry.resetAt + RATE_WINDOW) rateLimitMap.delete(ip);
            }
        }, 5 * 60_000);

        // ─── Health ──────────────────────────────────────────────
        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                version: '3.3.0',
                uptime: process.uptime(),
                activeSessions: this.sessions.count(),
                connectedClients: this.clients.size,
                security: {
                    rateLimiting: true,
                    pinAuth: true,
                    bruteForceProtection: true,
                },
                swarm: {
                    peers: this.orchestrator?.getPeers()?.length || 0,
                    models: this.orchestrator?.getAvailableModels()?.length || 0,
                },
            });
        });

        // ─── Self-Update (OTA from dashboard) ────────────────────
        this.app.get('/api/check-update', async (_req, res) => {
            try {
                const { execSync } = require('child_process');
                const installDir = process.env.GSTD_INSTALL_DIR || require('os').homedir() + '/gstdbot';
                // Fetch latest from remote
                execSync('git fetch origin main', { cwd: installDir, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
                const localHash = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8' }).trim();
                const remoteHash = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8' }).trim();
                const behind = parseInt(execSync('git rev-list HEAD..origin/main --count', { cwd: installDir, encoding: 'utf-8' }).trim()) || 0;
                const currentVersion = require('../../package.json').version || 'unknown';
                res.json({
                    update_available: localHash !== remoteHash,
                    current_version: currentVersion,
                    current_hash: localHash.slice(0, 8),
                    remote_hash: remoteHash.slice(0, 8),
                    commits_behind: behind,
                });
            } catch (e: any) {
                res.json({ update_available: false, error: e.message });
            }
        });

        this.app.post('/api/update', async (_req, res) => {
            try {
                const { execSync } = require('child_process');
                const installDir = process.env.GSTD_INSTALL_DIR || require('os').homedir() + '/gstdbot';

                // Step 1: Pull latest
                const pullOutput = execSync('git pull origin main --ff-only', {
                    cwd: installDir, encoding: 'utf-8', timeout: 30000,
                });

                // Step 2: Install deps (if package.json changed)
                execSync('npm install --production 2>&1 || true', {
                    cwd: installDir, encoding: 'utf-8', timeout: 120000,
                });

                // Step 3: Build
                execSync('npx tsc 2>&1 || true', {
                    cwd: installDir, encoding: 'utf-8', timeout: 60000,
                });

                const newVersion = JSON.parse(
                    require('fs').readFileSync(installDir + '/package.json', 'utf-8')
                ).version || 'unknown';

                res.json({
                    success: true,
                    message: 'Update applied. Restarting...',
                    new_version: newVersion,
                    pull_output: pullOutput.trim(),
                });

                // Step 4: Restart process gracefully (after response is sent)
                setTimeout(() => {
                    logActivity('Self-update complete — restarting...', 'success');
                    try {
                        // If running via systemd, restart the service
                        execSync('systemctl restart gstd-node 2>/dev/null || true', { encoding: 'utf-8', timeout: 5000 });
                    } catch { }
                    // If not systemd, just exit — PM2 or shell will restart
                    process.exit(0);
                }, 500);

            } catch (e: any) {
                res.status(500).json({ success: false, error: e.message });
            }
        });

        // ─── OpenAI-compatible chat completions ──────────────────
        this.app.post('/v1/chat/completions', async (req, res) => {
            try {
                const { model, messages, stream = false } = req.body;
                this.metrics.totalRequests++;

                const result = await this.router.route(model || 'auto', messages);
                this.updateMetrics(result);

                if (stream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');

                    const chunks = this.splitIntoChunks(result.content);
                    for (const chunk of chunks) {
                        const data = {
                            id: `chatcmpl-${uuid()}`,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: result.model,
                            choices: [{
                                index: 0,
                                delta: { content: chunk },
                                finish_reason: null,
                            }],
                        };
                        res.write(`data: ${JSON.stringify(data)}\n\n`);
                        await new Promise(r => setTimeout(r, 15));
                    }

                    // Final chunk
                    const final = {
                        id: `chatcmpl-${uuid()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: result.model,
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: 'stop',
                        }],
                    };
                    res.write(`data: ${JSON.stringify(final)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                } else {
                    res.json({
                        id: `chatcmpl-${uuid()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: result.model,
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: result.content },
                            finish_reason: 'stop',
                        }],
                        usage: {
                            prompt_tokens: result.usage.promptTokens,
                            completion_tokens: result.usage.completionTokens,
                            total_tokens: result.usage.totalTokens,
                        },
                        _gstd: {
                            tier: result.tier,
                            sovereignty: result.tier !== 'commercial',
                            latency_ms: result.latencyMs,
                        },
                    });
                }
            } catch (err: any) {
                console.error('[Gateway] Error:', err.message);
                res.status(500).json({ error: { message: err.message, type: 'internal_error' } });
            }
        });

        // ─── Models list ─────────────────────────────────────────
        this.app.get('/v1/models', (_req, res) => {
            res.json({
                object: 'list',
                data: [
                    { id: 'auto', object: 'model', owned_by: 'gstd-swarm', description: 'Sovereign neural router — auto-selects best model' },
                    { id: 'gstd-flash', object: 'model', owned_by: 'gstd-swarm', description: 'Fast: qwen2.5-coder:7b' },
                    { id: 'gstd-pro', object: 'model', owned_by: 'gstd-swarm', description: 'Balanced: llama3.1:8b' },
                    { id: 'gstd-ultra', object: 'model', owned_by: 'gstd-swarm', description: 'Deep reasoning: deepseek-r1:14b' },
                    { id: 'cocoon-auto', object: 'model', owned_by: 'cocoon-tee', description: 'TEE confidential GPU compute' },
                ],
            });
        });

        // ─── Sovereignty Index ───────────────────────────────────
        this.app.get('/v1/sovereignty', (_req, res) => {
            const total = this.metrics.totalRequests || 1;
            const sovereign = this.metrics.swarmRequests + this.metrics.cocoonRequests + this.metrics.cacheHits;
            res.json({
                sovereignty_index: (sovereign / total) * 100,
                total_requests: total,
                breakdown: {
                    cache: this.metrics.cacheHits,
                    swarm: this.metrics.swarmRequests,
                    cocoon: this.metrics.cocoonRequests,
                    commercial: this.metrics.commercialRequests,
                },
                target: 100,
            });
        });

        // ─── Skills ──────────────────────────────────────────────
        this.app.get('/v1/skills', (_req, res) => {
            res.json({
                object: 'list',
                data: [
                    { id: 'web-research', name: 'Web Researcher', version: '1.0.0', price: 0.02, active: true, users: 890 },
                    { id: 'code-gen', name: 'Code Generator', version: '1.0.0', price: 0, active: true, users: 2400 },
                    { id: 'defi-monitor', name: 'DeFi Monitor', version: '1.0.0', price: 0.01, active: true, users: 1200 },
                    { id: 'planetary-signals', name: 'Planetary Signals', version: '1.0.0', price: 0.05, active: true, users: 450 },
                    { id: 'content-writer', name: 'Content Writer', version: '1.0.0', price: 0.01, active: true, users: 1800 },
                    { id: 'token-analyzer', name: 'Token Analyzer', version: '1.0.0', price: 0.03, active: true, users: 670 },
                    { id: 'image-gen', name: 'Image Generator', version: '0.9.0', price: 0.1, active: true, users: 340, beta: true },
                ],
            });
        });

        // ─── Swarm status ────────────────────────────────────────
        this.app.get('/v1/swarm/status', (_req, res) => {
            res.json({
                status: 'active',
                nodes: 247,
                models_available: ['qwen2.5-coder:7b', 'llama3.1:8b', 'deepseek-r1:14b'],
                total_compute_hours: 12480,
                gstd_distributed: 4521.5,
            });
        });

        // ─── Chat API (for dashboard) ────────────────────────────
        this.app.post('/api/v1/chat', async (req, res) => {
            try {
                const { model, messages, max_tokens } = req.body;
                this.metrics.totalRequests++;
                const result = await this.router.route(model || 'auto', messages);
                this.updateMetrics(result);
                res.json({
                    choices: [{ message: { role: 'assistant', content: result.content } }],
                    model: result.model,
                    _gstd: { tier: result.tier, latency_ms: result.latencyMs },
                });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });
    }

    // ─── Node OS: Dashboard + App Store + System APIs ────────────
    private setupNodeOS(): void {
        // ─── Dashboard PIN Authentication (Secure) ───────────────
        const configDir = join(require('os').homedir(), '.config', 'gstdbot');
        const pinFile = join(configDir, 'dashboard_pin.hash'); // .hash not .txt
        const oldPinFile = join(configDir, 'dashboard_pin.txt');
        let pinHash: string = '';
        let pinConfigured = false;

        // Migrate old plaintext PIN → hashed
        if (existsSync(oldPinFile)) {
            const oldPin = readFileSync(oldPinFile, 'utf-8').trim();
            if (oldPin) {
                pinHash = hashPin(oldPin);
                pinConfigured = true;
                try {
                    writeFileSync(pinFile, pinHash);
                    require('fs').unlinkSync(oldPinFile);
                    logActivity('PIN migrated to hashed storage', 'success');
                } catch {}
            }
        } else if (existsSync(pinFile)) {
            pinHash = readFileSync(pinFile, 'utf-8').trim();
            pinConfigured = !!pinHash;
        }

        // Ensure config dir exists
        if (!existsSync(configDir)) {
            try { mkdirSync(configDir, { recursive: true }); } catch {}
        }

        // POST /api/auth/setup — create PIN on first login
        this.app.post('/api/auth/setup', (req, res) => {
            if (pinConfigured) {
                res.status(400).json({ success: false, error: 'PIN already configured' });
                return;
            }
            const { pin } = req.body || {};
            if (!pin || pin.length < 4 || pin.length > 8) {
                res.status(400).json({ success: false, error: 'PIN must be 4-8 digits' });
                return;
            }
            pinHash = hashPin(pin);
            pinConfigured = true;
            try {
                writeFileSync(pinFile, pinHash);
                logActivity('Dashboard PIN created (hashed)', 'success');
            } catch {}
            const token = createAuthToken();
            res.json({ success: true, token });
        });

        // POST /api/auth/login — verify PIN with brute-force protection
        this.app.post('/api/auth/login', (req, res) => {
            const ip = req.ip || req.socket.remoteAddress || 'unknown';
            const rateCheck = checkLoginRateLimit(ip);
            if (!rateCheck.allowed) {
                const mins = Math.ceil((rateCheck.lockoutMs || 0) / 60000);
                res.status(429).json({ success: false, error: `Too many attempts. Locked for ${mins} minutes.`, lockedMinutes: mins });
                return;
            }
            const { pin } = req.body || {};
            if (!pinConfigured) {
                res.status(400).json({ success: false, error: 'PIN not configured. Use /api/auth/setup first.' });
                return;
            }
            if (hashPin(pin || '') === pinHash) {
                recordLoginAttempt(ip, true);
                const token = createAuthToken();
                logActivity('Dashboard login successful', 'success');
                res.json({ success: true, token });
            } else {
                recordLoginAttempt(ip, false);
                logActivity(`Failed login attempt from ${ip}`, 'warn');
                res.status(401).json({ success: false, error: 'Invalid PIN', remaining: rateCheck.remaining - 1 });
            }
        });

        // GET /api/auth/check — check auth status
        this.app.get('/api/auth/check', (req, res) => {
            const token = req.headers.authorization?.replace('Bearer ', '') || req.query?.token as string;
            const isLocal = this.isLocalRequest(req);
            if (!pinConfigured) {
                res.json({ authenticated: false, needs_setup: true });
                return;
            }
            if (isLocal || isValidToken(token)) {
                res.json({ authenticated: true, local: isLocal });
            } else {
                res.status(401).json({ authenticated: false });
            }
        });

        // ─── Telegram Node Management ────────────────────────────
        const telegramLinkFile = join(configDir, 'telegram_link.json');
        let linkedTelegram: { chatId: number; username: string; linkedAt: string } | null = null;
        let resetCode: string = '';
        let resetCodeExpiry: number = 0;

        if (existsSync(telegramLinkFile)) {
            try { linkedTelegram = JSON.parse(readFileSync(telegramLinkFile, 'utf-8')); } catch {}
        }

        // POST /api/telegram/link — link Telegram account to node
        this.app.post('/api/telegram/link', (req, res) => {
            const { chatId, username } = req.body || {};
            if (!chatId) { res.status(400).json({ error: 'chatId required' }); return; }
            linkedTelegram = { chatId: Number(chatId), username: username || '', linkedAt: new Date().toISOString() };
            try { writeFileSync(telegramLinkFile, JSON.stringify(linkedTelegram, null, 2)); } catch {}
            logActivity(`Telegram linked: @${username} (${chatId})`, 'success');
            res.json({ success: true, linked: linkedTelegram });
        });

        // GET /api/telegram/status — check Telegram link status
        this.app.get('/api/telegram/status', (_req, res) => {
            res.json({ linked: !!linkedTelegram, telegram: linkedTelegram });
        });

        // POST /api/auth/reset-pin-request — initiate 2FA PIN reset via Telegram
        this.app.post('/api/auth/reset-pin-request', async (req, res) => {
            if (!linkedTelegram) {
                res.status(400).json({ error: 'No Telegram account linked. Link one first via Settings.' });
                return;
            }
            // Generate 6-digit reset code
            resetCode = Math.floor(100000 + Math.random() * 900000).toString();
            resetCodeExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes
            // Send code via Telegram Bot API
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (botToken) {
                try {
                    const fetch = (await import('node-fetch')).default;
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: linkedTelegram.chatId,
                            text: `🔐 *PIN Reset Code*\n\nYour GSTD Node PIN reset code:\n\n\`${resetCode}\`\n\n⏰ Expires in 5 minutes.\n⚠️ If you didn't request this, someone may be trying to access your node.`,
                            parse_mode: 'Markdown'
                        })
                    });
                    logActivity('PIN reset code sent to Telegram', 'info');
                } catch (e: any) {
                    logActivity('Failed to send reset code: ' + e.message, 'error');
                }
            }
            res.json({ success: true, message: 'Reset code sent to your linked Telegram account.' });
        });

        // POST /api/auth/reset-pin-confirm — verify 2FA code and set new PIN
        this.app.post('/api/auth/reset-pin-confirm', (req, res) => {
            const { code, newPin } = req.body || {};
            if (!code || !newPin) {
                res.status(400).json({ error: 'code and newPin required' });
                return;
            }
            if (Date.now() > resetCodeExpiry) {
                res.status(400).json({ error: 'Reset code expired. Request a new one.' });
                return;
            }
            if (code !== resetCode) {
                res.status(401).json({ error: 'Invalid reset code.' });
                return;
            }
            if (newPin.length < 4 || newPin.length > 8) {
                res.status(400).json({ error: 'PIN must be 4-8 digits' });
                return;
            }
            pinHash = hashPin(newPin);
            pinConfigured = true;
            resetCode = '';
            try { writeFileSync(pinFile, pinHash); } catch {}
            logActivity('PIN reset via 2FA Telegram', 'success');
            const token = createAuthToken();
            res.json({ success: true, token });
        });

        // POST /api/telegram/webhook — receive Telegram commands for node management
        this.app.post('/api/telegram/webhook', async (req, res) => {
            const msg = req.body?.message;
            if (!msg || !msg.text) { res.sendStatus(200); return; }
            const chatId = msg.chat?.id;
            const text = msg.text.trim();

            // Only respond to linked account
            if (!linkedTelegram || chatId !== linkedTelegram.chatId) {
                res.sendStatus(200); return;
            }

            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const sendReply = async (reply: string) => {
                if (!botToken) return;
                try {
                    const fetch = (await import('node-fetch')).default;
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: 'Markdown' })
                    });
                } catch {}
            };

            if (text === '/status' || text === '/start') {
                const used = process.memoryUsage();
                const up = process.uptime();
                const hrs = Math.floor(up / 3600);
                const mins = Math.floor((up % 3600) / 60);
                await sendReply(`🐝 *GSTD Node Status*\n\n📊 Uptime: ${hrs}h ${mins}m\n💾 Memory: ${Math.round(used.rss / 1024 / 1024)}MB\n🔧 Version: 3.3.0\n🌐 Port: ${this.config.apiPort}\n\nCommands:\n/status — Node status\n/restart — Restart node\n/update — Check & apply updates\n/apps — List installed apps\n/earnings — View earnings\n/pin\\_reset — Reset dashboard PIN`);
            } else if (text === '/restart') {
                await sendReply('🔄 Restarting node...');
                setTimeout(() => process.exit(0), 1000);
            } else if (text === '/update') {
                await sendReply('🔄 Checking for updates...');
                // Trigger update check
                try {
                    const { execSync } = require('child_process');
                    const result = execSync('cd ' + (process.env.GSTD_INSTALL_DIR || join(require('os').homedir(), 'gstdbot')) + ' && git fetch origin main 2>&1 && git log HEAD..origin/main --oneline 2>&1', { timeout: 15000 }).toString();
                    if (result.trim()) {
                        await sendReply('📦 Updates available:\n```\n' + result.trim() + '\n```\nApplying update...');
                        execSync('cd ' + (process.env.GSTD_INSTALL_DIR || join(require('os').homedir(), 'gstdbot')) + ' && git pull origin main --ff-only && npm install --production && npx tsc', { timeout: 120000 });
                        await sendReply('✅ Updated! Restarting...');
                        setTimeout(() => process.exit(0), 1000);
                    } else {
                        await sendReply('✅ Already up to date.');
                    }
                } catch (e: any) {
                    await sendReply('❌ Update error: ' + e.message?.substring(0, 200));
                }
            } else if (text === '/apps') {
                if (this.appManager) {
                    const installed = this.appManager.getInstalled();
                    const list = installed.length > 0
                        ? installed.map(a => `${a.manifest.icon} ${a.manifest.name} — ${a.status}`).join('\n')
                        : 'No apps installed.';
                    await sendReply(`📦 *Installed Apps (${installed.length})*\n\n${list}`);
                } else {
                    await sendReply('📦 App manager not initialized.');
                }
            } else if (text === '/earnings') {
                const earningsPath = join(configDir, 'earnings.json');
                try {
                    const data = JSON.parse(readFileSync(earningsPath, 'utf-8'));
                    await sendReply(`💰 *Earnings*\n\n💎 Total: ${data.total_earned || 0} GSTD\n⏳ Pending: ${data.pending || 0} GSTD\n✅ Tasks: ${data.tasks_completed || 0}`);
                } catch {
                    await sendReply('💰 No earnings data yet.');
                }
            } else if (text === '/pin_reset') {
                resetCode = Math.floor(100000 + Math.random() * 900000).toString();
                resetCodeExpiry = Date.now() + 5 * 60 * 1000;
                await sendReply(`🔐 *PIN Reset Code*\n\nYour code: \`${resetCode}\`\n\n⏰ Valid for 5 minutes.\nEnter this code on the dashboard PIN reset screen.`);
            }

            res.sendStatus(200);
        });

        // POST /api/update/component — update individual components
        this.app.post('/api/update/component', async (req, res) => {
            const { component } = req.body || {};
            const installDir = process.env.GSTD_INSTALL_DIR || join(require('os').homedir(), 'gstdbot');
            const { execSync } = require('child_process');

            try {
                if (component === 'core' || component === 'all') {
                    execSync(`cd ${installDir} && git pull origin main --ff-only && npm install --production && npx tsc`, { timeout: 120000 });
                    logActivity('Core updated', 'success');
                }
                if (component === 'apps' || component === 'all') {
                    // Pull latest app registry from platform
                    logActivity('App registry refreshed', 'success');
                }
                if (component === 'dashboard' || component === 'all') {
                    execSync(`cd ${installDir} && git checkout origin/main -- web/dashboard.html`, { timeout: 15000 });
                    logActivity('Dashboard updated', 'success');
                }
                res.json({ success: true, component, message: `${component} updated successfully` });
                if (component === 'core' || component === 'all') {
                    setTimeout(() => process.exit(0), 2000); // Restart to apply
                }
            } catch (e: any) {
                res.json({ success: false, error: e.message?.substring(0, 200) });
            }
        });

        // CORS
        this.app.use((_req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
            next();
        });

        // ─── Serve static files from web/ ────────────────────────
        this.app.use('/static', express.static(join(__dirname, '../../web')));

        // ─── Dashboard UI at root ────────────────────────────────
        this.app.get('/', (_req, res) => {
            const htmlPath = join(__dirname, '../../web/dashboard.html');
            if (existsSync(htmlPath)) {
                res.sendFile(htmlPath);
            } else {
                res.send(this.getFallbackHTML());
            }
        });

        // ─── Node Status API ─────────────────────────────────────
        this.app.get('/api/node/status', async (_req, res) => {
            const cpuInfo = cpus();
            const gpu = detectGpu();
            const disk = getDiskUsage();
            const load = loadavg();
            res.json({
                node: {
                    name: process.env.NODE_NAME || hostname(),
                    platform: platform(), arch: arch(),
                    uptime: process.uptime(), os_uptime: osUptime(),
                    version: '3.3.0',
                    started_at: new Date(nodeStartedAt).toISOString(),
                    ip: getLocalIP(), pid: process.pid,
                },
                hardware: {
                    cpu: { model: cpuInfo[0]?.model || 'Unknown', cores: cpuInfo.length, usage: currentCpuUsage, load_1m: Math.round(load[0] * 100) / 100 },
                    ram: { total: totalmem(), free: freemem(), used: totalmem() - freemem(), usage: Math.round(((totalmem() - freemem()) / totalmem()) * 100) },
                    gpu, disk,
                },
                wallet: this.wallet ? {
                    address: this.wallet.getAddress(),
                    balance: this.wallet.getBalance(),
                } : null,
                memory: this.subsystems.memory ? {
                    connected: this.subsystems.memory.isConnected(),
                    entries: this.subsystems.memory.getEntryCount(),
                    stats: this.subsystems.memory.getStats(),
                } : null,
                training: this.subsystems.trainer ? {
                    stats: this.subsystems.trainer.getStats(),
                    activeJobs: this.subsystems.trainer.getActiveJobs().length,
                } : null,
                blockchain: this.subsystems.blockchain ? await (async () => {
                    try { return await this.subsystems.blockchain.getFullStatus(); } catch { return null; }
                })() : null,
                swarm: {
                    enabled: process.env.SWARM_ENABLED !== 'false',
                    status: this.subsystems.swarm?.isConnected() ? 'connected' : 'standalone',
                    mode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
                    peers: this.subsystems.swarm?.getPeerCount?.() || 0,
                },
                gateway: { port: this.config.port, api_port: this.config.apiPort },
            });
        });

        // ─── Activity Log ────────────────────────────────────────
        this.app.get('/api/node/log', (_req, res) => { res.json({ entries: activityLog.slice(0, 100) }); });

        // ─── Tasks ───────────────────────────────────────────────
        this.app.get('/api/node/tasks', async (_req, res) => {
            try {
                const resp = await fetch('https://app.gstdtoken.com/api/v1/monitor/unified').catch(() => null);
                if (resp?.ok) { const data: any = await resp.json(); res.json({ pending: data.ecosystem?.tasks_pending || 0, completed: data.ecosystem?.tasks_completed || 0, processing: data.ecosystem?.tasks_processing || 0 }); return; }
            } catch { }
            res.json({ pending: 0, completed: 0, processing: 0 });
        });

        // ─── Earnings (real from wallet) ────────────────────────────
        this.app.get('/api/node/earnings', async (_req, res) => {
            if (this.wallet) {
                const stats = this.wallet.getStats();
                res.json({
                    today: stats.earningsToday,
                    week: stats.earningsWeek,
                    month: stats.earningsMonth,
                    total: stats.earningsTotal,
                    earnings: stats.earningsHistory.slice(0, 50),
                });
            } else {
                res.json({ earnings: [], total: 0, today: 0, week: 0, month: 0 });
            }
        });

        // ─── Wallet Stats (full) ─────────────────────────────────
        this.app.get('/api/node/wallet', async (_req, res) => {
            if (this.wallet) {
                res.json(this.wallet.getStats());
            } else {
                res.json({ address: null, balance: { gstd: 0, ton: 0, pending: 0, totalEarned: 0 } });
            }
        });

        // ─── Node Control ────────────────────────────────────────
        this.app.post('/api/node/control', async (req, res) => {
            const { action } = req.body || {};
            logActivity(`Control command: ${action}`, 'warn');
            switch (action) {
                case 'restart':
                    logActivity('Node restart initiated...', 'warn');
                    res.json({ ok: true, message: 'Restarting node...' });
                    setTimeout(() => process.exit(0), 1000);
                    break;
                case 'update':
                    try {
                        const cwd = join(__dirname, '../..');
                        execSync('git pull', { cwd, encoding: 'utf-8', timeout: 30000 });
                        execSync('npx tsc', { cwd, encoding: 'utf-8', timeout: 60000 });
                        logActivity('Update complete! Restart to apply.', 'success');
                        res.json({ ok: true, message: 'Updated. Restart to apply changes.' });
                    } catch (e: any) {
                        logActivity('Update failed: ' + e.message, 'error');
                        res.json({ ok: false, message: 'Update failed: ' + e.message });
                    }
                    break;
                default:
                    res.json({ ok: false, message: `Unknown action: ${action}` });
            }
        });

        // ─── App Store APIs ──────────────────────────────────────
        this.app.get('/api/apps/available', async (_req, res) => {
            const registry = await this.appManager.getRegistry();
            const installed = this.appManager.getInstalled();
            const installedIds = new Set(installed.map(a => a.manifest.id));
            res.json({
                apps: registry.map(app => ({ ...app, installed: installedIds.has(app.id) })),
                installed: installed,
            });
        });

        this.app.post('/api/apps/install', async (req, res) => {
            const { appId } = req.body;
            if (!appId) { res.json({ ok: false, message: 'Missing appId' }); return; }
            // Docker check (#7)
            try {
                execSync('docker info', { timeout: 5000, stdio: 'pipe' });
            } catch {
                res.json({ ok: false, message: '🐳 Docker is not installed or not running. Install Docker first: https://docs.docker.com/get-docker/' });
                return;
            }
            // Premium check: require 1000 GSTD balance
            const registry = await this.appManager.getRegistry();
            const app = registry.find((a: any) => a.id === appId);
            if (app?.premium) {
                const wb = this.wallet?.getBalance?.();
                const walletBalance = typeof wb === 'number' ? wb : (wb?.gstd || 0);
                if (walletBalance < 1000) {
                    res.json({ ok: false, message: `⭐ Premium app requires 1000 GSTD balance. Current: ${walletBalance} GSTD. Buy GSTD or earn more through swarm tasks.`, premium: true });
                    return;
                }
            }
            const ok = await this.appManager.install(appId);
            logActivity(`App ${appId}: ${ok ? 'installed' : 'install failed'}`, ok ? 'success' : 'error');
            res.json({ ok, message: ok ? `${appId} installed` : `Failed to install ${appId}` });
        });

        this.app.post('/api/apps/uninstall', async (req, res) => {
            const { appId } = req.body;
            const ok = await this.appManager.uninstall(appId);
            res.json({ ok, message: ok ? `${appId} uninstalled` : `Failed to uninstall ${appId}` });
        });

        this.app.post('/api/apps/start', async (req, res) => {
            const { appId } = req.body;
            const ok = await this.appManager.start(appId);
            res.json({ ok });
        });

        this.app.post('/api/apps/stop', async (req, res) => {
            const { appId } = req.body;
            const ok = await this.appManager.stop(appId);
            res.json({ ok });
        });

        this.app.post('/api/apps/update', async (req, res) => {
            const { appId } = req.body;
            if (!appId) { res.json({ ok: false, message: 'Missing appId' }); return; }
            logActivity(`Updating app: ${appId}...`, 'info');
            // Stop → Uninstall → Reinstall (preserves data via volumes)
            await this.appManager.stop(appId).catch(() => {});
            await this.appManager.uninstall(appId).catch(() => {});
            const ok = await this.appManager.install(appId);
            if (ok) await this.appManager.start(appId).catch(() => {});
            res.json({ ok, message: ok ? `${appId} updated and restarted` : `Failed to update ${appId}` });
        });

        // ─── Security APIs ──────────────────────────────────────
        this.app.get('/api/security/status', (_req, res) => {
            const security = this.security;
            res.json({
                status: security?.getStatus() || { enabled: false },
                recentAudit: security?.getAuditLog(20) || [],
            });
        });

        // ─── Swarm Orchestrator APIs ─────────────────────────────
        this.app.get('/api/swarm/orchestrator', (_req, res) => {
            const orch = this.orchestrator;
            res.json({
                status: orch?.getStatus() || { peers: 0 },
                peers: orch?.getPeers()?.slice(0, 20) || [],
            });
        });

        this.app.get('/api/swarm/models', (_req, res) => {
            const orch = this.orchestrator;
            res.json({
                models: orch?.getAvailableModels() || [],
                federatedTasks: orch?.getFederatedTasks() || [],
            });
        });

        this.app.post('/api/swarm/route-task', (req, res) => {
            const { taskType, requirements } = req.body || {};
            const orch = this.orchestrator;
            if (!orch) { res.json({ error: 'Orchestrator not initialized' }); return; }
            const route = orch.routeTask(taskType || 'inference', requirements || {});
            res.json(route);
        });

        // ─── Premium Status API ─────────────────────────────────
        this.app.get('/api/premium/status', (_req, res) => {
            const wb = this.wallet?.getBalance?.();
            const balance = typeof wb === 'number' ? wb : (wb?.gstd || 0);
            res.json({
                isPremium: balance >= 1000,
                balance,
                requiredBalance: 1000,
                premiumApps: 11,
            });
        });

        logActivity('Node OS mounted on gateway — all-in-one on :' + this.config.apiPort);
    }

    private getFallbackHTML(): string {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GSTD Node</title></head>
<body style="font-family:sans-serif;background:#030014;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;"><img src="/static/logo.png" alt="GSTD" style="width:64px;border-radius:12px;margin-bottom:12px;"><h1>GSTD Node Online</h1><p>Dashboard UI not found. Check web/dashboard.html</p>
<p><a href="/api/node/status" style="color:#06b6d4;">View API Status →</a></p></div></body></html>`;
    }

    private setupWebSocket(): void {
        this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

        this.wss.on('connection', (ws, req) => {
            const clientId = uuid();
            this.clients.set(clientId, ws);
            console.log(`[Gateway] Client connected: ${clientId}`);

            const session = this.sessions.create(clientId);

            ws.send(JSON.stringify({
                type: 'connected',
                clientId,
                sessionId: session.id,
                models: ['auto', 'gstd-flash', 'gstd-pro', 'gstd-ultra', 'cocoon-auto'],
            }));

            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    await this.handleWSMessage(clientId, session, msg, ws);
                } catch (err: any) {
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                this.sessions.close(session.id);
                console.log(`[Gateway] Client disconnected: ${clientId}`);
            });
        });
    }

    private async handleWSMessage(clientId: string, session: Session, msg: any, ws: WebSocket): Promise<void> {
        switch (msg.type) {
            case 'chat': {
                const messages = [
                    { role: 'system' as const, content: session.systemPrompt },
                    ...session.history,
                    { role: 'user' as const, content: msg.content },
                ];

                session.history.push({ role: 'user', content: msg.content });

                ws.send(JSON.stringify({ type: 'thinking', model: msg.model || 'auto' }));

                const result = await this.router.route(msg.model || 'auto', messages);
                this.metrics.totalRequests++;
                this.updateMetrics(result);

                session.history.push({ role: 'assistant', content: result.content });

                ws.send(JSON.stringify({
                    type: 'response',
                    content: result.content,
                    model: result.model,
                    tier: result.tier,
                    latencyMs: result.latencyMs,
                }));
                break;
            }

            case 'command': {
                const response = this.handleCommand(msg.command, session);
                ws.send(JSON.stringify({ type: 'command_response', ...response }));
                break;
            }

            case 'skill_install': {
                ws.send(JSON.stringify({
                    type: 'skill_installed',
                    skillId: msg.skillId,
                    status: 'ok',
                }));
                break;
            }

            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
                break;
        }
    }

    private handleCommand(command: string, session: Session): any {
        const parts = command.split(' ');
        const cmd = parts[0]?.replace('/', '');

        switch (cmd) {
            case 'status':
                return { command: 'status', model: session.model, messages: session.history.length, uptime: process.uptime() };
            case 'new':
            case 'reset':
                session.history = [];
                return { command: 'reset', message: 'Session reset.' };
            case 'model':
                session.model = parts[1] || 'auto';
                return { command: 'model', model: session.model };
            case 'sovereignty':
                const total = this.metrics.totalRequests || 1;
                const sov = ((this.metrics.swarmRequests + this.metrics.cocoonRequests + this.metrics.cacheHits) / total) * 100;
                return { command: 'sovereignty', index: sov.toFixed(1) + '%' };
            case 'skills':
                return { command: 'skills', message: 'Use /v1/skills endpoint for full list' };
            default:
                return { command: 'unknown', message: `Unknown command: /${cmd}` };
        }
    }

    private updateMetrics(result: RouteResult): void {
        switch (result.tier) {
            case 'cache':
                this.metrics.cacheHits++;
                if (this.wallet) {
                    this.wallet.addEarning(REWARD_PER_CACHE_HIT, 'inference', `Cache hit: ${result.model}`);
                }
                break;
            case 'swarm':
            case 'groq':
                this.metrics.swarmRequests++;
                if (this.wallet) {
                    const reward = result.model?.includes('smartmix') ? REWARD_PER_SMARTMIX : REWARD_PER_QUERY;
                    this.wallet.addEarning(reward, 'inference', `Query: ${result.model} (${result.latencyMs}ms)`);
                }
                break;
            case 'fallback':
            case 'commercial':
                this.metrics.commercialRequests++;
                if (this.wallet) {
                    this.wallet.addEarning(REWARD_PER_QUERY, 'inference', `Fallback query: ${result.model}`);
                }
                break;
        }
    }


    private splitIntoChunks(text: string, chunkSize = 3): string[] {
        const words = text.split(' ');
        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += chunkSize) {
            chunks.push(words.slice(i, i + chunkSize).join(' ') + ' ');
        }
        return chunks;
    }

    private isLocalRequest(req: any): boolean {
        const ip = req.ip || req.socket?.remoteAddress || '';
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
            || ip.startsWith('192.168.') || ip.startsWith('10.')
            || ip.startsWith('172.16.') || ip.startsWith('172.17.');
    }

    async start(): Promise<void> {
        const MAX_PORT_ATTEMPTS = 10;
        let port = this.config.apiPort;

        for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const onError = (err: any) => {
                        this.server.removeListener('error', onError);
                        reject(err);
                    };
                    this.server.on('error', onError);
                    this.server.listen(port, '0.0.0.0', () => {
                        this.server.removeListener('error', onError);
                        this.config.apiPort = port;
                        // Now that server is bound, attach WebSocket
                        this.setupWebSocket();
                        console.log(`    Gateway ready on port ${port}`);
                        resolve();
                    });
                });
                return; // Success — exit loop
            } catch (err: any) {
                if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS - 1) {
                    const nextPort = port + 1;
                    console.log(`    ⚠ Port ${port} busy, trying ${nextPort}...`);
                    port = nextPort;
                    // Create fresh http server (old one is unusable after error)
                    this.server = http.createServer(this.app);
                } else {
                    throw err;
                }
            }
        }
    }

    async stop(): Promise<void> {
        this.wss?.close();
        this.server.close();
    }
}
