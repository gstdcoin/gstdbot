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
const manager_js_1 = require("../apps/manager.js");
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
// ─── Activity Log ────────────────────────────────────────────────
const activityLog = [];
const MAX_LOG = 200;
function logActivity(msg, type = 'info') {
    activityLog.unshift({ ts: new Date().toISOString(), msg, type });
    if (activityLog.length > MAX_LOG)
        activityLog.length = MAX_LOG;
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
    }
    /** Get the actual port the gateway is listening on (may differ from requested if auto-reassigned) */
    getPort() {
        return this.config.apiPort;
    }
    setupAPI() {
        this.app.use(express_1.default.json({ limit: '10mb' }));
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
        const RATE_LIMIT = 60; // max requests per window
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
                version: '1.0.0',
                uptime: process.uptime(),
                activeSessions: this.sessions.count(),
                connectedClients: this.clients.size,
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
            }
            catch (e) {
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
                const newVersion = JSON.parse(require('fs').readFileSync(installDir + '/package.json', 'utf-8')).version || 'unknown';
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
                    }
                    catch { }
                    // If not systemd, just exit — PM2 or shell will restart
                    process.exit(0);
                }, 500);
            }
            catch (e) {
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
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
    }
    // ─── Node OS: Dashboard + App Store + System APIs ────────────
    setupNodeOS() {
        // ─── Dashboard PIN Authentication ────────────────────────
        const configDir = (0, path_1.join)(require('os').homedir(), '.config', 'gstdbot');
        const pinFile = (0, path_1.join)(configDir, 'dashboard_pin.txt');
        let dashboardPIN = '';
        let pinConfigured = false;
        if ((0, fs_1.existsSync)(pinFile)) {
            dashboardPIN = (0, fs_1.readFileSync)(pinFile, 'utf-8').trim();
            pinConfigured = !!dashboardPIN;
        }
        // Ensure config dir exists
        if (!(0, fs_1.existsSync)(configDir)) {
            try {
                require('fs').mkdirSync(configDir, { recursive: true });
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
            dashboardPIN = pin;
            pinConfigured = true;
            try {
                const { writeFileSync } = require('fs');
                writeFileSync(pinFile, dashboardPIN);
                logActivity('Dashboard PIN created by user', 'success');
            }
            catch { }
            res.json({ success: true, token: 'pin_' + dashboardPIN });
        });
        // POST /api/auth/login — verify PIN
        this.app.post('/api/auth/login', (req, res) => {
            const { pin } = req.body || {};
            if (!pinConfigured) {
                res.status(400).json({ success: false, error: 'PIN not configured. Use /api/auth/setup first.' });
                return;
            }
            if (pin === dashboardPIN) {
                res.json({ success: true, token: 'pin_' + dashboardPIN });
            }
            else {
                res.status(401).json({ success: false, error: 'Invalid PIN' });
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
            if (isLocal || token === 'pin_' + dashboardPIN) {
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
            dashboardPIN = newPin;
            pinConfigured = true;
            resetCode = '';
            try {
                (0, fs_1.writeFileSync)(pinFile, dashboardPIN);
            }
            catch { }
            logActivity('PIN reset via 2FA Telegram', 'success');
            res.json({ success: true, token: 'pin_' + dashboardPIN });
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
                // Trigger update check
                try {
                    const { execSync } = require('child_process');
                    const result = execSync('cd ' + (process.env.GSTD_INSTALL_DIR || (0, path_1.join)(require('os').homedir(), 'gstdbot')) + ' && git fetch origin main 2>&1 && git log HEAD..origin/main --oneline 2>&1', { timeout: 15000 }).toString();
                    if (result.trim()) {
                        await sendReply('📦 Updates available:\n```\n' + result.trim() + '\n```\nApplying update...');
                        execSync('cd ' + (process.env.GSTD_INSTALL_DIR || (0, path_1.join)(require('os').homedir(), 'gstdbot')) + ' && git pull origin main --ff-only && npm install --production && npx tsc', { timeout: 120000 });
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
                        const { execSync } = require('child_process');
                        const cwd = (0, path_1.join)(__dirname, '../..');
                        execSync('git pull', { cwd, encoding: 'utf-8', timeout: 30000 });
                        execSync('npx tsc', { cwd, encoding: 'utf-8', timeout: 60000 });
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
            const ok = await this.appManager.install(appId);
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
        logActivity('Node OS mounted on gateway — all-in-one on :' + this.config.apiPort);
    }
    getFallbackHTML() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GSTD Node</title></head>
<body style="font-family:sans-serif;background:#030014;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;"><img src="/static/logo.png" alt="GSTD" style="width:64px;border-radius:12px;margin-bottom:12px;"><h1>GSTD Node Online</h1><p>Dashboard UI not found. Check web/dashboard.html</p>
<p><a href="/api/node/status" style="color:#06b6d4;">View API Status →</a></p></div></body></html>`;
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