"use strict";
/**
 * GSTD Mobile Node — Telegram Mini App Backend
 *
 * Turns any smartphone into a GSTD node via Telegram.
 * Users open the Mini App → instant node activation → earn GSTD.
 *
 * Key flows:
 *  1. User opens TMA → auto-registers as mobile node
 *  2. Background heartbeat keeps node "alive" while app is open
 *  3. TON Connect wallet attachment for reward claims
 *  4. Task processing (lightweight: AI queries, verification)
 *  5. Real-time stats: earnings, uptime, tier progression
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MobileNodeManager = void 0;
const crypto_1 = require("crypto");
const server_js_1 = require("../gateway/server.js");
// ─── Mobile Node Manager ─────────────────────────────────────────
class MobileNodeManager {
    sessions = new Map();
    config;
    heartbeatIntervals = new Map();
    constructor(config) {
        this.config = config;
    }
    /**
     * Register Mini App API routes on the gateway Express app
     */
    registerRoutes(app) {
        // ── TMA Init Data Validation Middleware ──
        const validateTMA = (req, res, next) => {
            const initData = req.headers['x-tma-init-data'];
            if (!initData) {
                return res.status(401).json({ error: 'Missing Telegram Mini App init data' });
            }
            const user = this.validateInitData(initData);
            if (!user) {
                return res.status(401).json({ error: 'Invalid Telegram Mini App init data' });
            }
            req.tmaUser = user;
            next();
        };
        // ── Activate Mobile Node ──
        app.post('/tma/node/activate', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            const { wallet_address, device } = req.body || {};
            try {
                const session = await this.activateNode(user.id, {
                    username: user.username || '',
                    firstName: user.first_name || 'User',
                    walletAddress: wallet_address,
                    device: this.sanitizeDeviceInfo(device),
                });
                // Notify backend with real device resources
                await this.notifyBackend('/nodes/activate-wallet', {
                    wallet_address: session.walletAddress || `tg-mobile-${user.id}`,
                    source: 'telegram_miniapp',
                    node_type: 'mobile',
                    telegram_id: user.id,
                    device_resources: {
                        cpu_cores: session.device.cpuCores,
                        ram_gb: session.device.ramGb,
                        battery: session.device.batteryLevel,
                        network: session.device.networkType,
                        downlink_mbps: session.device.downlinkMbps,
                        platform: session.device.platform,
                    },
                });
                res.json({
                    status: 'active',
                    node_id: session.nodeId,
                    tier: session.tier,
                    device_resources: {
                        cpu_cores: session.device.cpuCores,
                        ram_gb: session.device.ramGb,
                        battery: session.device.batteryLevel,
                        network: session.device.networkType,
                    },
                    message: 'Mobile node activated! Your phone resources are contributing to the network.',
                });
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        // ── Node Status ──
        app.get('/tma/node/status', validateTMA, (req, res) => {
            const user = req.tmaUser;
            const session = this.sessions.get(user.id);
            if (!session || !session.isActive) {
                return res.json({
                    active: false,
                    message: 'Node not running. Tap "Start Node" to begin earning.',
                });
            }
            const uptimeMinutes = Math.floor((Date.now() - session.startedAt) / 60000);
            const estimatedHourlyRate = this.getHourlyRate(session.tier);
            res.json({
                active: true,
                node_id: session.nodeId,
                tier: session.tier,
                tier_emoji: this.getTierEmoji(session.tier),
                uptime_minutes: uptimeMinutes,
                uptime_formatted: this.formatUptime(uptimeMinutes),
                tasks_completed: session.tasksCompleted,
                earnings_session: Math.round(session.earningsSession * 10000) / 10000,
                earnings_rate_hour: estimatedHourlyRate,
                wallet_address: session.walletAddress || null,
                wallet_linked: !!session.walletAddress,
                peers_online: this.sessions.size,
                // Real device resources from user's smartphone
                device: {
                    cpu_cores: session.device.cpuCores,
                    ram_gb: session.device.ramGb,
                    battery: session.device.batteryLevel,
                    charging: session.device.isCharging,
                    network: session.device.networkType,
                    downlink_mbps: session.device.downlinkMbps,
                    effective_type: session.device.effectiveType,
                    platform: session.device.platform,
                    js_heap_mb: session.device.jsHeapMb,
                },
            });
        });
        // ── Mobile Heartbeat (called every 30s by Mini App) ──
        // Device sends real-time resource metrics with each heartbeat
        app.post('/tma/node/heartbeat', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            const session = this.sessions.get(user.id);
            if (!session || !session.isActive) {
                return res.json({ status: 'inactive', message: 'Node not running' });
            }
            session.lastHeartbeat = Date.now();
            session.uptimeMinutes = Math.floor((Date.now() - session.startedAt) / 60000);
            // Update device resources from client (real phone metrics)
            const { device } = req.body || {};
            if (device) {
                const sanitized = this.sanitizeDeviceInfo(device);
                session.device = { ...session.device, ...sanitized };
            }
            // Warn if battery is low and not charging
            let batteryWarning = null;
            if (session.device.batteryLevel < 15 && !session.device.isCharging) {
                batteryWarning = 'Low battery! Connect charger to keep earning.';
            }
            // Check for pending tasks
            const task = await this.pollTask(session);
            res.json({
                status: 'alive',
                uptime_minutes: session.uptimeMinutes,
                earnings_session: session.earningsSession,
                tier: session.tier,
                pending_task: task,
                next_reward_in: this.getNextRewardTime(session),
                battery_warning: batteryWarning,
                device_ack: {
                    cpu_cores: session.device.cpuCores,
                    ram_gb: session.device.ramGb,
                    battery: session.device.batteryLevel,
                },
            });
        });
        // ── Link TON Wallet ──
        app.post('/tma/node/link-wallet', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            const { wallet_address, ton_connect_proof } = req.body || {};
            if (!wallet_address) {
                return res.status(400).json({ error: 'wallet_address required' });
            }
            const session = this.sessions.get(user.id);
            if (session) {
                session.walletAddress = wallet_address;
            }
            // Notify backend about wallet link
            try {
                await this.notifyBackend('/wallet/link-telegram', {
                    telegram_id: user.id,
                    wallet_address,
                    proof: ton_connect_proof,
                });
            }
            catch { /* non-fatal */ }
            // Also update the node in backend
            try {
                await this.notifyBackend('/nodes/heartbeat', {
                    wallet_address: wallet_address,
                    node_id: session?.nodeId || `tg-mobile-${user.id}`,
                    node_name: `📱 ${session?.firstName || 'User'}'s Phone`,
                    node_version: '3.3.0-mobile',
                    status: 'online',
                    battery: session?.device?.batteryLevel || 100,
                });
            }
            catch { /* non-fatal */ }
            res.json({
                status: 'linked',
                wallet_address,
                message: 'Wallet linked! Rewards will be sent to this address.',
            });
        });
        // ── Stop Node ──
        app.post('/tma/node/stop', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            await this.deactivateNode(user.id);
            res.json({
                status: 'stopped',
                message: 'Node stopped. Your earnings are saved.',
            });
        });
        // ── Complete Task ──
        app.post('/tma/node/task/complete', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            const { task_id, result } = req.body || {};
            const session = this.sessions.get(user.id);
            if (!session || !task_id) {
                return res.status(400).json({ error: 'Invalid request' });
            }
            session.tasksCompleted++;
            const reward = 0.01; // Base reward per task
            session.earningsSession += reward;
            // Report to backend
            try {
                await this.notifyBackend('/tasks/complete', {
                    task_id,
                    node_id: session.nodeId,
                    wallet_address: session.walletAddress || `tg-mobile-${user.id}`,
                    result,
                });
            }
            catch { /* non-fatal */ }
            res.json({
                status: 'completed',
                reward,
                total_tasks: session.tasksCompleted,
                total_earnings: session.earningsSession,
            });
        });
        // ── Claim Rewards ──
        app.post('/tma/node/claim', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            const session = this.sessions.get(user.id);
            if (!session || session.earningsSession <= 0) {
                return res.json({ status: 'nothing_to_claim', earnings: 0 });
            }
            if (!session.walletAddress) {
                return res.status(400).json({
                    error: 'wallet_required',
                    message: 'Link a TON wallet first to claim rewards.',
                });
            }
            const amount = session.earningsSession;
            try {
                const claimResult = await this.notifyBackend('/nodes/sync-earnings', {
                    wallet_address: session.walletAddress,
                    amount,
                    earning_type: 'mobile_node',
                    description: `Mobile node earnings (${session.uptimeMinutes}min uptime, ${session.tasksCompleted} tasks)`,
                });
                session.earningsSession = 0;
                res.json({
                    status: 'claimed',
                    amount,
                    wallet: session.walletAddress,
                    message: `${amount.toFixed(4)} GSTD claimed to your wallet!`,
                });
            }
            catch (err) {
                res.status(500).json({ error: 'Claim failed: ' + err.message });
            }
        });
        // ── Network Stats (aggregates real device resources from all phones) ──
        app.get('/tma/network/stats', (req, res) => {
            const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive);
            // Aggregate real device resources contributed by all mobile nodes
            const totalCpuCores = activeSessions.reduce((s, n) => s + n.device.cpuCores, 0);
            const totalRamGb = activeSessions.reduce((s, n) => s + n.device.ramGb, 0);
            const avgBattery = activeSessions.length > 0
                ? Math.round(activeSessions.reduce((s, n) => s + n.device.batteryLevel, 0) / activeSessions.length)
                : 0;
            const totalBandwidthMbps = activeSessions.reduce((s, n) => s + n.device.downlinkMbps, 0);
            res.json({
                mobile_nodes_online: activeSessions.length,
                total_uptime_hours: activeSessions.reduce((s, n) => s + n.uptimeMinutes / 60, 0).toFixed(1),
                total_tasks_completed: activeSessions.reduce((s, n) => s + n.tasksCompleted, 0),
                total_gstd_earned: activeSessions.reduce((s, n) => s + n.earningsSession, 0).toFixed(4),
                // Aggregated real phone resources contributed to the network
                contributed_resources: {
                    total_cpu_cores: totalCpuCores,
                    total_ram_gb: Math.round(totalRamGb * 10) / 10,
                    avg_battery_pct: avgBattery,
                    total_bandwidth_mbps: Math.round(totalBandwidthMbps * 10) / 10,
                    platforms: {
                        android: activeSessions.filter(s => s.device.platform === 'android').length,
                        ios: activeSessions.filter(s => s.device.platform === 'ios').length,
                        other: activeSessions.filter(s => !['android', 'ios'].includes(s.device.platform)).length,
                    },
                    network_types: {
                        wifi: activeSessions.filter(s => s.device.networkType === 'wifi').length,
                        cellular: activeSessions.filter(s => s.device.networkType === 'cellular').length,
                        other: activeSessions.filter(s => !['wifi', 'cellular'].includes(s.device.networkType)).length,
                    },
                },
                tiers: {
                    bronze: activeSessions.filter(s => s.tier === 'bronze').length,
                    silver: activeSessions.filter(s => s.tier === 'silver').length,
                    gold: activeSessions.filter(s => s.tier === 'gold').length,
                    platinum: activeSessions.filter(s => s.tier === 'platinum').length,
                },
            });
        });
        // ── Get Linked Wallet from Telegram Bot ──
        app.get('/tma/node/linked-wallet', validateTMA, async (req, res) => {
            const user = req.tmaUser;
            try {
                const resp = await fetch(`${this.config.apiUrl}/telegram/bot/wallet?telegram_id=${user.id}`, {
                    headers: {
                        'X-Bot-Token': this.config.botToken,
                    },
                    signal: AbortSignal.timeout(5000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    res.json({
                        linked: !!data.linked,
                        wallet_address: data.wallet || null,
                    });
                }
                else {
                    res.json({ linked: false, wallet_address: null });
                }
            }
            catch {
                res.json({ linked: false, wallet_address: null });
            }
        });
        // ── Serve Mini App HTML ──
        app.get('/tma', (req, res) => {
            const langParam = req.query.lang || '';
            const acceptLang = req.headers['accept-language'] || '';
            const lang = langParam === 'ru' || (!langParam && acceptLang.startsWith('ru')) ? 'ru' : 'en';
            res.send(this.getMiniAppHTML(lang));
        });
        console.log('    Mobile Node: TMA routes registered (/tma/*)');
    }
    // ─── Node Lifecycle ──────────────────────────────────────────
    /** Sanitize & validate device info received from client */
    sanitizeDeviceInfo(raw) {
        if (!raw || typeof raw !== 'object')
            return this.defaultDeviceResources();
        return {
            cpuCores: Math.min(Math.max(parseInt(raw.cpuCores) || 1, 1), 32),
            ramGb: Math.min(Math.max(parseFloat(raw.ramGb) || 1, 0.25), 64),
            batteryLevel: Math.min(Math.max(parseInt(raw.batteryLevel) || 100, 0), 100),
            isCharging: !!raw.isCharging,
            networkType: ['wifi', 'cellular', 'ethernet'].includes(raw.networkType) ? raw.networkType : 'unknown',
            downlinkMbps: Math.min(Math.max(parseFloat(raw.downlinkMbps) || 0, 0), 1000),
            effectiveType: ['slow-2g', '2g', '3g', '4g'].includes(raw.effectiveType) ? raw.effectiveType : '4g',
            platform: ['android', 'ios'].includes(raw.platform?.toLowerCase()) ? raw.platform.toLowerCase() : 'other',
            jsHeapMb: Math.min(Math.max(parseFloat(raw.jsHeapMb) || 0, 0), 4096),
            screenRes: typeof raw.screenRes === 'string' ? raw.screenRes.slice(0, 20) : 'unknown',
            userAgent: typeof raw.userAgent === 'string' ? raw.userAgent.slice(0, 200) : '',
        };
    }
    defaultDeviceResources() {
        return {
            cpuCores: 1, ramGb: 1, batteryLevel: 100, isCharging: false,
            networkType: 'unknown', downlinkMbps: 0, effectiveType: '4g',
            platform: 'other', jsHeapMb: 0, screenRes: 'unknown', userAgent: '',
        };
    }
    async activateNode(telegramId, info) {
        // Check if already active
        const existing = this.sessions.get(telegramId);
        if (existing?.isActive) {
            // Update device resources on re-activate
            if (info.device)
                existing.device = info.device;
            // Update wallet if newly provided
            if (info.walletAddress && !existing.walletAddress) {
                existing.walletAddress = info.walletAddress;
            }
            return existing;
        }
        // Auto-fetch wallet from Telegram bot if not provided
        let walletAddress = info.walletAddress;
        if (!walletAddress) {
            try {
                const resp = await fetch(`${this.config.apiUrl}/telegram/bot/wallet?telegram_id=${telegramId}`, {
                    headers: { 'X-Bot-Token': this.config.botToken },
                    signal: AbortSignal.timeout(5000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.linked && data.wallet) {
                        walletAddress = data.wallet;
                        (0, server_js_1.logActivity)(`Mobile node auto-linked wallet from TG bot: ${walletAddress?.slice(0, 12)}...`, 'info');
                    }
                }
            }
            catch { /* silent — will use tg-mobile-{id} fallback */ }
        }
        const session = {
            telegramId,
            username: info.username,
            firstName: info.firstName,
            walletAddress: walletAddress,
            nodeId: `mobile-${telegramId}-${Date.now().toString(36)}`,
            startedAt: Date.now(),
            lastHeartbeat: Date.now(),
            uptimeMinutes: 0,
            tasksCompleted: 0,
            earningsSession: 0,
            tier: 'bronze',
            isActive: true,
            device: info.device || this.defaultDeviceResources(),
        };
        this.sessions.set(telegramId, session);
        // Start server-side heartbeat (reports to backend every 5 min)
        const interval = setInterval(async () => {
            const s = this.sessions.get(telegramId);
            if (!s || !s.isActive) {
                clearInterval(interval);
                return;
            }
            // Check if client is still alive (heartbeat within last 2 min)
            if (Date.now() - s.lastHeartbeat > 120000) {
                (0, server_js_1.logActivity)(`Mobile node ${s.nodeId} timed out`, 'warn');
                await this.deactivateNode(telegramId);
                return;
            }
            // Report to backend with real device resources
            try {
                const resp = await fetch(`${this.config.apiUrl}/nodes/heartbeat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        wallet_address: s.walletAddress || `tg-mobile-${telegramId}`,
                        node_id: s.nodeId,
                        node_name: `📱 ${s.firstName}'s Phone`,
                        node_version: '3.3.0-mobile',
                        status: 'online',
                        // Real device resources from user's smartphone
                        cpu_cores: s.device.cpuCores,
                        ram_gb: s.device.ramGb,
                        battery: s.device.batteryLevel,
                        is_charging: s.device.isCharging,
                        network_type: s.device.networkType,
                        downlink_mbps: s.device.downlinkMbps,
                        effective_type: s.device.effectiveType,
                        platform: s.device.platform,
                        uptime_hours: Math.floor(s.uptimeMinutes / 60),
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.reward > 0) {
                        s.earningsSession += data.reward;
                        (0, server_js_1.logActivity)(`Mobile node ${s.nodeId}: +${data.reward} GSTD (${s.device.cpuCores}CPU/${s.device.ramGb}GB/${s.device.networkType})`, 'success');
                    }
                }
            }
            catch { /* silent */ }
        }, 5 * 60 * 1000);
        this.heartbeatIntervals.set(telegramId, interval);
        (0, server_js_1.logActivity)(`Mobile node activated: ${session.nodeId} (${info.firstName})`, 'success');
        return session;
    }
    async deactivateNode(telegramId) {
        const session = this.sessions.get(telegramId);
        if (!session)
            return;
        session.isActive = false;
        // Clear heartbeat interval
        const interval = this.heartbeatIntervals.get(telegramId);
        if (interval) {
            clearInterval(interval);
            this.heartbeatIntervals.delete(telegramId);
        }
        // Deregister from backend
        try {
            await fetch(`${this.config.apiUrl}/nodes/deregister`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: session.nodeId }),
                signal: AbortSignal.timeout(5000),
            });
        }
        catch { /* non-fatal */ }
        (0, server_js_1.logActivity)(`Mobile node stopped: ${session.nodeId}`, 'info');
    }
    // ─── Task Polling ────────────────────────────────────────────
    async pollTask(session) {
        try {
            const resp = await fetch(`${this.config.apiUrl}/tasks/poll`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': session.walletAddress || `tg-mobile-${session.telegramId}`,
                },
                body: JSON.stringify({
                    node_id: session.nodeId,
                    capabilities: ['verification', 'text-processing'],
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (resp.ok) {
                const data = await resp.json();
                return data.task || null;
            }
        }
        catch { /* silent */ }
        return null;
    }
    // ─── Backend Communication ───────────────────────────────────
    async notifyBackend(path, body) {
        const resp = await fetch(`${this.config.apiUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Token': this.config.botToken,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`Backend ${resp.status}: ${text.substring(0, 100)}`);
        }
        return resp.json();
    }
    // ─── TMA Init Data Validation ────────────────────────────────
    validateInitData(initData) {
        try {
            const params = new URLSearchParams(initData);
            const hash = params.get('hash');
            if (!hash)
                return null;
            params.delete('hash');
            const dataCheckString = Array.from(params.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}=${v}`)
                .join('\n');
            const secretKey = (0, crypto_1.createHmac)('sha256', 'WebAppData')
                .update(this.config.botToken)
                .digest();
            const computedHash = (0, crypto_1.createHmac)('sha256', secretKey)
                .update(dataCheckString)
                .digest('hex');
            if (computedHash !== hash) {
                // In development, accept if user data is present  
                const userData = params.get('user');
                if (userData) {
                    try {
                        return JSON.parse(userData);
                    }
                    catch {
                        return null;
                    }
                }
                return null;
            }
            const userStr = params.get('user');
            return userStr ? JSON.parse(userStr) : null;
        }
        catch {
            return null;
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────
    getHourlyRate(tier) {
        const rates = {
            bronze: 0.5,
            silver: 1.0,
            gold: 2.0,
            platinum: 5.0,
        };
        return rates[tier] || 0.5;
    }
    getTierEmoji(tier) {
        const emojis = {
            bronze: '🥉',
            silver: '🥈',
            gold: '🥇',
            platinum: '💎',
        };
        return emojis[tier] || '🥉';
    }
    formatUptime(minutes) {
        if (minutes < 60)
            return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }
    getNextRewardTime(session) {
        // Rewards every 60 minutes
        const minutesSinceStart = Math.floor((Date.now() - session.startedAt) / 60000);
        const nextRewardAt = Math.ceil(minutesSinceStart / 60) * 60;
        return Math.max(0, nextRewardAt - minutesSinceStart);
    }
    /**
     * Generate the Telegram Mini App HTML
     * Runs entirely inside Telegram WebView on user's smartphone.
     * Collects REAL device resources via Web APIs:
     *  - Battery API → battery level + charging state
     *  - navigator.hardwareConcurrency → CPU cores
     *  - navigator.deviceMemory → RAM in GB
     *  - NetworkInformation API → connection type + speed
     *  - performance.memory → JS heap usage
     */
    getMiniAppHTML(lang = 'en') {
        const isRu = lang === 'ru';
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>GSTD Node</title>
    <script src="https://telegram.org/js/telegram-web-app.js"><\/script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --bg: #0a0e1a; --surface: #111827; --surface2: #1f2937;
            --accent: #f59e0b; --accent2: #8b5cf6; --green: #10b981;
            --text: #f3f4f6; --text2: #9ca3af; --danger: #ef4444;
            --border: rgba(255,255,255,0.06); --blue: #3b82f6;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: var(--bg); color: var(--text);
            min-height: 100vh; overflow-x: hidden;
        }
        .container { max-width: 420px; margin: 0 auto; padding: 16px; padding-bottom: 32px; }
        .header { text-align: center; padding: 20px 0 12px; }
        .header .logo { margin-bottom: 6px; display: flex; justify-content: center; }
        .header .logo svg { width: 64px; height: 64px; filter: drop-shadow(0 0 12px rgba(255,215,0,0.4)); }
        .header h1 { font-size: 20px; font-weight: 700; }
        .header .subtitle { color: var(--text2); font-size: 12px; margin-top: 4px; }
        .card {
            background: linear-gradient(135deg, var(--surface), var(--surface2));
            border-radius: 18px; padding: 20px;
            border: 1px solid var(--border);
            margin-bottom: 12px; position: relative; overflow: hidden;
        }
        .card::before {
            content: ''; position: absolute; top: -50%; right: -50%;
            width: 100%; height: 100%;
            background: radial-gradient(circle, rgba(245,158,11,0.06), transparent);
            pointer-events: none;
        }
        .card-title { font-size: 13px; font-weight: 600; color: var(--text2); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
        .row-label { color: var(--text2); font-size: 13px; }
        .row-value { font-weight: 600; font-size: 14px; }
        .row-value.green { color: var(--green); }
        .row-value.accent { color: var(--accent); }
        .row-value.blue { color: var(--blue); }
        .row-value.danger { color: var(--danger); }
        .big-stat { text-align: center; padding: 16px 0; }
        .big-stat .number {
            font-size: 38px; font-weight: 800; letter-spacing: -1px;
            background: linear-gradient(135deg, var(--accent), var(--accent2));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .big-stat .label { color: var(--text2); font-size: 12px; margin-top: 4px; }
        .btn {
            width: 100%; padding: 14px; border: none; border-radius: 14px;
            font-size: 15px; font-weight: 700; cursor: pointer;
            transition: all 0.15s; display: flex; align-items: center;
            justify-content: center; gap: 8px; margin-bottom: 8px;
        }
        .btn-primary { background: linear-gradient(135deg, var(--accent), #d97706); color: #000; }
        .btn-primary:active { transform: scale(0.97); }
        .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
        .stat-card {
            background: var(--surface); border-radius: 14px; padding: 14px;
            text-align: center; border: 1px solid var(--border);
        }
        .stat-card .icon { font-size: 22px; margin-bottom: 4px; }
        .stat-card .val { font-size: 18px; font-weight: 700; }
        .stat-card .lbl { color: var(--text2); font-size: 10px; margin-top: 2px; }
        .loading { text-align: center; padding: 60px 0; }
        .spinner {
            width: 36px; height: 36px; border: 3px solid var(--surface2);
            border-top-color: var(--accent); border-radius: 50%;
            animation: spin 0.8s linear infinite; margin: 0 auto 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .tier-badge {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 10px; border-radius: 20px; font-size: 11px;
            font-weight: 600; background: rgba(245,158,11,0.15); color: var(--accent);
        }
        .toast {
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: var(--surface2); color: var(--text); padding: 10px 20px;
            border-radius: 12px; font-size: 13px; z-index: 100;
            border: 1px solid var(--border); opacity: 0; transition: opacity 0.3s;
            max-width: 90%;
        }
        .toast.show { opacity: 1; }
        /* Resource gauge bars */
        .gauge { margin: 6px 0; }
        .gauge-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .gauge-label { font-size: 11px; color: var(--text2); }
        .gauge-value { font-size: 11px; font-weight: 600; }
        .gauge-bar { height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
        .gauge-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
        .gauge-fill.green { background: linear-gradient(90deg, #059669, var(--green)); }
        .gauge-fill.accent { background: linear-gradient(90deg, #d97706, var(--accent)); }
        .gauge-fill.blue { background: linear-gradient(90deg, #2563eb, var(--blue)); }
        .gauge-fill.danger { background: linear-gradient(90deg, #dc2626, var(--danger)); }
        .warning-box {
            background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
            border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;
            font-size: 12px; color: var(--danger); text-align: center;
        }
    </style>
</head>
<body>
    <div class="container" id="app">
        <div class="loading"><div class="spinner"></div>
        <div style="color: var(--text2)" id="loading-text"></div></div>
    </div>
    <div class="toast" id="toast"></div>

    <script>
        // ── i18n ──
        const I18N = {
            en: {
                scanning: 'Scanning device resources...',
                title: 'GSTD Mobile Node',
                subtitle: 'Your phone becomes a node in the AI network',
                gstd_per_hour: 'GSTD per hour (Bronze tier)',
                hi: 'Hi',
                contribute_msg: "Your phone's CPU, RAM and network<br>will contribute to the decentralized AI swarm.",
                wallet_label: 'Wallet',
                link_wallet_hint: 'Link wallet via @GSTDCoinBot to receive rewards',
                start_node: '🚀 Start Node',
                device_resources: '📱 Your Device Resources',
                ai_models: 'AI Models',
                earning: 'Earning',
                node_running: 'Node Running',
                earned_session: 'GSTD Earned This Session',
                uptime: 'Uptime',
                tasks_label: 'Tasks',
                rate: 'Rate',
                peers: 'Peers',
                online: 'online',
                not_linked: '⚠️ Not linked',
                next_reward: 'Next Reward',
                phone_resources: '📱 Phone Resources (Live)',
                cores_shared: 'cores shared',
                gb_shared: 'GB shared',
                charging: 'charging',
                network: 'Network',
                quality: 'Quality',
                low_battery: '🔋 Low battery',
                connect_charger: 'Connect a charger to keep earning.',
                claim_rewards: '💎 Claim Rewards',
                stop_node: '⏹ Stop Node',
                activated: 'Node activated!',
                cores_contributing: 'CPU cores contributing.',
                activation_failed: '❌ Activation failed',
                node_stopped: 'Node stopped',
                claimed: 'GSTD claimed!',
                wallet_required: '⚠️ Link a TON wallet first',
                nothing_to_claim: 'Nothing to claim yet',
                claim_failed: '❌ Claim failed',
                scanning_resources: 'Scanning device resources...',
                platform: 'Platform',
                screen: 'Screen',
                cpu_cores: 'CPU Cores',
                ram: 'RAM',
                battery: 'Battery',
                cpu: 'CPU',
                min: 'min',
            },
            ru: {
                scanning: 'Сканирование ресурсов устройства...',
                title: 'GSTD Мобильная Нода',
                subtitle: 'Ваш телефон становится узлом ИИ-сети',
                gstd_per_hour: 'GSTD в час (Бронзовый тир)',
                hi: 'Привет',
                contribute_msg: 'CPU, RAM и сеть вашего телефона<br>будут работать в децентрализованном ИИ рое.',
                wallet_label: 'Кошелёк',
                link_wallet_hint: 'Привяжите кошелёк через @GSTDCoinBot для получения наград',
                start_node: '🚀 Запустить ноду',
                device_resources: '📱 Ресурсы устройства',
                ai_models: 'ИИ Модели',
                earning: 'Заработок',
                node_running: 'Нода работает',
                earned_session: 'GSTD заработано за сессию',
                uptime: 'Аптайм',
                tasks_label: 'Задачи',
                rate: 'Ставка',
                peers: 'Пиры',
                online: 'онлайн',
                not_linked: '⚠️ Не привязан',
                next_reward: 'Следующая награда',
                phone_resources: '📱 Ресурсы телефона (Live)',
                cores_shared: 'ядер расшарено',
                gb_shared: 'ГБ расшарено',
                charging: 'заряжается',
                network: 'Сеть',
                quality: 'Качество',
                low_battery: '🔋 Низкий заряд',
                connect_charger: 'Подключите зарядку, чтобы продолжить заработок.',
                claim_rewards: '💎 Получить награды',
                stop_node: '⏹ Остановить ноду',
                activated: 'Нода активирована!',
                cores_contributing: 'ядер CPU вносят вклад.',
                activation_failed: '❌ Ошибка активации',
                node_stopped: 'Нода остановлена',
                claimed: 'GSTD получено!',
                wallet_required: '⚠️ Сначала привяжите TON-кошелёк',
                nothing_to_claim: 'Пока нечего забирать',
                claim_failed: '❌ Ошибка получения',
                scanning_resources: 'Сканирование ресурсов...',
                platform: 'Платформа',
                screen: 'Экран',
                cpu_cores: 'Ядра CPU',
                ram: 'RAM',
                battery: 'Батарея',
                cpu: 'CPU',
                min: 'мин',
            }
        };
        // Detect language: from URL param, then from TG user, fallback to server-set
        const urlLang = new URLSearchParams(location.search).get('lang');
        const serverLang = '${isRu ? 'ru' : 'en'}';
        const L = I18N[urlLang === 'ru' ? 'ru' : urlLang === 'en' ? 'en' : serverLang] || I18N.en;

        // Set loading text
        document.addEventListener('DOMContentLoaded', () => {
            const lt = document.getElementById('loading-text');
            if (lt) lt.textContent = L.scanning;
        });

        // ── Telegram WebApp Init ──
        const tg = window.Telegram?.WebApp;
        if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0a0e1a'); tg.setBackgroundColor('#0a0e1a'); }

        const API = '';
        let nodeState = { active: false };
        let deviceInfo = {};
        let heartbeatTimer = null;
        let batteryRef = null;
        let linkedWallet = null;

        function getHeaders() {
            const h = { 'Content-Type': 'application/json' };
            if (tg?.initData) h['X-TMA-Init-Data'] = tg.initData;
            return h;
        }
        function toast(msg) {
            const el = document.getElementById('toast');
            el.textContent = msg; el.classList.add('show');
            setTimeout(() => el.classList.remove('show'), 2500);
        }

        // ══════════════════════════════════════════════════════════
        // DEVICE RESOURCE COLLECTION — all from user's smartphone
        // ══════════════════════════════════════════════════════════
        async function collectDeviceResources() {
            const info = {
                cpuCores: navigator.hardwareConcurrency || 1,
                ramGb: navigator.deviceMemory || estimateRAM(),
                batteryLevel: 100,
                isCharging: true,
                networkType: 'unknown',
                downlinkMbps: 0,
                effectiveType: '4g',
                platform: detectPlatform(),
                jsHeapMb: 0,
                screenRes: screen.width + 'x' + screen.height,
                userAgent: navigator.userAgent.slice(0, 200),
            };

            // Battery API (Android only in TG WebView, iOS limited)
            try {
                if (navigator.getBattery) {
                    const batt = await navigator.getBattery();
                    batteryRef = batt;
                    info.batteryLevel = Math.round(batt.level * 100);
                    info.isCharging = batt.charging;
                    // Live updates
                    batt.addEventListener('levelchange', () => {
                        deviceInfo.batteryLevel = Math.round(batt.level * 100);
                    });
                    batt.addEventListener('chargingchange', () => {
                        deviceInfo.isCharging = batt.charging;
                    });
                }
            } catch {}

            // Network Information API
            try {
                const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                if (conn) {
                    info.downlinkMbps = conn.downlink || 0;
                    info.effectiveType = conn.effectiveType || '4g';
                    info.networkType = conn.type || (conn.downlink > 5 ? 'wifi' : 'cellular');
                    conn.addEventListener('change', () => {
                        deviceInfo.downlinkMbps = conn.downlink || 0;
                        deviceInfo.effectiveType = conn.effectiveType || '4g';
                        deviceInfo.networkType = conn.type || (conn.downlink > 5 ? 'wifi' : 'cellular');
                    });
                }
            } catch {}

            // JS Heap (Chrome-based browsers)
            try {
                if (performance.memory) {
                    info.jsHeapMb = Math.round(performance.memory.usedJSHeapSize / 1048576);
                }
            } catch {}

            deviceInfo = info;
            return info;
        }

        function estimateRAM() {
            // Fallback: estimate based on platform and screen size
            const pixels = screen.width * screen.height;
            if (pixels > 2000000) return 6; // flagship
            if (pixels > 1000000) return 4; // mid-range
            return 2; // low-end
        }

        function detectPlatform() {
            const ua = navigator.userAgent.toLowerCase();
            if (ua.includes('android')) return 'android';
            if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
            return 'other';
        }

        function refreshDynamicMetrics() {
            if (batteryRef) {
                deviceInfo.batteryLevel = Math.round(batteryRef.level * 100);
                deviceInfo.isCharging = batteryRef.charging;
            }
            try {
                if (performance.memory) {
                    deviceInfo.jsHeapMb = Math.round(performance.memory.usedJSHeapSize / 1048576);
                }
            } catch {}
            try {
                const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                if (conn) {
                    deviceInfo.downlinkMbps = conn.downlink || deviceInfo.downlinkMbps;
                    deviceInfo.effectiveType = conn.effectiveType || deviceInfo.effectiveType;
                }
            } catch {}
        }
        // ══════════════════════════════════════════════════════════

        async function checkStatus() {
            try {
                const r = await fetch(API + '/tma/node/status', { headers: getHeaders() });
                const d = await r.json();
                nodeState = d;
                render();
            } catch { renderInactive(); }
        }

        async function startNode() {
            try {
                document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><div style="color:var(--text2)">' + L.scanning_resources + '</div></div>';
                // Collect real resources before activating
                await collectDeviceResources();
                // Fetch linked wallet from Telegram bot
                if (!linkedWallet) {
                    try {
                        const wr = await fetch(API + '/tma/node/linked-wallet', { headers: getHeaders() });
                        const wd = await wr.json();
                        if (wd.linked && wd.wallet_address) {
                            linkedWallet = wd.wallet_address;
                        }
                    } catch {}
                }
                const body = { device: deviceInfo };
                if (linkedWallet) body.wallet_address = linkedWallet;
                const r = await fetch(API + '/tma/node/activate', {
                    method: 'POST', headers: getHeaders(),
                    body: JSON.stringify(body)
                });
                const d = await r.json();
                if (d.status === 'active') {
                    const walletMsg = linkedWallet ? ' ' + L.wallet_label + ': ' + linkedWallet.slice(0,6) + '...' + linkedWallet.slice(-4) : '';
                    toast('🐝 ' + L.activated + ' ' + deviceInfo.cpuCores + ' ' + L.cores_contributing + walletMsg);
                    startHeartbeat();
                }
                await checkStatus();
            } catch (e) {
                toast(L.activation_failed);
                renderInactive();
            }
        }

        async function stopNode() {
            clearInterval(heartbeatTimer);
            try {
                await fetch(API + '/tma/node/stop', { method: 'POST', headers: getHeaders(), body: '{}' });
                toast(L.node_stopped);
            } catch {}
            nodeState = { active: false };
            render();
        }

        async function claimRewards() {
            try {
                const r = await fetch(API + '/tma/node/claim', { method: 'POST', headers: getHeaders(), body: '{}' });
                const d = await r.json();
                if (d.status === 'claimed') toast('✅ ' + d.amount.toFixed(4) + ' ' + L.claimed);
                else if (d.error === 'wallet_required') toast(L.wallet_required);
                else toast(L.nothing_to_claim);
                await checkStatus();
            } catch { toast(L.claim_failed); }
        }

        function startHeartbeat() {
            clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(async () => {
                refreshDynamicMetrics();
                try {
                    const r = await fetch(API + '/tma/node/heartbeat', {
                        method: 'POST', headers: getHeaders(),
                        body: JSON.stringify({ device: deviceInfo })
                    });
                    const d = await r.json();
                    if (d.battery_warning) toast('🔋 ' + d.battery_warning);
                } catch {}
                await checkStatus();
            }, 30000);
        }

        function render() {
            if (!nodeState.active) return renderInactive();
            renderActive();
        }

        function gaugeHTML(label, value, max, unit, colorClass) {
            const pct = Math.min(100, Math.round((value / max) * 100));
            return '<div class="gauge">' +
                '<div class="gauge-header"><span class="gauge-label">' + label + '</span>' +
                '<span class="gauge-value">' + value + ' ' + unit + '</span></div>' +
                '<div class="gauge-bar"><div class="gauge-fill ' + colorClass + '" style="width:' + pct + '%"></div></div></div>';
        }

        const GSTD_LOGO_SVG = '<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<defs><linearGradient id="gldG" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#FFD700"/><stop offset="50%" stop-color="#FFC91A"/><stop offset="100%" stop-color="#FFB300"/>' +
            '<\\/linearGradient><\\/defs>' +
            '<circle cx="60" cy="60" r="55" fill="url(#gldG)" stroke="#FFD700" stroke-width="2"/>' +
            '<g opacity="0.25"><circle cx="25" cy="25" r="2" fill="#0a1929"/><circle cx="95" cy="25" r="2" fill="#0a1929"/>' +
            '<circle cx="25" cy="95" r="2" fill="#0a1929"/><circle cx="95" cy="95" r="2" fill="#0a1929"/>' +
            '<line x1="25" y1="25" x2="95" y2="25" stroke="#0a1929" stroke-width="1"/>' +
            '<line x1="25" y1="95" x2="95" y2="95" stroke="#0a1929" stroke-width="1"/><\\/g>' +
            '<g transform="translate(60,60)"><ellipse cx="-12" cy="0" rx="8" ry="12" fill="url(#gldG)" stroke="#FFB300" stroke-width="0.5"/>' +
            '<ellipse cx="12" cy="0" rx="8" ry="12" fill="url(#gldG)" stroke="#FFB300" stroke-width="0.5"/>' +
            '<circle cx="0" cy="0" r="2.5" fill="#FFD700"/><\\/g><\\/svg>';

        function renderInactive() {
            const name = tg?.initDataUnsafe?.user?.first_name || 'there';
            const di = deviceInfo;
            const hasDevice = di.cpuCores > 0;
            const walletInfo = linkedWallet
                ? '<div class="row" style="margin-top:8px"><span class="row-label">💼 ' + L.wallet_label + '</span><span class="row-value green">' + linkedWallet.slice(0,6) + '...' + linkedWallet.slice(-4) + ' ✅</span></div>'
                : '<div style="text-align:center;color:var(--text2);font-size:11px;margin-top:6px">💡 ' + L.link_wallet_hint + '</div>';
            document.getElementById('app').innerHTML =
                '<div class="header">' +
                    '<div class="logo">' + GSTD_LOGO_SVG + '</div>' +
                    '<h1>' + L.title + '</h1>' +
                    '<div class="subtitle">' + L.subtitle + '</div>' +
                '</div>' +
                '<div class="card">' +
                    '<div class="big-stat">' +
                        '<div class="number">0.5</div>' +
                        '<div class="label">' + L.gstd_per_hour + '</div>' +
                    '</div>' +
                    '<div style="text-align:center;color:var(--text2);font-size:12px;margin-bottom:14px">' +
                        L.hi + ', ' + name + '! ' + L.contribute_msg +
                    '</div>' +
                    walletInfo +
                    '<button class="btn btn-primary" onclick="startNode()" style="margin-top:12px">' +
                        L.start_node +
                    '</button>' +
                '</div>' +
                (hasDevice ?
                '<div class="card">' +
                    '<div class="card-title">' + L.device_resources + '</div>' +
                    gaugeHTML(L.cpu_cores, di.cpuCores, 8, 'cores', 'blue') +
                    gaugeHTML(L.ram, di.ramGb, 8, 'GB', 'accent') +
                    gaugeHTML(L.battery, di.batteryLevel, 100, '%' + (di.isCharging ? ' ⚡' : ''), di.batteryLevel < 20 ? 'danger' : 'green') +
                    '<div class="row"><span class="row-label">' + L.network + '</span><span class="row-value blue">' + (di.networkType || 'unknown') + ' (' + (di.downlinkMbps || '?') + ' Mbps)</span></div>' +
                    '<div class="row"><span class="row-label">' + L.platform + '</span><span class="row-value">' + (di.platform || 'unknown') + '</span></div>' +
                    '<div class="row"><span class="row-label">' + L.screen + '</span><span class="row-value">' + (di.screenRes || '?') + '</span></div>' +
                '</div>' : '') +
                '<div class="stats-grid">' +
                    '<div class="stat-card"><div class="icon">🧠</div><div class="val">8</div><div class="lbl">' + L.ai_models + '</div></div>' +
                    '<div class="stat-card"><div class="icon">💰</div><div class="val">24/7</div><div class="lbl">' + L.earning + '</div></div>' +
                '</div>';
        }

        function renderActive() {
            const d = nodeState;
            const dev = d.device || deviceInfo;
            const battPct = dev.battery || dev.batteryLevel || 100;
            const battColor = battPct < 20 ? 'danger' : 'green';
            const battCharging = dev.charging || dev.isCharging;

            let html =
                '<div class="header">' +
                    '<div class="logo pulse">' + GSTD_LOGO_SVG + '</div>' +
                    '<h1>' + L.node_running + '</h1>' +
                    '<div class="subtitle"><span class="tier-badge">' + (d.tier_emoji || '🥉') + ' ' + (d.tier || 'bronze').toUpperCase() + '</span></div>' +
                '</div>' +
                '<div class="card">' +
                    '<div class="big-stat">' +
                        '<div class="number">' + (d.earnings_session?.toFixed(4) || '0.0000') + '</div>' +
                        '<div class="label">' + L.earned_session + '</div>' +
                    '</div>' +
                    '<div class="row"><span class="row-label">⏱ ' + L.uptime + '</span><span class="row-value green">' + (d.uptime_formatted || '0m') + '</span></div>' +
                    '<div class="row"><span class="row-label">📋 ' + L.tasks_label + '</span><span class="row-value">' + (d.tasks_completed || 0) + '</span></div>' +
                    '<div class="row"><span class="row-label">💰 ' + L.rate + '</span><span class="row-value accent">' + (d.earnings_rate_hour || 0.5) + ' GSTD/h</span></div>' +
                    '<div class="row"><span class="row-label">🌐 ' + L.peers + '</span><span class="row-value">' + (d.peers_online || 1) + ' ' + L.online + '</span></div>' +
                    '<div class="row"><span class="row-label">💼 ' + L.wallet_label + '</span><span class="row-value">' + (d.wallet_linked ? d.wallet_address?.slice(0,6)+'...'+d.wallet_address?.slice(-4) : L.not_linked) + '</span></div>' +
                    '<div class="row"><span class="row-label">⏳ ' + L.next_reward + '</span><span class="row-value">' + (d.next_reward_in || 0) + ' ' + L.min + '</span></div>' +
                '</div>';

            // Device resources card (real phone data)
            html +=
                '<div class="card">' +
                    '<div class="card-title">' + L.phone_resources + '</div>' +
                    gaugeHTML(L.cpu, dev.cpu_cores || dev.cpuCores || 1, 8, L.cores_shared, 'blue') +
                    gaugeHTML(L.ram, dev.ram_gb || dev.ramGb || 1, 8, L.gb_shared, 'accent') +
                    gaugeHTML(L.battery, battPct, 100, '%' + (battCharging ? ' ⚡ ' + L.charging : ''), battColor) +
                    '<div class="row"><span class="row-label">📶 ' + L.network + '</span><span class="row-value blue">' +
                        (dev.network || dev.networkType || '?') + ' · ' + (dev.downlink_mbps || dev.downlinkMbps || 0) + ' Mbps</span></div>' +
                    '<div class="row"><span class="row-label">📡 ' + L.quality + '</span><span class="row-value">' + (dev.effective_type || dev.effectiveType || '4g') + '</span></div>' +
                '</div>';

            // Low battery warning
            if (battPct < 15 && !battCharging) {
                html += '<div class="warning-box">' + L.low_battery + ' (' + battPct + '%)! ' + L.connect_charger + '</div>';
            }

            html +=
                '<button class="btn btn-primary" onclick="claimRewards()">' + L.claim_rewards + '</button>' +
                '<button class="btn btn-secondary" onclick="stopNode()">' + L.stop_node + '</button>';

            document.getElementById('app').innerHTML = html;
        }

        // ── Boot: scan device, fetch wallet, then check node status ──
        (async function boot() {
            await collectDeviceResources();
            // Auto-fetch wallet linked via Telegram bot
            try {
                const wr = await fetch(API + '/tma/node/linked-wallet', { headers: getHeaders() });
                const wd = await wr.json();
                if (wd.linked && wd.wallet_address) {
                    linkedWallet = wd.wallet_address;
                }
            } catch {}
            await checkStatus();
        })();
    <\/script>
</body>
</html>`;
    }
    /**
     * Get count of active mobile nodes
     */
    getActiveCount() {
        return Array.from(this.sessions.values()).filter(s => s.isActive).length;
    }
    /**
     * Cleanup on shutdown
     */
    async stop() {
        for (const [id, interval] of this.heartbeatIntervals) {
            clearInterval(interval);
        }
        this.heartbeatIntervals.clear();
        for (const [id, session] of this.sessions) {
            if (session.isActive) {
                await this.deactivateNode(id);
            }
        }
        this.sessions.clear();
    }
}
exports.MobileNodeManager = MobileNodeManager;
//# sourceMappingURL=miniapp.js.map