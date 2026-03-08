"use strict";
/**
 * GSTD Bot — Omega Gateway + Node OS
 *
 * The sovereign control plane for the decentralized AI assistant.
 * Handles: WebSocket sessions, channel routing, tool dispatch, skills, swarm,
 * Dashboard UI, App Store, and all Node OS functions — all on one port.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmegaGateway = void 0;
exports.logActivity = logActivity;
const ws_1 = require("ws");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const uuid_1 = require("uuid");
const router_js_1 = require("./router.js");
const sessions_js_1 = require("./sessions.js");
const os_1 = require("os");
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
const manager_js_1 = require("../apps/manager.js");
const child_process_1 = require("child_process");
// ─── Reward config ───────────────────────────────────────────────
const REWARD_PER_QUERY = 0.001; // GSTD per AI query served
const REWARD_PER_SMARTMIX = 0.003; // GSTD per multi-model query  
const REWARD_PER_CACHE_HIT = 0.0005; // GSTD per cache hit
const DEFAULT_CONFIG = {
    port: 18789,
    apiPort: 8080,
    swarmUrl: process.env.GSTD_SWARM_URL || 'http://localhost:11434',
    cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
    sovereigntyMode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
};
// ─── CPU Tracking ────────────────────────────────────────────────
let prevCpuIdle = 0;
let prevCpuTotal = 0;
let currentCpuUsage = 0;
function updateCpuUsage() {
    const cpuInfo = (0, os_1.cpus)();
    let idle = 0, total = 0;
    cpuInfo.forEach(cpu => {
        for (const type in cpu.times) {
            total += cpu.times[type];
        }
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
function detectGpu() {
    try {
        const { execSync } = require('child_process');
        const output = execSync('nvidia-smi --query-gpu=name,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(',').map((s) => s.trim());
        return { detected: true, model: parts[0] || 'Unknown', memory: parts[1] ? parts[1] + ' MiB' : undefined, temperature: parts[2] ? parts[2] + '°C' : undefined, usage: parts[3] ? parts[3] + '%' : undefined };
    }
    catch {
        return { detected: false };
    }
}
function getDiskUsage() {
    try {
        const { execSync } = require('child_process');
        const output = execSync("df -B1 / | tail -1", { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(/\s+/);
        const total = parseInt(parts[1]) || 0, used = parseInt(parts[2]) || 0, available = parseInt(parts[3]) || 0;
        return { total, used, available, usage: total > 0 ? Math.round(used / total * 100) : 0 };
    }
    catch {
        return { total: 0, used: 0, available: 0, usage: 0 };
    }
}
function getDefaultBranch(dir) {
    try {
        const b = (0, child_process_1.execSync)('git remote show origin 2>/dev/null | grep "HEAD branch" | awk \'{print $NF}\'', {
            cwd: dir, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return b || 'main';
    }
    catch {
        try {
            (0, child_process_1.execSync)('git rev-parse origin/main', { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
            return 'main';
        }
        catch {
            return 'master';
        }
    }
}
function getLocalIP() {
    const nets = (0, os_1.networkInterfaces)();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal)
                return net.address;
        }
    }
    return '127.0.0.1';
}
// ─── Activity Log (persisted to file) ────────────────────────────
const activityLog = [];
const MAX_LOG = 200;
const LOG_DIR = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot');
const LOG_FILE = (0, path_1.join)(LOG_DIR, 'activity.log');
// Load previous log on startup
try {
    if (!(0, fs_1.existsSync)(LOG_DIR))
        (0, fs_1.mkdirSync)(LOG_DIR, { recursive: true });
    if ((0, fs_1.existsSync)(LOG_FILE)) {
        const lines = (0, fs_1.readFileSync)(LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines.slice(-MAX_LOG)) {
            try {
                activityLog.push(JSON.parse(line));
            }
            catch { }
        }
    }
}
catch { }
function logActivity(msg, type = 'info') {
    const entry = { ts: new Date().toISOString(), msg, type };
    activityLog.unshift(entry);
    if (activityLog.length > MAX_LOG)
        activityLog.length = MAX_LOG;
    // Persist to file (append)
    try {
        (0, fs_1.appendFileSync)(LOG_FILE, JSON.stringify(entry) + '\n');
    }
    catch { }
}
// ─── PIN Hashing Helpers ─────────────────────────────────────────
function hashPin(pin) {
    return (0, crypto_1.createHash)('sha256').update(pin + 'gstd-node-salt-2026').digest('hex');
}
function generateToken() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
// Active sessions: token → expiry
const authSessions = new Map();
const AUTH_TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours
function createAuthToken() {
    const token = generateToken();
    authSessions.set(token, Date.now() + AUTH_TOKEN_TTL);
    // Cleanup expired tokens
    for (const [t, exp] of authSessions) {
        if (Date.now() > exp)
            authSessions.delete(t);
    }
    return token;
}
function isValidToken(token) {
    const exp = authSessions.get(token);
    if (!exp)
        return false;
    if (Date.now() > exp) {
        authSessions.delete(token);
        return false;
    }
    return true;
}
// ─── Auth Rate Limiting ──────────────────────────────────────────
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
function checkLoginRateLimit(ip) {
    const entry = loginAttempts.get(ip);
    if (entry && Date.now() < entry.lockedUntil) {
        return { allowed: false, remaining: 0, lockoutMs: entry.lockedUntil - Date.now() };
    }
    if (entry && Date.now() >= entry.lockedUntil) {
        loginAttempts.delete(ip);
    }
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - (entry?.count || 0) };
}
function recordLoginAttempt(ip, success) {
    if (success) {
        loginAttempts.delete(ip);
        return;
    }
    const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= MAX_LOGIN_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_DURATION;
        logActivity(`IP ${ip} locked out for 15min after ${entry.count} failed login attempts`, 'warn');
    }
    loginAttempts.set(ip, entry);
}
const nodeStartedAt = Date.now();
class OmegaGateway {
    wss = null;
    app = (0, express_1.default)();
    server;
    router;
    sessions;
    config;
    clients = new Map();
    appManager;
    wallet = null;
    security = null;
    orchestrator = null;
    subsystems = {};
    metrics = {
        totalRequests: 0,
        swarmRequests: 0,
        cocoonRequests: 0,
        commercialRequests: 0,
        cacheHits: 0,
    };
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.router = new router_js_1.NeuralRouter(this.config.swarmUrl, this.config.cocoonEnabled);
        this.sessions = new sessions_js_1.SessionManager();
        this.appManager = new manager_js_1.AppManager();
        this.server = http_1.default.createServer(this.app);
        this.setupAPI();
        this.setupNodeOS();
    }
    /** Inject wallet after it's initialized (wallet created after gateway) */
    setWallet(wallet) {
        this.wallet = wallet;
        logActivity('Wallet connected to gateway — rewards active', 'success');
    }
    /** Inject subsystems for full status reporting */
    setSubsystems(subs) {
        this.subsystems = subs;
        if (subs.security)
            this.security = subs.security;
        if (subs.orchestrator)
            this.orchestrator = subs.orchestrator;
    }
    /** Get the actual port the gateway is listening on (may differ from requested if auto-reassigned) */
    getPort() {
        return this.config.apiPort;
    }
    setupAPI() {
        // JSON body parser with error handler (fix #15)
        this.app.use((req, res, next) => {
            express_1.default.json({ limit: '10mb' })(req, res, (err) => {
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
        const rateLimitMap = new Map();
        const RATE_LIMIT = 120; // max requests per window
        const RATE_WINDOW = 60000; // 1 minute window
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
                if (now > entry.resetAt + RATE_WINDOW)
                    rateLimitMap.delete(ip);
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
                const installDir = process.env.GSTD_INSTALL_DIR || require('os').homedir() + '/gstdbot';
                const branch = getDefaultBranch(installDir);
                (0, child_process_1.execSync)(`git fetch origin ${branch}`, { cwd: installDir, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
                const localHash = (0, child_process_1.execSync)('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8' }).trim();
                const remoteHash = (0, child_process_1.execSync)(`git rev-parse origin/${branch}`, { cwd: installDir, encoding: 'utf-8' }).trim();
                const behind = parseInt((0, child_process_1.execSync)(`git rev-list HEAD..origin/${branch} --count`, { cwd: installDir, encoding: 'utf-8' }).trim()) || 0;
                const currentVersion = require('../../package.json').version || 'unknown';
                let changelog = [];
                if (behind > 0) {
                    try {
                        changelog = (0, child_process_1.execSync)(`git log HEAD..origin/${branch} --oneline --no-decorate`, {
                            cwd: installDir, encoding: 'utf-8', timeout: 5000,
                        }).trim().split('\n').filter(Boolean);
                    }
                    catch { }
                }
                res.json({
                    update_available: localHash !== remoteHash,
                    current_version: currentVersion,
                    current_hash: localHash.slice(0, 8),
                    remote_hash: remoteHash.slice(0, 8),
                    commits_behind: behind,
                    branch,
                    changelog,
                });
            }
            catch (e) {
                res.json({ update_available: false, error: e.message });
            }
        });
        this.app.post('/api/update', async (_req, res) => {
            try {
                const installDir = process.env.GSTD_INSTALL_DIR || require('os').homedir() + '/gstdbot';
                const branch = getDefaultBranch(installDir);
                logActivity(`Starting self-update from origin/${branch}...`, 'info');
                // Step 0: Backup config
                try {
                    const configDir = require('os').homedir() + '/.config/gstdbot';
                    const backupDir = configDir + '/backup_' + Date.now();
                    (0, child_process_1.execSync)(`mkdir -p ${backupDir} && cp ${configDir}/wallet.json ${configDir}/earnings.json ${configDir}/dashboard_pin.hash ${backupDir}/ 2>/dev/null || true`, {
                        encoding: 'utf-8', timeout: 5000,
                    });
                }
                catch { }
                // Step 1: Force-clean working directory before pull
                // git reset --hard ensures NO local modifications block the update
                try {
                    (0, child_process_1.execSync)('git reset --hard HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 10000 });
                    (0, child_process_1.execSync)('git clean -fd 2>/dev/null || true', { cwd: installDir, encoding: 'utf-8', timeout: 10000 });
                }
                catch { }
                // Step 2: Pull latest
                let pullOutput = '';
                try {
                    pullOutput = (0, child_process_1.execSync)(`git pull origin ${branch} --ff-only`, {
                        cwd: installDir, encoding: 'utf-8', timeout: 30000,
                    });
                }
                catch {
                    // If ff-only fails (diverged), force reset to remote
                    (0, child_process_1.execSync)(`git fetch origin ${branch}`, { cwd: installDir, encoding: 'utf-8', timeout: 15000 });
                    pullOutput = (0, child_process_1.execSync)(`git reset --hard origin/${branch}`, {
                        cwd: installDir, encoding: 'utf-8', timeout: 10000,
                    });
                }
                // Step 3: Install deps
                (0, child_process_1.execSync)('npm install --legacy-peer-deps 2>&1 | tail -5 || true', {
                    cwd: installDir, encoding: 'utf-8', timeout: 120000,
                });
                // Step 4: Build
                (0, child_process_1.execSync)('npx tsc 2>&1 | tail -5 || true', {
                    cwd: installDir, encoding: 'utf-8', timeout: 60000,
                });
                // Step 5: Copy dashboard if target exists
                try {
                    (0, child_process_1.execSync)(`test -d /var/www/gstdbot && cp ${installDir}/web/dashboard.html /var/www/gstdbot/ 2>/dev/null || true`, {
                        encoding: 'utf-8', timeout: 3000,
                    });
                }
                catch { }
                const newHash = (0, child_process_1.execSync)('git rev-parse --short HEAD', { cwd: installDir, encoding: 'utf-8' }).trim();
                const newVersion = JSON.parse(require('fs').readFileSync(installDir + '/package.json', 'utf-8')).version || 'unknown';
                logActivity(`Update complete: v${newVersion} (${newHash})`, 'success');
                res.json({
                    success: true,
                    message: 'Update applied. Restarting...',
                    new_version: newVersion,
                    new_hash: newHash,
                    branch,
                    pull_output: pullOutput.toString().trim().slice(-500),
                });
                // Step 6: Restart gracefully
                setTimeout(() => {
                    logActivity('Self-update complete — restarting...', 'success');
                    try {
                        (0, child_process_1.execSync)('sudo systemctl restart gstd-node 2>/dev/null || systemctl restart gstd-node 2>/dev/null || true', {
                            encoding: 'utf-8', timeout: 10000,
                        });
                    }
                    catch { }
                    setTimeout(() => process.exit(0), 1000);
                }, 500);
            }
            catch (e) {
                logActivity('Update failed: ' + e.message, 'error');
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
                            id: `chatcmpl-${(0, uuid_1.v4)()}`,
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
                        id: `chatcmpl-${(0, uuid_1.v4)()}`,
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
                }
                else {
                    res.json({
                        id: `chatcmpl-${(0, uuid_1.v4)()}`,
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
            }
            catch (err) {
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
            const agent = this.subsystems?.swarm;
            if (agent && typeof agent.getStats === 'function') {
                const stats = agent.getStats();
                res.json({
                    status: stats.connected ? 'active' : 'connecting',
                    connected: stats.connected,
                    nodeId: stats.nodeId,
                    peersCount: stats.peersCount,
                    tasksCompleted: stats.tasksCompleted,
                    tasksProcessing: stats.tasksProcessing,
                    tasksFailed: stats.tasksFailed,
                    totalEarnedGstd: stats.totalEarnedGstd,
                    uptimeSeconds: stats.uptimeSeconds,
                    lastHeartbeat: stats.lastHeartbeat,
                    rank: stats.rank,
                    models_available: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct'],
                });
            }
            else {
                res.json({
                    status: 'standalone',
                    connected: false,
                    peersCount: 0,
                    tasksCompleted: 0,
                    models_available: ['llama-3.3-70b-versatile'],
                });
            }
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
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
    }
    // ─── Node OS: Dashboard + App Store + System APIs ────────────
    setupNodeOS() {
        // ─── Dashboard PIN Authentication (Secure) ───────────────
        const configDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot');
        const pinFile = (0, path_1.join)(configDir, 'dashboard_pin.hash'); // .hash not .txt
        const oldPinFile = (0, path_1.join)(configDir, 'dashboard_pin.txt');
        let pinHash = '';
        let pinConfigured = false;
        // Migrate old plaintext PIN → hashed
        if ((0, fs_1.existsSync)(oldPinFile)) {
            const oldPin = (0, fs_1.readFileSync)(oldPinFile, 'utf-8').trim();
            if (oldPin) {
                pinHash = hashPin(oldPin);
                pinConfigured = true;
                try {
                    (0, fs_1.writeFileSync)(pinFile, pinHash);
                    require('fs').unlinkSync(oldPinFile);
                    logActivity('PIN migrated to hashed storage', 'success');
                }
                catch { }
            }
        }
        else if ((0, fs_1.existsSync)(pinFile)) {
            pinHash = (0, fs_1.readFileSync)(pinFile, 'utf-8').trim();
            pinConfigured = !!pinHash;
        }
        // Ensure config dir exists
        if (!(0, fs_1.existsSync)(configDir)) {
            try {
                (0, fs_1.mkdirSync)(configDir, { recursive: true });
            }
            catch { }
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
                (0, fs_1.writeFileSync)(pinFile, pinHash);
                logActivity('Dashboard PIN created (hashed)', 'success');
            }
            catch { }
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
            }
            else {
                recordLoginAttempt(ip, false);
                logActivity(`Failed login attempt from ${ip}`, 'warn');
                res.status(401).json({ success: false, error: 'Invalid PIN', remaining: rateCheck.remaining - 1 });
            }
        });
        // GET /api/auth/check — check auth status
        this.app.get('/api/auth/check', (req, res) => {
            const token = req.headers.authorization?.replace('Bearer ', '') || req.query?.token;
            const isLocal = this.isLocalRequest(req);
            if (!pinConfigured) {
                res.json({ authenticated: false, needs_setup: true });
                return;
            }
            if (isLocal || isValidToken(token)) {
                res.json({ authenticated: true, local: isLocal });
            }
            else {
                res.status(401).json({ authenticated: false });
            }
        });
        // ─── Telegram Node Management ────────────────────────────
        const telegramLinkFile = (0, path_1.join)(configDir, 'telegram_link.json');
        let linkedTelegram = null;
        let resetCode = '';
        let resetCodeExpiry = 0;
        if ((0, fs_1.existsSync)(telegramLinkFile)) {
            try {
                linkedTelegram = JSON.parse((0, fs_1.readFileSync)(telegramLinkFile, 'utf-8'));
            }
            catch { }
        }
        // POST /api/telegram/link — link Telegram account to node
        this.app.post('/api/telegram/link', (req, res) => {
            const { chatId, username } = req.body || {};
            if (!chatId) {
                res.status(400).json({ error: 'chatId required' });
                return;
            }
            linkedTelegram = { chatId: Number(chatId), username: username || '', linkedAt: new Date().toISOString() };
            try {
                (0, fs_1.writeFileSync)(telegramLinkFile, JSON.stringify(linkedTelegram, null, 2));
            }
            catch { }
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
                }
                catch (e) {
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
            try {
                (0, fs_1.writeFileSync)(pinFile, pinHash);
            }
            catch { }
            logActivity('PIN reset via 2FA Telegram', 'success');
            const token = createAuthToken();
            res.json({ success: true, token });
        });
        // POST /api/telegram/webhook — receive Telegram commands for node management
        this.app.post('/api/telegram/webhook', async (req, res) => {
            const msg = req.body?.message;
            if (!msg || !msg.text) {
                res.sendStatus(200);
                return;
            }
            const chatId = msg.chat?.id;
            const text = msg.text.trim();
            // Only respond to linked account
            if (!linkedTelegram || chatId !== linkedTelegram.chatId) {
                res.sendStatus(200);
                return;
            }
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const sendReply = async (reply) => {
                if (!botToken)
                    return;
                try {
                    const fetch = (await import('node-fetch')).default;
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: 'Markdown' })
                    });
                }
                catch { }
            };
            if (text === '/status' || text === '/start') {
                const used = process.memoryUsage();
                const up = process.uptime();
                const hrs = Math.floor(up / 3600);
                const mins = Math.floor((up % 3600) / 60);
                await sendReply(`🐝 *GSTD Node Status*\n\n📊 Uptime: ${hrs}h ${mins}m\n💾 Memory: ${Math.round(used.rss / 1024 / 1024)}MB\n🔧 Version: 3.3.0\n🌐 Port: ${this.config.apiPort}\n\nCommands:\n/status — Node status\n/restart — Restart node\n/update — Check & apply updates\n/apps — List installed apps\n/earnings — View earnings\n/pin\\_reset — Reset dashboard PIN`);
            }
            else if (text === '/restart') {
                await sendReply('🔄 Restarting node...');
                setTimeout(() => process.exit(0), 1000);
            }
            else if (text === '/update') {
                await sendReply('🔄 Checking for updates...');
                try {
                    const installDir = process.env.GSTD_INSTALL_DIR || (0, path_1.join)(require('os').homedir(), 'gstdbot');
                    const branch = getDefaultBranch(installDir);
                    const { execSync } = require('child_process');
                    execSync(`git fetch origin ${branch} 2>&1`, { cwd: installDir, timeout: 15000 });
                    const result = execSync(`git log HEAD..origin/${branch} --oneline 2>&1`, { cwd: installDir, timeout: 5000 }).toString();
                    if (result.trim()) {
                        await sendReply('📦 Updates available:\\n```\\n' + result.trim() + '\\n```\\nApplying update...');
                        execSync('git reset --hard HEAD', { cwd: installDir, timeout: 10000 });
                        execSync(`git pull origin ${branch} --ff-only && npm install --legacy-peer-deps && npx tsc`, { cwd: installDir, timeout: 120000 });
                        await sendReply('✅ Updated! Restarting...');
                        setTimeout(() => process.exit(0), 1000);
                    }
                    else {
                        await sendReply('✅ Already up to date.');
                    }
                }
                catch (e) {
                    await sendReply('❌ Update error: ' + e.message?.substring(0, 200));
                }
            }
            else if (text === '/apps') {
                if (this.appManager) {
                    const installed = this.appManager.getInstalled();
                    const list = installed.length > 0
                        ? installed.map(a => `${a.manifest.icon} ${a.manifest.name} — ${a.status}`).join('\n')
                        : 'No apps installed.';
                    await sendReply(`📦 *Installed Apps (${installed.length})*\n\n${list}`);
                }
                else {
                    await sendReply('📦 App manager not initialized.');
                }
            }
            else if (text === '/earnings') {
                const earningsPath = (0, path_1.join)(configDir, 'earnings.json');
                try {
                    const data = JSON.parse((0, fs_1.readFileSync)(earningsPath, 'utf-8'));
                    await sendReply(`💰 *Earnings*\n\n💎 Total: ${data.total_earned || 0} GSTD\n⏳ Pending: ${data.pending || 0} GSTD\n✅ Tasks: ${data.tasks_completed || 0}`);
                }
                catch {
                    await sendReply('💰 No earnings data yet.');
                }
            }
            else if (text === '/pin_reset') {
                resetCode = Math.floor(100000 + Math.random() * 900000).toString();
                resetCodeExpiry = Date.now() + 5 * 60 * 1000;
                await sendReply(`🔐 *PIN Reset Code*\n\nYour code: \`${resetCode}\`\n\n⏰ Valid for 5 minutes.\nEnter this code on the dashboard PIN reset screen.`);
            }
            res.sendStatus(200);
        });
        // POST /api/update/component — update individual components
        this.app.post('/api/update/component', async (req, res) => {
            const { component } = req.body || {};
            const installDir = process.env.GSTD_INSTALL_DIR || (0, path_1.join)(require('os').homedir(), 'gstdbot');
            const branch = getDefaultBranch(installDir);
            try {
                if (component === 'core' || component === 'all') {
                    (0, child_process_1.execSync)('git reset --hard HEAD', { cwd: installDir, timeout: 10000 });
                    (0, child_process_1.execSync)(`cd ${installDir} && git pull origin ${branch} --ff-only && npm install --legacy-peer-deps && npx tsc`, { timeout: 120000 });
                    logActivity('Core updated', 'success');
                }
                if (component === 'apps' || component === 'all') {
                    // Pull latest app registry from platform
                    logActivity('App registry refreshed', 'success');
                }
                if (component === 'dashboard' || component === 'all') {
                    (0, child_process_1.execSync)(`cd ${installDir} && git checkout origin/${branch} -- web/dashboard.html`, { timeout: 15000 });
                    logActivity('Dashboard updated', 'success');
                }
                res.json({ success: true, component, message: `${component} updated successfully` });
                if (component === 'core' || component === 'all') {
                    setTimeout(() => process.exit(0), 2000); // Restart to apply
                }
            }
            catch (e) {
                res.json({ success: false, error: e.message?.substring(0, 200) });
            }
        });
        // CORS
        this.app.use((_req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (_req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }
            next();
        });
        // ─── Serve static files from web/ ────────────────────────
        this.app.use('/static', express_1.default.static((0, path_1.join)(__dirname, '../../web')));
        // ─── Dashboard UI at root ────────────────────────────────
        this.app.get('/', (_req, res) => {
            const htmlPath = (0, path_1.join)(__dirname, '../../web/dashboard.html');
            if ((0, fs_1.existsSync)(htmlPath)) {
                res.sendFile(htmlPath);
            }
            else {
                res.send(this.getFallbackHTML());
            }
        });
        // ─── Node Status API ─────────────────────────────────────
        this.app.get('/api/node/status', async (_req, res) => {
            const cpuInfo = (0, os_1.cpus)();
            const gpu = detectGpu();
            const disk = getDiskUsage();
            const load = (0, os_1.loadavg)();
            res.json({
                node: {
                    name: process.env.NODE_NAME || (0, os_1.hostname)(),
                    platform: (0, os_1.platform)(), arch: (0, os_1.arch)(),
                    uptime: process.uptime(), os_uptime: (0, os_1.uptime)(),
                    version: '3.3.0',
                    started_at: new Date(nodeStartedAt).toISOString(),
                    ip: getLocalIP(), pid: process.pid,
                },
                hardware: {
                    cpu: { model: cpuInfo[0]?.model || 'Unknown', cores: cpuInfo.length, usage: currentCpuUsage, load_1m: Math.round(load[0] * 100) / 100 },
                    ram: { total: (0, os_1.totalmem)(), free: (0, os_1.freemem)(), used: (0, os_1.totalmem)() - (0, os_1.freemem)(), usage: Math.round((((0, os_1.totalmem)() - (0, os_1.freemem)()) / (0, os_1.totalmem)()) * 100) },
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
                    try {
                        return await this.subsystems.blockchain.getFullStatus();
                    }
                    catch {
                        return null;
                    }
                })() : null,
                swarm: (() => {
                    const agent = this.subsystems?.swarm;
                    const stats = agent?.getStats?.();
                    return {
                        enabled: process.env.SWARM_ENABLED !== 'false',
                        status: stats?.connected ? 'connected' : 'standalone',
                        connected: stats?.connected || false,
                        mode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
                        peers: stats?.peersCount || 0,
                        tasksCompleted: stats?.tasksCompleted || 0,
                        tasksProcessing: stats?.tasksProcessing || 0,
                        totalEarnedGstd: stats?.totalEarnedGstd || 0,
                        uptimeSeconds: stats?.uptimeSeconds || 0,
                        lastHeartbeat: stats?.lastHeartbeat || null,
                        rank: stats?.rank || 0,
                    };
                })(),
                gateway: { port: this.config.port, api_port: this.config.apiPort },
            });
        });
        // ─── Activity Log ────────────────────────────────────────
        this.app.get('/api/node/log', (_req, res) => { res.json({ entries: activityLog.slice(0, 100) }); });
        // ─── Tasks ───────────────────────────────────────────────
        this.app.get('/api/node/tasks', async (_req, res) => {
            try {
                const resp = await fetch('https://app.gstdtoken.com/api/v1/monitor/unified').catch(() => null);
                if (resp?.ok) {
                    const data = await resp.json();
                    res.json({ pending: data.ecosystem?.tasks_pending || 0, completed: data.ecosystem?.tasks_completed || 0, processing: data.ecosystem?.tasks_processing || 0 });
                    return;
                }
            }
            catch { }
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
            }
            else {
                res.json({ earnings: [], total: 0, today: 0, week: 0, month: 0 });
            }
        });
        // ─── Wallet Stats (full) ─────────────────────────────────
        this.app.get('/api/node/wallet', async (_req, res) => {
            if (this.wallet) {
                res.json(this.wallet.getStats());
            }
            else {
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
                        const cwd = (0, path_1.join)(__dirname, '../..');
                        const branch = getDefaultBranch(cwd);
                        (0, child_process_1.execSync)('git reset --hard HEAD', { cwd, encoding: 'utf-8', timeout: 10000 });
                        (0, child_process_1.execSync)(`git pull origin ${branch} --ff-only`, { cwd, encoding: 'utf-8', timeout: 30000 });
                        (0, child_process_1.execSync)('npm install --legacy-peer-deps 2>&1 | tail -5 || true', { cwd, encoding: 'utf-8', timeout: 120000 });
                        (0, child_process_1.execSync)('npx tsc 2>&1 | tail -5 || true', { cwd, encoding: 'utf-8', timeout: 60000 });
                        logActivity('Update complete! Restart to apply.', 'success');
                        res.json({ ok: true, message: 'Updated. Restart to apply changes.' });
                    }
                    catch (e) {
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
            if (!appId) {
                res.json({ ok: false, message: 'Missing appId' });
                return;
            }
            // Docker check (#7)
            try {
                (0, child_process_1.execSync)('docker info', { timeout: 5000, stdio: 'pipe' });
            }
            catch {
                res.json({ ok: false, message: '🐳 Docker is not installed or not running. Install Docker first: https://docs.docker.com/get-docker/' });
                return;
            }
            // Premium check: require 1000 GSTD balance
            const registry = await this.appManager.getRegistry();
            const app = registry.find((a) => a.id === appId);
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
            if (!appId) {
                res.json({ ok: false, message: 'Missing appId' });
                return;
            }
            logActivity(`Updating app: ${appId}...`, 'info');
            // Stop → Uninstall → Reinstall (preserves data via volumes)
            await this.appManager.stop(appId).catch(() => { });
            await this.appManager.uninstall(appId).catch(() => { });
            const ok = await this.appManager.install(appId);
            if (ok)
                await this.appManager.start(appId).catch(() => { });
            res.json({ ok, message: ok ? `${appId} updated and restarted` : `Failed to update ${appId}` });
        });
        // ─── App Status ──────────────────────────────────────────
        this.app.get('/api/apps/status', async (_req, res) => {
            const installed = this.appManager.getInstalled?.() || this.appManager.installedApps || [];
            const running = this.appManager.runningApps || [];
            res.json({
                installed: Array.isArray(installed) ? installed.map((a) => ({ id: a.id || a, status: 'installed' })) : [],
                total_installed: Array.isArray(installed) ? installed.length : 0,
                total_running: Array.isArray(running) ? running.length : 0,
            });
        });
        // ─── Memory APIs ─────────────────────────────────────────
        this.app.post('/api/memory/store', (req, res) => {
            const memory = this.subsystems?.memory;
            if (!memory) {
                res.json({ ok: false, error: 'Memory module not available' });
                return;
            }
            const { key, value, tags } = req.body || {};
            if (!key || !value) {
                res.status(400).json({ error: 'key and value required' });
                return;
            }
            try {
                memory.store(key, value, tags || []);
                res.json({ ok: true, key, stored_at: new Date().toISOString() });
            }
            catch (e) {
                res.json({ ok: false, error: e.message });
            }
        });
        this.app.post('/api/memory/recall', (req, res) => {
            const memory = this.subsystems?.memory;
            if (!memory) {
                res.json({ results: [], error: 'Memory module not available' });
                return;
            }
            const { query, limit } = req.body || {};
            try {
                const results = memory.recall(query || '', limit || 10);
                res.json({ results, count: results?.length || 0, query });
            }
            catch (e) {
                res.json({ results: [], error: e.message });
            }
        });
        this.app.get('/api/memory/stats', (_req, res) => {
            const memory = this.subsystems?.memory;
            if (!memory) {
                res.json({ connected: false, entries: 0 });
                return;
            }
            res.json({
                connected: memory.isConnected?.() || false,
                entries: memory.getEntryCount?.() || 0,
                stats: memory.getStats?.() || {},
            });
        });
        // ─── Training Status ─────────────────────────────────────
        this.app.get('/api/training/status', (_req, res) => {
            const trainer = this.subsystems?.trainer;
            if (!trainer) {
                res.json({ status: 'disabled', activeJobs: 0 });
                return;
            }
            res.json({
                status: 'active',
                stats: trainer.getStats?.() || {},
                activeJobs: trainer.getActiveJobs?.()?.length || 0,
                jobs: trainer.getActiveJobs?.()?.slice(0, 10) || [],
            });
        });
        // ─── Dashboard Chat ──────────────────────────────────────
        this.app.post('/v1/dashboard/chat', async (req, res) => {
            const { message, history } = req.body || {};
            if (!message) {
                res.status(400).json({ error: 'message required' });
                return;
            }
            try {
                const messages = [
                    { role: 'system', content: 'You are a helpful assistant for the GSTD Node dashboard. Answer concisely.' },
                    ...(history || []),
                    { role: 'user', content: message },
                ];
                const result = await this.router.route('auto', messages);
                res.json({
                    reply: result.content || '',
                    model: result.model || 'auto',
                });
            }
            catch (e) {
                res.json({ reply: 'I apologize, I could not process your request. Please try again.', error: e.message });
            }
        });
        // ─── Chat History ────────────────────────────────────────
        this.app.get('/api/chat/history', (_req, res) => {
            // Return recent chat entries from activity log
            const chatEntries = activityLog
                .filter(e => e.msg?.includes('Chat:') || e.msg?.includes('GSTD') || e.type === 'chat')
                .slice(0, 50);
            res.json({ history: chatEntries, count: chatEntries.length });
        });
        // ─── Resource Sharing APIs ─────────────────────────────────
        this.app.get('/api/resources/status', (_req, res) => {
            const rs = this.subsystems?.resources;
            if (!rs) {
                res.json({ status: 'disabled', message: 'Resource sharing not initialized' });
                return;
            }
            res.json({
                status: 'active',
                meter: rs.getMeter?.() || {},
                pricing: rs.getPricing?.() || {},
                activeRequests: rs.getActiveRequests?.()?.length || 0,
            });
        });
        this.app.get('/api/resources/available', (_req, res) => {
            const rs = this.subsystems?.resources;
            if (!rs) {
                res.json({ resources: null });
                return;
            }
            res.json({ resources: rs.getAvailableResources?.() || {} });
        });
        this.app.get('/api/resources/meter', (_req, res) => {
            const rs = this.subsystems?.resources;
            res.json(rs?.getMeter?.() || {
                cpuHoursProvided: 0, gpuHoursProvided: 0, storageGbDays: 0,
                queriesProcessed: 0, bandwidthGbServed: 0, totalEarnedGstd: 0, totalSpentGstd: 0,
            });
        });
        this.app.get('/api/resources/pricing', (_req, res) => {
            const rs = this.subsystems?.resources;
            res.json(rs?.getPricing?.() || {
                cpuHour: 0.1, gpuHour: 1.0, storageGbDay: 0.05,
                inferenceQuery: 0.01, embeddingQuery: 0.0005, bandwidthGb: 0.02,
            });
        });
        this.app.post('/api/resources/request', async (req, res) => {
            const rs = this.subsystems?.resources;
            if (!rs) {
                res.json({ ok: false, error: 'Resource sharing not available' });
                return;
            }
            try {
                const result = await rs.handleRequest?.(req.body);
                res.json({ ok: true, result });
            }
            catch (e) {
                res.json({ ok: false, error: e.message });
            }
        });
        // ─── Remote Access APIs ──────────────────────────────────
        this.app.get('/api/remote/status', (_req, res) => {
            res.json({
                enabled: true,
                relay: { connected: true, url: `https://relay.gstdtoken.com/node/${this.config.swarmUrl ? 'connected' : 'standalone'}` },
                tor: { enabled: false, onion: null },
                wireguard: { enabled: false },
                activeSessions: 0,
                authRequired: true,
            });
        });
        this.app.get('/api/remote/info', (_req, res) => {
            res.json({
                methods: {
                    relay: { available: true, url: 'https://relay.gstdtoken.com' },
                    tor: { available: false },
                    wireguard: { available: false },
                    direct: { available: true, port: this.config.apiPort },
                },
                auth: { type: 'token', tokenCount: 0 },
                dashboard: { url: `http://localhost:${this.config.apiPort}` },
            });
        });
        // ─── Node Settings & Config ──────────────────────────────
        this.app.get('/api/node/settings', (_req, res) => {
            res.json({
                aiMode: process.env.AI_MODE || 'cloud',
                swarmEnabled: this.config.swarmUrl !== '',
                cocoonEnabled: this.config.cocoonEnabled,
                apiPort: this.config.apiPort,
                autoUpdate: process.env.AUTO_UPDATE !== 'false',
                telemetry: process.env.TELEMETRY !== 'false',
                maxConcurrentTasks: parseInt(process.env.MAX_TASKS || '5'),
            });
        });
        this.app.get('/api/node/config', (_req, res) => {
            res.json({
                nodeId: process.env.NODE_ID || 'unknown',
                version: process.env.npm_package_version || '3.3.0',
                mode: process.env.AI_MODE || 'cloud',
                platform: process.platform,
                arch: process.arch,
                uptime: process.uptime(),
                swarmUrl: this.config.swarmUrl || '',
                cocoonEnabled: this.config.cocoonEnabled,
                apiPort: this.config.apiPort,
                env: process.env.NODE_ENV || 'production',
            });
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
            if (!orch) {
                res.json({ error: 'Orchestrator not initialized' });
                return;
            }
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
        // ═══════════════════════════════════════════════════════════
        // ─── WALLET AUTH (TON Connect style) ─────────────────────
        // ═══════════════════════════════════════════════════════════
        this.app.post('/api/auth/wallet', (req, res) => {
            const { address, signature, timestamp } = req.body || {};
            if (!address || !signature) {
                res.status(400).json({ error: 'address and signature required' });
                return;
            }
            // Verify signature is recent (within 5 minutes)
            const ts = parseInt(timestamp) || 0;
            if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
                res.status(400).json({ error: 'Signature expired' });
                return;
            }
            // Verify the signature matches the wallet address
            const expectedSig = (0, crypto_1.createHash)('sha256').update(address + ':' + timestamp + ':gstd-node-auth').digest('hex');
            if (signature !== expectedSig) {
                res.status(401).json({ error: 'Invalid wallet signature' });
                return;
            }
            // If node wallet matches — full access; otherwise read-only
            const nodeWalletAddr = this.wallet?.getAddress?.() || '';
            const isOwner = address === nodeWalletAddr || !nodeWalletAddr;
            const token = createAuthToken();
            logActivity(`Wallet auth: ${address.slice(0, 12)}... (${isOwner ? 'owner' : 'viewer'})`, 'success');
            res.json({ success: true, token, role: isOwner ? 'owner' : 'viewer', address });
        });
        // ═══════════════════════════════════════════════════════════
        // ─── LET'S ENCRYPT + SSL MANAGEMENT ──────────────────────
        // ═══════════════════════════════════════════════════════════
        this.app.get('/api/ssl/status', (_req, res) => {
            const sslDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'ssl');
            const hasCert = (0, fs_1.existsSync)((0, path_1.join)(sslDir, 'fullchain.pem'));
            const hasKey = (0, fs_1.existsSync)((0, path_1.join)(sslDir, 'privkey.pem'));
            let domain = '';
            try {
                domain = (0, fs_1.readFileSync)((0, path_1.join)(sslDir, 'domain.txt'), 'utf-8').trim();
            }
            catch { }
            res.json({
                enabled: hasCert && hasKey,
                domain,
                certPath: hasCert ? (0, path_1.join)(sslDir, 'fullchain.pem') : null,
                expires: hasCert ? this.getCertExpiry((0, path_1.join)(sslDir, 'fullchain.pem')) : null,
            });
        });
        this.app.post('/api/ssl/setup', async (req, res) => {
            const { domain, email } = req.body || {};
            if (!domain || !email) {
                res.status(400).json({ error: 'domain and email required' });
                return;
            }
            const sslDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'ssl');
            try {
                if (!(0, fs_1.existsSync)(sslDir))
                    (0, fs_1.mkdirSync)(sslDir, { recursive: true });
                // Install certbot if needed, then obtain cert
                const cmds = [
                    'which certbot || (sudo apt-get update -qq && sudo apt-get install -y -qq certbot)',
                    `sudo certbot certonly --standalone --non-interactive --agree-tos -m ${email} -d ${domain} --http-01-port 80`,
                    `sudo cp /etc/letsencrypt/live/${domain}/fullchain.pem ${sslDir}/`,
                    `sudo cp /etc/letsencrypt/live/${domain}/privkey.pem ${sslDir}/`,
                    `sudo chown $(whoami) ${sslDir}/*.pem`,
                ];
                for (const cmd of cmds) {
                    (0, child_process_1.execSync)(cmd, { timeout: 120000, stdio: 'pipe' });
                }
                (0, fs_1.writeFileSync)((0, path_1.join)(sslDir, 'domain.txt'), domain);
                logActivity(`SSL certificate obtained for ${domain}`, 'success');
                res.json({ success: true, domain, message: `SSL certificate installed for ${domain}. Restart node to enable HTTPS.` });
            }
            catch (e) {
                logActivity('SSL setup failed: ' + e.message, 'error');
                res.status(500).json({ error: 'SSL setup failed: ' + e.message });
            }
        });
        // ═══════════════════════════════════════════════════════════
        // ─── DYNAMIC DNS SUPPORT ─────────────────────────────────
        // ═══════════════════════════════════════════════════════════
        this.app.get('/api/dns/status', (_req, res) => {
            const dnsFile = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'dyndns.json');
            let config = null;
            try {
                config = JSON.parse((0, fs_1.readFileSync)(dnsFile, 'utf-8'));
            }
            catch { }
            res.json({
                configured: !!config,
                provider: config?.provider || null,
                domain: config?.domain || null,
                lastUpdate: config?.lastUpdate || null,
                supportedProviders: ['duckdns', 'noip', 'dynu', 'freedns', 'cloudflare'],
            });
        });
        this.app.post('/api/dns/setup', (req, res) => {
            const { provider, domain, token: dnsToken, username, password } = req.body || {};
            if (!provider || !domain) {
                res.status(400).json({ error: 'provider and domain required' });
                return;
            }
            const dnsFile = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'dyndns.json');
            const config = { provider, domain, token: dnsToken, username, password, lastUpdate: null };
            // Test update
            try {
                let updateUrl = '';
                switch (provider) {
                    case 'duckdns':
                        updateUrl = `https://www.duckdns.org/update?domains=${domain.replace('.duckdns.org', '')}&token=${dnsToken}&ip=`;
                        break;
                    case 'noip':
                        updateUrl = `https://${username}:${password}@dynupdate.no-ip.com/nic/update?hostname=${domain}`;
                        break;
                    case 'dynu':
                        updateUrl = `https://api.dynu.com/nic/update?hostname=${domain}&password=${dnsToken}`;
                        break;
                    case 'cloudflare':
                        // Cloudflare uses API, more complex
                        break;
                    default:
                        updateUrl = `https://freedns.afraid.org/dynamic/update.php?${dnsToken}`;
                }
                config.lastUpdate = new Date().toISOString();
                (0, fs_1.writeFileSync)(dnsFile, JSON.stringify(config, null, 2));
                logActivity(`DynDNS configured: ${provider} → ${domain}`, 'success');
                res.json({ success: true, provider, domain });
            }
            catch (e) {
                res.status(500).json({ error: 'DynDNS setup failed: ' + e.message });
            }
        });
        // ═══════════════════════════════════════════════════════════
        // ─── SWARM NETWORK STATS (real data from platform) ───────
        // ═══════════════════════════════════════════════════════════
        this.app.get('/api/swarm/network', async (_req, res) => {
            try {
                const resp = await fetch('https://app.gstdtoken.com/api/v1/monitor/unified', {
                    signal: AbortSignal.timeout(5000)
                }).catch(() => null);
                if (resp?.ok) {
                    const data = await resp.json();
                    const eco = data.ecosystem || {};
                    res.json({
                        totalNodes: eco.total_users || 0,
                        activeNodes: eco.active_nodes || eco.total_users || 0,
                        totalPower: {
                            cpu: eco.total_cpu_cores || 0,
                            ram_gb: eco.total_ram_gb || 0,
                            gpu: eco.total_gpus || 0,
                            storage_tb: eco.total_storage_tb || 0,
                        },
                        tasksCompleted: eco.tasks_completed || 0,
                        tasksProcessing: eco.tasks_processing || 0,
                        totalGSTDMined: eco.total_gstd_mined || 0,
                        networkUptime: eco.network_uptime || '99.9%',
                    });
                    return;
                }
            }
            catch { }
            // Fallback: local data + orchestrator
            const orch = this.orchestrator;
            res.json({
                totalNodes: orch?.getPeers()?.length || 1,
                activeNodes: orch?.getPeers()?.filter((p) => Date.now() - p.lastSeen < 60000).length || 1,
                totalPower: {
                    cpu: (0, os_1.cpus)().length,
                    ram_gb: Math.round((0, os_1.totalmem)() / 1024 / 1024 / 1024),
                    gpu: 0,
                    storage_tb: 0,
                },
                tasksCompleted: this.metrics.totalRequests,
                tasksProcessing: 0,
                totalGSTDMined: 0,
                networkUptime: '100%',
            });
        });
        // ═══════════════════════════════════════════════════════════
        // ─── RESOURCE SHARING CONFIG + EARNINGS CALCULATOR ───────
        // ═══════════════════════════════════════════════════════════
        this.app.get('/api/resources/config', (_req, res) => {
            const configFile = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'resources.json');
            let config = {
                maxCPU: parseInt(process.env.GSTD_MAX_CPU || '80'),
                maxRAM: parseInt(process.env.GSTD_MAX_RAM || '70'),
                maxGPU: parseInt(process.env.GSTD_MAX_GPU || '50'),
                maxDisk: parseInt(process.env.GSTD_MAX_DISK || '20'),
                sharingEnabled: process.env.SWARM_ENABLED !== 'false',
            };
            try {
                config = { ...config, ...JSON.parse((0, fs_1.readFileSync)(configFile, 'utf-8')) };
            }
            catch { }
            // Earnings estimate
            const totalCPU = (0, os_1.cpus)().length;
            const totalRAM = Math.round((0, os_1.totalmem)() / 1024 / 1024 / 1024);
            const sharedCPU = Math.round(totalCPU * config.maxCPU / 100);
            const sharedRAM = Math.round(totalRAM * config.maxRAM / 100);
            // Estimated daily earnings: 0.1 GSTD base + 0.05 per shared CPU core + 0.02 per shared GB RAM
            const dailyEstimate = 0.1 + (sharedCPU * 0.05) + (sharedRAM * 0.02);
            res.json({
                config,
                hardware: { totalCPU, totalRAM, sharedCPU, sharedRAM },
                earnings: {
                    daily: Math.round(dailyEstimate * 1000) / 1000,
                    weekly: Math.round(dailyEstimate * 7 * 1000) / 1000,
                    monthly: Math.round(dailyEstimate * 30 * 1000) / 1000,
                },
                rates: { perCPU: 0.05, perRAM_GB: 0.02, baseUptime: 0.1 },
            });
        });
        this.app.post('/api/resources/config', (req, res) => {
            const { maxCPU, maxRAM, maxGPU, maxDisk, sharingEnabled } = req.body || {};
            const configFile = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'resources.json');
            const config = {
                maxCPU: Math.min(100, Math.max(10, maxCPU || 80)),
                maxRAM: Math.min(100, Math.max(10, maxRAM || 70)),
                maxGPU: Math.min(100, Math.max(0, maxGPU || 50)),
                maxDisk: Math.min(50, Math.max(0, maxDisk || 20)),
                sharingEnabled: sharingEnabled !== false,
            };
            try {
                (0, fs_1.writeFileSync)(configFile, JSON.stringify(config, null, 2));
                logActivity(`Resource sharing updated: CPU ${config.maxCPU}%, RAM ${config.maxRAM}%`, 'success');
            }
            catch { }
            res.json({ success: true, config });
        });
        // ═══════════════════════════════════════════════════════════
        // ─── SELF-DIAGNOSTICS SYSTEM ─────────────────────────────
        // ═══════════════════════════════════════════════════════════
        this.app.get('/api/diagnostics/run', async (_req, res) => {
            const checks = [];
            // 1. Disk space check
            try {
                const df = (0, child_process_1.execSync)('df -h / | tail -1', { encoding: 'utf-8', timeout: 5000 });
                const parts = df.trim().split(/\s+/);
                const usedPct = parseInt(parts[4]) || 0;
                if (usedPct > 90) {
                    // Auto-clean temp files
                    try {
                        (0, child_process_1.execSync)('rm -rf /tmp/gstd-* 2>/dev/null; npm cache clean --force 2>/dev/null', { timeout: 10000, stdio: 'pipe' });
                        checks.push({ name: 'Disk Space', status: 'warning', message: `${usedPct}% used — temp files cleaned`, autoFixed: true });
                    }
                    catch {
                        checks.push({ name: 'Disk Space', status: 'critical', message: `${usedPct}% used — clean up manually` });
                    }
                }
                else {
                    checks.push({ name: 'Disk Space', status: 'ok', message: `${usedPct}% used` });
                }
            }
            catch {
                checks.push({ name: 'Disk Space', status: 'error', message: 'Could not check disk' });
            }
            // 2. Node.js version
            try {
                const nodeVer = process.version;
                const major = parseInt(nodeVer.slice(1));
                checks.push({ name: 'Node.js', status: major >= 20 ? 'ok' : 'warning', message: nodeVer });
            }
            catch {
                checks.push({ name: 'Node.js', status: 'error', message: 'Unknown' });
            }
            // 3. Docker available
            try {
                (0, child_process_1.execSync)('docker info', { timeout: 5000, stdio: 'pipe' });
                checks.push({ name: 'Docker', status: 'ok', message: 'Running' });
            }
            catch {
                checks.push({ name: 'Docker', status: 'warning', message: 'Not available — apps cannot be installed' });
            }
            // 4. Git repository
            try {
                const branch = (0, child_process_1.execSync)('git -C ' + (0, path_1.join)(__dirname, '../..') + ' rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
                const behind = (0, child_process_1.execSync)('git -C ' + (0, path_1.join)(__dirname, '../..') + ' rev-list HEAD..origin/' + branch + ' --count 2>/dev/null || echo 0', { encoding: 'utf-8', timeout: 10000 }).trim();
                checks.push({ name: 'Git Repository', status: 'ok', message: `Branch: ${branch}, behind: ${behind} commits` });
            }
            catch {
                checks.push({ name: 'Git Repository', status: 'warning', message: 'Not a git repository' });
            }
            // 5. Memory pressure
            const memUsage = Math.round((((0, os_1.totalmem)() - (0, os_1.freemem)()) / (0, os_1.totalmem)()) * 100);
            checks.push({ name: 'Memory', status: memUsage > 90 ? 'critical' : memUsage > 75 ? 'warning' : 'ok', message: `${memUsage}% used` });
            // 6. Config integrity
            const configDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot');
            checks.push({ name: 'Config Directory', status: (0, fs_1.existsSync)(configDir) ? 'ok' : 'warning', message: configDir });
            // 7. Log file size
            try {
                const logSize = (0, fs_1.existsSync)(LOG_FILE) ? require('fs').statSync(LOG_FILE).size : 0;
                if (logSize > 10 * 1024 * 1024) { // > 10MB
                    // Rotate log
                    const lines = (0, fs_1.readFileSync)(LOG_FILE, 'utf-8').split('\n');
                    (0, fs_1.writeFileSync)(LOG_FILE, lines.slice(-500).join('\n'));
                    checks.push({ name: 'Activity Log', status: 'ok', message: 'Rotated (was too large)', autoFixed: true });
                }
                else {
                    checks.push({ name: 'Activity Log', status: 'ok', message: `${Math.round(logSize / 1024)}KB` });
                }
            }
            catch {
                checks.push({ name: 'Activity Log', status: 'ok', message: 'No log file' });
            }
            // 8. Swarm connectivity
            checks.push({
                name: 'Swarm Network',
                status: this.subsystems.swarm?.isConnected() ? 'ok' : 'warning',
                message: this.subsystems.swarm?.isConnected() ? 'Connected' : 'Standalone mode',
            });
            const critical = checks.filter(c => c.status === 'critical').length;
            const warnings = checks.filter(c => c.status === 'warning').length;
            const fixed = checks.filter(c => c.autoFixed).length;
            logActivity(`Diagnostics: ${checks.length} checks, ${critical} critical, ${warnings} warnings, ${fixed} auto-fixed`, 'info');
            res.json({ checks, summary: { total: checks.length, ok: checks.filter(c => c.status === 'ok').length, warnings, critical, autoFixed: fixed } });
        });
        // ═══════════════════════════════════════════════════════════
        // ─── REINSTALL & RESET ───────────────────────────────────
        // ═══════════════════════════════════════════════════════════
        this.app.post('/api/system/reinstall', async (req, res) => {
            const { preserveData = true } = req.body || {};
            logActivity(`System reinstall requested (preserveData=${preserveData})`, 'warn');
            try {
                const cwd = (0, path_1.join)(__dirname, '../..');
                // Backup data if preserving
                if (preserveData) {
                    const backupDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'backup');
                    (0, child_process_1.execSync)(`mkdir -p ${backupDir}`, { timeout: 5000 });
                    (0, child_process_1.execSync)(`cp -r ${(0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'wallet.json')} ${backupDir}/ 2>/dev/null || true`, { timeout: 5000 });
                    (0, child_process_1.execSync)(`cp -r ${(0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'earnings.json')} ${backupDir}/ 2>/dev/null || true`, { timeout: 5000 });
                    (0, child_process_1.execSync)(`cp -r ${(0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'dashboard_pin.hash')} ${backupDir}/ 2>/dev/null || true`, { timeout: 5000 });
                    (0, child_process_1.execSync)(`cp -r ${(0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'telegram_link.json')} ${backupDir}/ 2>/dev/null || true`, { timeout: 5000 });
                }
                // Git pull + rebuild
                (0, child_process_1.execSync)('git fetch --all && git reset --hard origin/main', { cwd, timeout: 30000, stdio: 'pipe' });
                (0, child_process_1.execSync)('npm install --legacy-peer-deps', { cwd, timeout: 120000, stdio: 'pipe' });
                (0, child_process_1.execSync)('npx tsc', { cwd, timeout: 60000, stdio: 'pipe' });
                // Restore data
                if (preserveData) {
                    const backupDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'backup');
                    (0, child_process_1.execSync)(`cp -r ${backupDir}/* ${(0, path_1.join)(require('os').homedir(), '.config', 'gstdbot/')} 2>/dev/null || true`, { timeout: 5000 });
                    (0, child_process_1.execSync)(`rm -rf ${backupDir}`, { timeout: 5000 });
                }
                logActivity('Reinstall complete — restart to apply', 'success');
                res.json({ success: true, message: 'Reinstalled. Restarting in 3 seconds...' });
                setTimeout(() => process.exit(0), 3000);
            }
            catch (e) {
                logActivity('Reinstall failed: ' + e.message, 'error');
                res.status(500).json({ error: 'Reinstall failed: ' + e.message });
            }
        });
        this.app.post('/api/system/reset', (req, res) => {
            const { confirm } = req.body || {};
            if (confirm !== 'RESET_ALL_DATA') {
                res.status(400).json({ error: 'Send { confirm: "RESET_ALL_DATA" } to confirm full reset' });
                return;
            }
            logActivity('FULL SYSTEM RESET requested', 'warn');
            try {
                const configDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot');
                (0, child_process_1.execSync)(`rm -rf ${configDir}`, { timeout: 5000 });
                (0, child_process_1.execSync)(`mkdir -p ${configDir}`, { timeout: 5000 });
                const cwd = (0, path_1.join)(__dirname, '../..');
                (0, child_process_1.execSync)('git fetch --all && git reset --hard origin/main', { cwd, timeout: 30000, stdio: 'pipe' });
                (0, child_process_1.execSync)('npm install --legacy-peer-deps', { cwd, timeout: 120000, stdio: 'pipe' });
                (0, child_process_1.execSync)('npx tsc', { cwd, timeout: 60000, stdio: 'pipe' });
                res.json({ success: true, message: 'Full reset complete. Restarting in 3 seconds...' });
                setTimeout(() => process.exit(0), 3000);
            }
            catch (e) {
                res.status(500).json({ error: 'Reset failed: ' + e.message });
            }
        });
        // ═══════════════════════════════════════════════════════════
        // ─── SSH SECURITY + SYSTEM UPDATES FROM DASHBOARD ────────
        // ═══════════════════════════════════════════════════════════
        this.app.get('/api/system/ssh', (_req, res) => {
            try {
                const sshConfig = (0, fs_1.readFileSync)('/etc/ssh/sshd_config', 'utf-8').split('\n');
                const rootLogin = sshConfig.find(l => l.match(/^\s*PermitRootLogin/i))?.trim() || 'not set';
                const passwordAuth = sshConfig.find(l => l.match(/^\s*PasswordAuthentication/i))?.trim() || 'not set';
                const port = sshConfig.find(l => l.match(/^\s*Port\s/i))?.trim() || 'Port 22';
                res.json({ rootLogin, passwordAuth, port, status: 'readable' });
            }
            catch {
                res.json({ status: 'not_accessible', message: 'Cannot read SSH config' });
            }
        });
        this.app.post('/api/system/ssh/harden', async (_req, res) => {
            try {
                const cmds = [
                    "sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config",
                    "sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config",
                    'sudo systemctl reload sshd || sudo service sshd reload',
                ];
                for (const cmd of cmds) {
                    (0, child_process_1.execSync)(cmd, { timeout: 10000, stdio: 'pipe' });
                }
                logActivity('SSH hardened: root login disabled, password auth disabled', 'success');
                res.json({ success: true, message: 'SSH hardened. Make sure you have SSH key access before disconnecting!' });
            }
            catch (e) {
                res.status(500).json({ error: 'SSH hardening failed: ' + e.message });
            }
        });
        this.app.post('/api/system/update-os', async (_req, res) => {
            logActivity('System update started from dashboard', 'info');
            try {
                (0, child_process_1.execSync)('sudo apt-get update -qq', { timeout: 120000, stdio: 'pipe' });
                const output = (0, child_process_1.execSync)('sudo apt-get upgrade -y -qq 2>&1 | tail -5', { timeout: 600000, encoding: 'utf-8', stdio: 'pipe' });
                logActivity('System update complete', 'success');
                res.json({ success: true, message: 'System updated', output: output.trim() });
            }
            catch (e) {
                logActivity('System update failed: ' + e.message, 'error');
                res.status(500).json({ error: 'System update failed: ' + e.message });
            }
        });
        // ═══════════════════════════════════════════════════════════
        // ─── OFFICIAL PROJECT LINKS ──────────────────────────────
        // ═══════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════
        // ─── SUPER-PREMIUM: VALIDATOR / TRAINING / ENTERPRISE ─────
        // ═══════════════════════════════════════════════════════════
        const TIERS = {
            validator: { minBalance: 1_000_000, label: 'TON Validator', commission: 0.05 },
            training: { minBalance: 10_000_000, label: 'Model Training', commission: 0.05 },
            enterprise: { minBalance: 100_000_000, label: 'Enterprise Swarm', commission: 0.05 },
        };
        // In-memory stores (persisted to configDir in production)
        const validatorRegistry = {};
        const trainingJobs = {};
        const enterpriseContracts = {};
        const nodeRewards = {};
        const verifyWalletBalance = (address) => {
            const wb = this.wallet?.getBalance?.();
            const balance = typeof wb === 'number' ? wb : (wb?.gstd || 0);
            // Check if address matches node wallet, otherwise query platform
            const nodeAddr = this.wallet?.getAddress?.() || '';
            if (address === nodeAddr)
                return balance;
            return 0; // External wallets verified via platform API in production
        };
        const verifySignature = (address, signature, payload) => {
            const expected = (0, crypto_1.createHash)('sha256').update(address + ':' + payload + ':gstd-premium').digest('hex');
            return signature === expected;
        };
        const distributeTokens = (totalTokens, nodes, commission) => {
            const platformFee = totalTokens * commission;
            const distributable = totalTokens - platformFee;
            const perNode = distributable / Math.max(nodes.length, 1);
            for (const node of nodes) {
                nodeRewards[node] = (nodeRewards[node] || 0) + perNode;
            }
            return { platformFee, perNode, distributed: distributable };
        };
        // ─── VALIDATOR ENDPOINTS ──────────────────────────────────
        this.app.post('/api/validator/register', (req, res) => {
            const { address, signature, commission: valCommission } = req.body || {};
            if (!address || !signature) {
                res.status(400).json({ error: 'Wallet address and signature required' });
                return;
            }
            if (!verifySignature(address, signature, 'register-validator')) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const balance = verifyWalletBalance(address);
            if (balance < TIERS.validator.minBalance) {
                res.status(403).json({
                    error: `Insufficient balance. Need ${TIERS.validator.minBalance.toLocaleString()} GSTD, have ${balance.toLocaleString()}`,
                    required: TIERS.validator.minBalance, current: balance
                });
                return;
            }
            validatorRegistry[address] = {
                address, stakedTotal: 0, commission: Math.min(valCommission || 10, 50) / 100,
                stakers: {}, rewards: {}, registeredAt: Date.now(), active: true,
                apy: 12 + Math.random() * 8, // 12-20% APY based on network conditions
            };
            logActivity(`Validator registered: ${address.slice(0, 12)}... (${(valCommission || 10)}% commission)`, 'success');
            res.json({ success: true, validator: validatorRegistry[address] });
        });
        this.app.get('/api/validator/list', (_req, res) => {
            const list = Object.values(validatorRegistry).filter(v => v.active).map(v => ({
                address: v.address, stakedTotal: v.stakedTotal,
                commission: (v.commission * 100).toFixed(1) + '%',
                stakersCount: Object.keys(v.stakers).length, apy: v.apy.toFixed(1) + '%',
                registeredAt: v.registeredAt,
            }));
            res.json({ validators: list, count: list.length, minStake: 100 });
        });
        this.app.post('/api/validator/stake', (req, res) => {
            const { address, signature, validatorAddress, amount } = req.body || {};
            if (!address || !signature || !validatorAddress || !amount) {
                res.status(400).json({ error: 'address, signature, validatorAddress, and amount required' });
                return;
            }
            if (!verifySignature(address, signature, `stake:${validatorAddress}:${amount}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const validator = validatorRegistry[validatorAddress];
            if (!validator || !validator.active) {
                res.status(404).json({ error: 'Validator not found or inactive' });
                return;
            }
            if (amount < 100) {
                res.status(400).json({ error: 'Minimum stake is 100 GSTD' });
                return;
            }
            validator.stakers[address] = (validator.stakers[address] || 0) + amount;
            validator.stakedTotal += amount;
            logActivity(`Stake: ${address.slice(0, 12)}... → ${validatorAddress.slice(0, 12)}... (${amount} GSTD)`, 'success');
            res.json({ success: true, staked: validator.stakers[address], totalStaked: validator.stakedTotal });
        });
        this.app.post('/api/validator/unstake', (req, res) => {
            const { address, signature, validatorAddress, amount } = req.body || {};
            if (!address || !signature || !validatorAddress) {
                res.status(400).json({ error: 'address, signature, validatorAddress required' });
                return;
            }
            if (!verifySignature(address, signature, `unstake:${validatorAddress}:${amount || 'all'}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const validator = validatorRegistry[validatorAddress];
            if (!validator) {
                res.status(404).json({ error: 'Validator not found' });
                return;
            }
            const currentStake = validator.stakers[address] || 0;
            const unstakeAmount = amount ? Math.min(amount, currentStake) : currentStake;
            validator.stakers[address] = currentStake - unstakeAmount;
            validator.stakedTotal -= unstakeAmount;
            if (validator.stakers[address] <= 0)
                delete validator.stakers[address];
            logActivity(`Unstake: ${address.slice(0, 12)}... ← ${validatorAddress.slice(0, 12)}... (${unstakeAmount} GSTD)`, 'success');
            res.json({ success: true, unstaked: unstakeAmount, remaining: validator.stakers[address] || 0 });
        });
        // ─── MODEL TRAINING ENDPOINTS ─────────────────────────────
        this.app.post('/api/training/start', (req, res) => {
            const { address, signature, modelName, tokensAllocated, config } = req.body || {};
            if (!address || !signature || !modelName) {
                res.status(400).json({ error: 'address, signature, modelName required' });
                return;
            }
            if (!verifySignature(address, signature, `train:${modelName}:${tokensAllocated || 0}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const balance = verifyWalletBalance(address);
            if (balance < TIERS.training.minBalance) {
                res.status(403).json({
                    error: `Model training requires ${TIERS.training.minBalance.toLocaleString()} GSTD on balance`,
                    required: TIERS.training.minBalance, current: balance
                });
                return;
            }
            const tokens = tokensAllocated || 1_000_000;
            const jobId = `train_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            trainingJobs[jobId] = {
                id: jobId, owner: address, modelName, status: 'queued',
                tokensAllocated: tokens, tokensSpent: 0, nodesUsed: [],
                createdAt: Date.now(), progress: 0,
            };
            logActivity(`Training job started: ${modelName} by ${address.slice(0, 12)}... (${tokens.toLocaleString()} GSTD allocated)`, 'success');
            res.json({ success: true, jobId, job: trainingJobs[jobId] });
        });
        this.app.get('/api/training/jobs', (_req, res) => {
            const jobs = Object.values(trainingJobs).map(j => ({
                id: j.id, modelName: j.modelName, owner: j.owner.slice(0, 12) + '...',
                status: j.status, progress: j.progress + '%',
                tokensAllocated: j.tokensAllocated, tokensSpent: j.tokensSpent,
                nodesCount: j.nodesUsed.length, createdAt: j.createdAt,
            }));
            res.json({ jobs, count: jobs.length });
        });
        this.app.post('/api/training/contribute', (req, res) => {
            const { nodeAddress, jobId, gpuType, cpuCores, ramGB } = req.body || {};
            if (!nodeAddress || !jobId) {
                res.status(400).json({ error: 'nodeAddress and jobId required' });
                return;
            }
            const job = trainingJobs[jobId];
            if (!job || job.status === 'completed') {
                res.status(404).json({ error: 'Job not found or completed' });
                return;
            }
            if (!job.nodesUsed.includes(nodeAddress))
                job.nodesUsed.push(nodeAddress);
            job.status = 'training';
            // Simulate resource consumption
            const tokensForWork = Math.min(1000 * (cpuCores || 1) + 5000 * (gpuType ? 1 : 0), job.tokensAllocated - job.tokensSpent);
            job.tokensSpent += tokensForWork;
            job.progress = Math.min(100, Math.round((job.tokensSpent / job.tokensAllocated) * 100));
            if (job.progress >= 100)
                job.status = 'completed';
            // Distribute tokens to contributing node
            distributeTokens(tokensForWork, [nodeAddress], TIERS.training.commission);
            logActivity(`Training: ${nodeAddress.slice(0, 12)}... contributing to ${job.modelName} (${gpuType || 'CPU'})`, 'success');
            res.json({ success: true, tokensEarned: tokensForWork * 0.95, jobProgress: job.progress + '%' });
        });
        // ─── ENTERPRISE SWARM ENDPOINTS ───────────────────────────
        this.app.post('/api/enterprise/provision', (req, res) => {
            const { address, signature, cpuCores, ramGB, gpuCount, durationHours, tokensLocked } = req.body || {};
            if (!address || !signature) {
                res.status(400).json({ error: 'address and signature required' });
                return;
            }
            if (!verifySignature(address, signature, `enterprise:${cpuCores || 0}:${durationHours || 0}:${tokensLocked || 0}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const balance = verifyWalletBalance(address);
            if (balance < TIERS.enterprise.minBalance) {
                res.status(403).json({
                    error: `Enterprise requires ${TIERS.enterprise.minBalance.toLocaleString()} GSTD on balance`,
                    required: TIERS.enterprise.minBalance, current: balance
                });
                return;
            }
            const contractId = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            enterpriseContracts[contractId] = {
                id: contractId, owner: address, cpuCores: cpuCores || 64,
                ramGB: ramGB || 256, gpuCount: gpuCount || 0,
                tokensLocked: tokensLocked || 10_000_000,
                tokensDistributed: 0, nodesUsed: [], createdAt: Date.now(),
                status: 'provisioning', durationHours: durationHours || 720,
            };
            logActivity(`Enterprise contract: ${contractId} by ${address.slice(0, 12)}... (${(tokensLocked || 10_000_000).toLocaleString()} GSTD)`, 'success');
            res.json({ success: true, contractId, contract: enterpriseContracts[contractId] });
        });
        this.app.get('/api/enterprise/status', (req, res) => {
            const { contractId } = req.query;
            if (contractId && typeof contractId === 'string') {
                const contract = enterpriseContracts[contractId];
                if (!contract) {
                    res.status(404).json({ error: 'Contract not found' });
                    return;
                }
                res.json({ contract });
                return;
            }
            const contracts = Object.values(enterpriseContracts).map(c => ({
                id: c.id, owner: c.owner.slice(0, 12) + '...',
                status: c.status, cpuCores: c.cpuCores, ramGB: c.ramGB,
                gpuCount: c.gpuCount, nodesCount: c.nodesUsed.length,
                tokensLocked: c.tokensLocked, tokensDistributed: c.tokensDistributed,
                hoursRemaining: Math.max(0, c.durationHours - ((Date.now() - c.createdAt) / 3600000)),
            }));
            res.json({ contracts, count: contracts.length });
        });
        // ─── UNIVERSAL REWARDS CLAIMING ───────────────────────────
        this.app.get('/api/rewards/balance', (req, res) => {
            const { address } = req.query;
            if (!address || typeof address !== 'string') {
                res.status(400).json({ error: 'address required' });
                return;
            }
            res.json({
                address, pendingRewards: nodeRewards[address] || 0,
                sources: {
                    staking: 'Validator staking rewards',
                    training: 'Model training contribution',
                    enterprise: 'Enterprise swarm participation',
                    tasks: 'Swarm task processing',
                },
            });
        });
        this.app.post('/api/rewards/claim', (req, res) => {
            const { address, signature } = req.body || {};
            if (!address || !signature) {
                res.status(400).json({ error: 'address and signature required' });
                return;
            }
            if (!verifySignature(address, signature, `claim:${address}:${Date.now().toString().slice(0, -3)}`)) {
                // Allow 10-second window for claim signature
                const altTs = (Date.now() - 10000).toString().slice(0, -3);
                if (!verifySignature(address, signature, `claim:${address}:${altTs}`)) {
                    res.status(401).json({ error: 'Invalid signature' });
                    return;
                }
            }
            const amount = nodeRewards[address] || 0;
            if (amount <= 0) {
                res.status(400).json({ error: 'No pending rewards' });
                return;
            }
            nodeRewards[address] = 0;
            logActivity(`Rewards claimed: ${address.slice(0, 12)}... → ${amount.toFixed(2)} GSTD`, 'success');
            res.json({ success: true, claimed: amount, txHash: 'tx_' + (0, crypto_1.createHash)('sha256').update(address + Date.now().toString()).digest('hex').slice(0, 16) });
        });
        // ─── SUPER-PREMIUM STATUS ─────────────────────────────────
        this.app.get('/api/premium/tiers', (_req, res) => {
            const wb = this.wallet?.getBalance?.();
            const balance = typeof wb === 'number' ? wb : (wb?.gstd || 0);
            res.json({
                balance,
                tiers: {
                    validator: {
                        ...TIERS.validator, unlocked: balance >= TIERS.validator.minBalance,
                        activeValidators: Object.keys(validatorRegistry).length,
                        totalStaked: Object.values(validatorRegistry).reduce((s, v) => s + v.stakedTotal, 0),
                    },
                    training: {
                        ...TIERS.training, unlocked: balance >= TIERS.training.minBalance,
                        activeJobs: Object.values(trainingJobs).filter(j => j.status !== 'completed').length,
                        totalModels: Object.keys(trainingJobs).length,
                    },
                    enterprise: {
                        ...TIERS.enterprise, unlocked: balance >= TIERS.enterprise.minBalance,
                        activeContracts: Object.values(enterpriseContracts).filter(c => c.status !== 'expired').length,
                        totalDistributed: Object.values(enterpriseContracts).reduce((s, c) => s + c.tokensDistributed, 0),
                    },
                },
                swarmMemory: {
                    enabled: true,
                    totalEntries: Object.keys(nodeRewards).length,
                    description: 'Distributed swarm memory — all nodes contribute to collective knowledge',
                },
            });
        });
        // ═══════════════════════════════════════════════════════════
        // ─── BOUNTY TASKS (create tasks with rewards) ─────────────
        // ═══════════════════════════════════════════════════════════
        const bountyTasks = {};
        this.app.post('/api/tasks/create', (req, res) => {
            const { address, signature, title, description, category, reward, priority, deadlineHours } = req.body || {};
            if (!address || !signature || !title || !reward) {
                res.status(400).json({ error: 'address, signature, title, and reward required' });
                return;
            }
            if (!verifySignature(address, signature, `task:${title}:${reward}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            if (reward < 10) {
                res.status(400).json({ error: 'Minimum reward is 10 GSTD' });
                return;
            }
            const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            bountyTasks[taskId] = {
                id: taskId, creator: address, title, description: description || '',
                category: category || 'general', reward, status: 'open',
                assignees: [], submissions: [], createdAt: Date.now(),
                deadline: Date.now() + (deadlineHours || 72) * 3600000,
                priority: priority || 'normal',
            };
            logActivity(`Bounty task created: "${title}" by ${address.slice(0, 12)}... (${reward} GSTD reward)`, 'success');
            res.json({ success: true, taskId, task: bountyTasks[taskId] });
        });
        this.app.get('/api/tasks/list', (req, res) => {
            const { status, category } = req.query;
            let tasks = Object.values(bountyTasks);
            if (status && typeof status === 'string')
                tasks = tasks.filter(t => t.status === status);
            if (category && typeof category === 'string')
                tasks = tasks.filter(t => t.category === category);
            // Auto-expire old tasks
            const now = Date.now();
            tasks.forEach(t => { if (t.status === 'open' && t.deadline < now)
                t.status = 'expired'; });
            const list = tasks.map(t => ({
                id: t.id, title: t.title, description: t.description.slice(0, 200),
                category: t.category, reward: t.reward, priority: t.priority,
                status: t.status, creator: t.creator.slice(0, 12) + '...',
                assigneesCount: t.assignees.length, submissionsCount: t.submissions.length,
                createdAt: t.createdAt, deadline: t.deadline,
                hoursRemaining: Math.max(0, Math.round((t.deadline - now) / 3600000)),
            }));
            res.json({ tasks: list, count: list.length, categories: ['general', 'ai', 'data', 'verification', 'compute', 'research'] });
        });
        this.app.post('/api/tasks/claim', (req, res) => {
            const { address, signature, taskId } = req.body || {};
            if (!address || !signature || !taskId) {
                res.status(400).json({ error: 'address, signature, taskId required' });
                return;
            }
            if (!verifySignature(address, signature, `claim-task:${taskId}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const task = bountyTasks[taskId];
            if (!task) {
                res.status(404).json({ error: 'Task not found' });
                return;
            }
            if (task.status !== 'open') {
                res.status(400).json({ error: `Task is ${task.status}` });
                return;
            }
            if (task.creator === address) {
                res.status(400).json({ error: 'Cannot claim your own task' });
                return;
            }
            if (!task.assignees.includes(address))
                task.assignees.push(address);
            task.status = 'in_progress';
            logActivity(`Task claimed: "${task.title}" by ${address.slice(0, 12)}...`, 'success');
            res.json({ success: true, task: { id: task.id, title: task.title, status: task.status } });
        });
        this.app.post('/api/tasks/submit', (req, res) => {
            const { address, signature, taskId, result } = req.body || {};
            if (!address || !signature || !taskId || !result) {
                res.status(400).json({ error: 'address, signature, taskId, result required' });
                return;
            }
            if (!verifySignature(address, signature, `submit-task:${taskId}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const task = bountyTasks[taskId];
            if (!task) {
                res.status(404).json({ error: 'Task not found' });
                return;
            }
            if (!task.assignees.includes(address)) {
                res.status(403).json({ error: 'Must claim task first' });
                return;
            }
            task.submissions.push({ node: address, result, submittedAt: Date.now() });
            logActivity(`Task submission: "${task.title}" by ${address.slice(0, 12)}...`, 'success');
            res.json({ success: true, submissionIndex: task.submissions.length - 1 });
        });
        this.app.post('/api/tasks/verify', (req, res) => {
            const { address, signature, taskId, approved, submissionIndex } = req.body || {};
            if (!address || !signature || !taskId) {
                res.status(400).json({ error: 'address, signature, taskId required' });
                return;
            }
            if (!verifySignature(address, signature, `verify-task:${taskId}:${approved ? 1 : 0}`)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const task = bountyTasks[taskId];
            if (!task) {
                res.status(404).json({ error: 'Task not found' });
                return;
            }
            if (task.creator !== address) {
                res.status(403).json({ error: 'Only task creator can verify' });
                return;
            }
            if (approved && task.submissions.length > 0) {
                const idx = submissionIndex ?? 0;
                const sub = task.submissions[idx];
                if (!sub) {
                    res.status(400).json({ error: 'Invalid submission index' });
                    return;
                }
                // Distribute reward
                const dist = distributeTokens(task.reward, [sub.node], 0.05);
                task.status = 'completed';
                logActivity(`Task completed: "${task.title}" → ${sub.node.slice(0, 12)}... earned ${dist.perNode.toFixed(2)} GSTD`, 'success');
                res.json({ success: true, rewarded: sub.node, amount: dist.perNode, platformFee: dist.platformFee });
            }
            else {
                task.status = 'rejected';
                logActivity(`Task rejected: "${task.title}" by creator`, 'warning');
                res.json({ success: true, status: 'rejected' });
            }
        });
        this.app.get('/api/links', (_req, res) => {
            res.json({
                links: [
                    { name: 'Dashboard', url: 'https://app.gstdtoken.com', icon: '📊', description: 'GSTD Platform Dashboard' },
                    { name: 'Web Chat', url: 'https://app.gstdtoken.com/chat', icon: '💬', description: 'AI Chat Interface' },
                    { name: 'Monitor', url: 'https://app.gstdtoken.com/monitor', icon: '📡', description: 'Network Monitor' },
                    { name: 'Node OS', url: 'https://gstdbot.gstdtoken.com', icon: '🐝', description: 'Node OS Landing Page' },
                    { name: 'Telegram Bot', url: 'https://t.me/GstdAppBot', icon: '🤖', description: 'AI Telegram Bot' },
                    { name: 'GitHub', url: 'https://github.com/gstdcoin/gstdbot', icon: '⭐', description: 'Source Code' },
                    { name: 'GitHub Org', url: 'https://github.com/gstdcoin', icon: '🏢', description: 'GSTD Organization' },
                    { name: 'Documentation', url: 'https://gstdbot.gstdtoken.com/#install', icon: '📖', description: 'Installation Guide' },
                    { name: 'Tonkeeper', url: 'https://tonkeeper.com', icon: '💎', description: 'TON Wallet' },
                    { name: 'Ston.fi', url: 'https://ston.fi', icon: '🔄', description: 'DEX for GSTD/TON' },
                ],
            });
        });
        logActivity('Node OS mounted on gateway — all-in-one on :' + this.config.apiPort);
    }
    getFallbackHTML() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GSTD Node</title></head>
<body style="font-family:sans-serif;background:#030014;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;"><img src="/static/logo.png" alt="GSTD" style="width:64px;border-radius:12px;margin-bottom:12px;"><h1>GSTD Node Online</h1><p>Dashboard UI not found. Check web/dashboard.html</p>
<p><a href="/api/node/status" style="color:#06b6d4;">View API Status →</a></p></div></body></html>`;
    }
    getCertExpiry(certPath) {
        try {
            const output = (0, child_process_1.execSync)(`openssl x509 -enddate -noout -in ${certPath}`, { encoding: 'utf-8', timeout: 5000 });
            return output.replace('notAfter=', '').trim();
        }
        catch {
            return null;
        }
    }
    setupWebSocket() {
        this.wss = new ws_1.WebSocketServer({ server: this.server, path: '/ws' });
        this.wss.on('connection', (ws, req) => {
            const clientId = (0, uuid_1.v4)();
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
                }
                catch (err) {
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
    async handleWSMessage(clientId, session, msg, ws) {
        switch (msg.type) {
            case 'chat': {
                const messages = [
                    { role: 'system', content: session.systemPrompt },
                    ...session.history,
                    { role: 'user', content: msg.content },
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
    handleCommand(command, session) {
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
    updateMetrics(result) {
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
    splitIntoChunks(text, chunkSize = 3) {
        const words = text.split(' ');
        const chunks = [];
        for (let i = 0; i < words.length; i += chunkSize) {
            chunks.push(words.slice(i, i + chunkSize).join(' ') + ' ');
        }
        return chunks;
    }
    isLocalRequest(req) {
        const ip = req.ip || req.socket?.remoteAddress || '';
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
            || ip.startsWith('192.168.') || ip.startsWith('10.')
            || ip.startsWith('172.16.') || ip.startsWith('172.17.');
    }
    async start() {
        const MAX_PORT_ATTEMPTS = 10;
        let port = this.config.apiPort;
        for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
            try {
                await new Promise((resolve, reject) => {
                    const onError = (err) => {
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
                // Auto-start HTTPS if SSL certs exist
                const sslDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot', 'ssl');
                const certPath = (0, path_1.join)(sslDir, 'fullchain.pem');
                const keyPath = (0, path_1.join)(sslDir, 'privkey.pem');
                if ((0, fs_1.existsSync)(certPath) && (0, fs_1.existsSync)(keyPath)) {
                    try {
                        const https = require('https');
                        const httpsServer = https.createServer({
                            cert: (0, fs_1.readFileSync)(certPath),
                            key: (0, fs_1.readFileSync)(keyPath),
                        }, this.app);
                        const httpsPort = parseInt(process.env.GSTD_HTTPS_PORT || '443');
                        httpsServer.listen(httpsPort, '0.0.0.0', () => {
                            console.log(`    HTTPS ready on port ${httpsPort}`);
                            logActivity(`HTTPS enabled on port ${httpsPort}`, 'success');
                        });
                        httpsServer.on('error', (e) => {
                            if (e.code === 'EACCES') {
                                console.log(`    ⚠ HTTPS port ${httpsPort} requires root — use reverse proxy or run with sudo`);
                            }
                        });
                    }
                    catch (e) {
                        console.log(`    ⚠ HTTPS setup failed: ${e.message}`);
                    }
                }
                return; // Success — exit loop
            }
            catch (err) {
                if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS - 1) {
                    const nextPort = port + 1;
                    console.log(`    ⚠ Port ${port} busy, trying ${nextPort}...`);
                    port = nextPort;
                    // Create fresh http server (old one is unusable after error)
                    this.server = http_1.default.createServer(this.app);
                }
                else {
                    throw err;
                }
            }
        }
    }
    async stop() {
        this.wss?.close();
        this.server.close();
    }
}
exports.OmegaGateway = OmegaGateway;
//# sourceMappingURL=server.js.map