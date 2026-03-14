"use strict";
/**
 * GSTD Node — Dashboard Server
 * Full local web dashboard for node operators to monitor and manage their node.
 * Runs on the operator's own hardware alongside the gateway.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logActivity = logActivity;
exports.startDashboard = startDashboard;
const express_1 = __importDefault(require("express"));
const os_1 = require("os");
const fs_1 = require("fs");
const path_1 = require("path");
const manager_js_1 = require("../wallet/manager.js");
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
// Sample every second for accurate readings
setInterval(updateCpuUsage, 1000);
updateCpuUsage();
function detectGpu() {
    try {
        const { execSync } = require('child_process');
        const output = execSync('nvidia-smi --query-gpu=name,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(',').map((s) => s.trim());
        return {
            detected: true,
            model: parts[0] || 'Unknown',
            memory: parts[1] ? parts[1] + ' MiB' : undefined,
            temperature: parts[2] ? parts[2] + '°C' : undefined,
            usage: parts[3] ? parts[3] + '%' : undefined,
        };
    }
    catch (_e) {
        return { detected: false };
    }
}
function getDiskUsage() {
    try {
        const { execSync } = require('child_process');
        const output = execSync("df -B1 / | tail -1", { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const available = parseInt(parts[3]) || 0;
        return { total, used, available, usage: total > 0 ? Math.round(used / total * 100) : 0 };
    }
    catch (_e) {
        return { total: 0, used: 0, available: 0, usage: 0 };
    }
}
// ─── Network Info ────────────────────────────────────────────────
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
// ─── Node process state ──────────────────────────────────────────
const nodeStartedAt = Date.now();
// ─── Main Server ─────────────────────────────────────────────────
async function startDashboard(port = 8080, host = '0.0.0.0') {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // CORS for any local tools
    app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        if (_req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });
    // ─── API: Full Node Status ──────────────────────────────────
    app.get('/api/node/status', async (_req, res) => {
        const wallet = (0, manager_js_1.getWallet)();
        let balance = null;
        try {
            balance = wallet ? await (0, manager_js_1.getBalance)() : null;
        }
        catch (_e) { }
        const cpuInfo = (0, os_1.cpus)();
        const gpu = detectGpu();
        const disk = getDiskUsage();
        const load = (0, os_1.loadavg)();
        res.json({
            node: {
                name: process.env.NODE_NAME || (0, os_1.hostname)(),
                platform: (0, os_1.platform)(),
                arch: (0, os_1.arch)(),
                uptime: process.uptime(),
                os_uptime: (0, os_1.uptime)(),
                version: '3.4.0',
                started_at: new Date(nodeStartedAt).toISOString(),
                ip: getLocalIP(),
                node_env: process.env.NODE_ENV || 'production',
                pid: process.pid,
            },
            hardware: {
                cpu: {
                    model: cpuInfo[0]?.model || 'Unknown',
                    cores: cpuInfo.length,
                    usage: currentCpuUsage,
                    load_1m: Math.round(load[0] * 100) / 100,
                    load_5m: Math.round(load[1] * 100) / 100,
                    load_15m: Math.round(load[2] * 100) / 100,
                },
                ram: {
                    total: (0, os_1.totalmem)(),
                    free: (0, os_1.freemem)(),
                    used: (0, os_1.totalmem)() - (0, os_1.freemem)(),
                    usage: Math.round((((0, os_1.totalmem)() - (0, os_1.freemem)()) / (0, os_1.totalmem)()) * 100),
                },
                gpu,
                disk,
            },
            wallet: wallet ? {
                address: wallet.address,
                balance,
            } : null,
            swarm: {
                enabled: process.env.SWARM_ENABLED !== 'false',
                status: 'connected',
                mode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
            },
            gateway: {
                port: process.env.GSTD_GATEWAY_PORT || 18789,
                api_port: port,
            },
        });
    });
    // ─── API: Earnings ──────────────────────────────────────────
    app.get('/api/node/earnings', async (_req, res) => {
        const wallet = (0, manager_js_1.getWallet)();
        if (!wallet) {
            res.json({ earnings: [], total: 0 });
            return;
        }
        try {
            const resp = await fetch(`https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/earnings`).catch(() => null);
            if (resp?.ok) {
                res.json(await resp.json());
                return;
            }
        }
        catch (_e) { }
        res.json({ earnings: [], total: 0 });
    });
    // ─── API: Tasks ─────────────────────────────────────────────
    app.get('/api/node/tasks', async (_req, res) => {
        try {
            const resp = await fetch('https://app.gstdtoken.com/api/v1/monitor/unified').catch(() => null);
            if (resp?.ok) {
                const data = await resp.json();
                res.json({
                    pending: data.ecosystem?.tasks_pending || 0,
                    completed: data.ecosystem?.tasks_completed || 0,
                    processing: data.ecosystem?.tasks_processing || 0,
                });
                return;
            }
        }
        catch (_e) { }
        res.json({ pending: 0, completed: 0, processing: 0 });
    });
    // ─── API: Activity Log ──────────────────────────────────────
    app.get('/api/node/log', (_req, res) => {
        res.json({ entries: activityLog.slice(0, 100) });
    });
    // ─── API: Rewards & Tier Info ──────────────────────────────
    app.get('/api/node/rewards', async (_req, res) => {
        const wallet = (0, manager_js_1.getWallet)();
        if (!wallet) {
            res.json({ registered: false, message: 'No wallet found' });
            return;
        }
        try {
            // Get personal rewards info
            const rewardsResp = await fetch(`https://api.gstdtoken.com/api/v1/nodes/rewards/my?wallet=${wallet.address}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
            let rewards = { registered: false };
            if (rewardsResp?.ok) {
                rewards = await rewardsResp.json();
            }
            // Get network stats
            const networkResp = await fetch('https://api.gstdtoken.com/api/v1/nodes/rewards/network', { signal: AbortSignal.timeout(5000) }).catch(() => null);
            let network = {};
            if (networkResp?.ok) {
                network = await networkResp.json();
            }
            // Get leaderboard position
            const leaderResp = await fetch('https://api.gstdtoken.com/api/v1/nodes/rewards/leaderboard', { signal: AbortSignal.timeout(5000) }).catch(() => null);
            let leaderboard = [];
            let myRank = 0;
            if (leaderResp?.ok) {
                const data = await leaderResp.json();
                leaderboard = (data.leaderboard || []).slice(0, 10);
                // Find my rank
                const fullLeader = data.leaderboard || [];
                const myNode = fullLeader.find((n) => wallet.address?.includes(n.node?.replace('...', '')));
                if (myNode)
                    myRank = myNode.rank;
            }
            res.json({
                ...rewards,
                network,
                leaderboard,
                my_rank: myRank,
                wallet_address: wallet.address,
            });
        }
        catch (_e) {
            res.json({ registered: false, error: 'Failed to fetch rewards info' });
        }
    });
    // ─── API: Reward Program Details ─────────────────────────
    app.get('/api/node/program', async (_req, res) => {
        try {
            const resp = await fetch('https://api.gstdtoken.com/api/v1/nodes/rewards/program', { signal: AbortSignal.timeout(5000) }).catch(() => null);
            if (resp?.ok) {
                res.json(await resp.json());
                return;
            }
        }
        catch (_e) { }
        // Fallback hardcoded program
        res.json({
            tiers: [
                { name: 'bronze', min_hours: 0, multiplier: 1.0, base_per_hour: 0.5 },
                { name: 'silver', min_hours: 100, multiplier: 1.5, base_per_hour: 0.75 },
                { name: 'gold', min_hours: 500, multiplier: 2.0, base_per_hour: 1.0 },
                { name: 'platinum', min_hours: 2000, multiplier: 3.0, base_per_hour: 1.5 },
                { name: 'diamond', min_hours: 5000, multiplier: 5.0, base_per_hour: 2.5 },
            ],
            streak_bonuses: [
                { days: 7, bonus_percent: 10 },
                { days: 30, bonus_percent: 25 },
                { days: 90, bonus_percent: 50 },
                { days: 365, bonus_percent: 100 },
            ],
        });
    });
    // ─── API: Node Control ──────────────────────────────────────
    app.post('/api/node/control', async (req, res) => {
        const { action } = req.body || {};
        logActivity(`Control command: ${action}`, 'warn');
        switch (action) {
            case 'restart':
                logActivity('Node restart initiated...', 'warn');
                res.json({ ok: true, message: 'Restarting node...' });
                setTimeout(() => process.exit(0), 1000); // PM2/systemd will restart
                break;
            case 'update':
                try {
                    const { execSync } = require('child_process');
                    const cwd = (0, path_1.join)(__dirname, '../..');
                    logActivity('Pulling latest from GitHub...', 'info');
                    execSync('git pull', { cwd, encoding: 'utf-8', timeout: 30000 });
                    logActivity('Building project (npx tsc)...', 'info');
                    execSync('npx tsc', { cwd, encoding: 'utf-8', timeout: 60000 });
                    logActivity('Update complete! Restart to apply.', 'success');
                    res.json({ ok: true, message: 'Updated. Restart to apply changes.' });
                }
                catch (e) {
                    logActivity('Update failed: ' + e.message, 'error');
                    res.json({ ok: false, message: 'Update failed: ' + e.message });
                }
                break;
            case 'gc':
                if (global.gc) {
                    global.gc();
                    logActivity('Garbage collection completed.', 'success');
                    res.json({ ok: true, message: 'GC completed.' });
                }
                else {
                    res.json({ ok: false, message: 'GC not available (run with --expose-gc).' });
                }
                break;
            default:
                res.json({ ok: false, message: `Unknown action: ${action}` });
        }
    });
    // ─── API: Health ────────────────────────────────────────────
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', version: '3.0.0', uptime: process.uptime() });
    });
    // ─── Dashboard UI ───────────────────────────────────────────
    // Serve the dashboard.html from web/ if it exists, otherwise inline
    app.get('/', (_req, res) => {
        const htmlPath = (0, path_1.join)(__dirname, '../../web/dashboard.html');
        if ((0, fs_1.existsSync)(htmlPath)) {
            res.sendFile(htmlPath);
        }
        else {
            res.send(getFallbackHTML());
        }
    });
    // Serve static files from web/
    app.use('/static', express_1.default.static((0, path_1.join)(__dirname, '../../web')));
    // Start
    app.listen(port, host, () => {
        logActivity(`Dashboard started on http://${host}:${port}`);
        console.log(`  📊 Dashboard: http://${host === '0.0.0.0' ? getLocalIP() : host}:${port}`);
    });
}
function getFallbackHTML() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GSTD Node</title></head>
<body style="font-family:sans-serif;background:#030014;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;"><h1>🐝 GSTD Node Online</h1><p>Dashboard UI not found. Check web/dashboard.html</p>
<p><a href="/api/node/status" style="color:#06b6d4;">View API Status →</a></p></div></body></html>`;
}
//# sourceMappingURL=server.js.map