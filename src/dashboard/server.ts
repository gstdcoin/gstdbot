/**
 * GSTD Node — Dashboard Server
 * Full local web dashboard for node operators to monitor and manage their node.
 * Runs on the operator's own hardware alongside the gateway.
 */

import express from 'express';
import { cpus, totalmem, freemem, hostname, platform, arch, loadavg, uptime as osUptime, networkInterfaces } from 'os';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getWallet, getBalance } from '../wallet/manager.js';

export interface DashboardConfig {
    host: string;
    port: number;
    enabled: boolean;
}

// ─── CPU Tracking ────────────────────────────────────────────────
let prevCpuIdle = 0;
let prevCpuTotal = 0;
let currentCpuUsage = 0;

function updateCpuUsage(): void {
    const cpuInfo = cpus();
    let idle = 0, total = 0;
    cpuInfo.forEach(cpu => {
        for (const type in cpu.times) {
            total += (cpu.times as any)[type];
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

// ─── GPU Detection ───────────────────────────────────────────────
interface GpuInfo {
    detected: boolean;
    model?: string;
    memory?: string;
    temperature?: string;
    usage?: string;
}

function detectGpu(): GpuInfo {
    try {
        const { execSync } = require('child_process');
        const output = execSync(
            'nvidia-smi --query-gpu=name,memory.total,temperature.gpu,utilization.gpu --format=csv,noheader,nounits 2>/dev/null',
            { encoding: 'utf-8', timeout: 3000 }
        );
        const parts = output.trim().split(',').map((s: string) => s.trim());
        return {
            detected: true,
            model: parts[0] || 'Unknown',
            memory: parts[1] ? parts[1] + ' MiB' : undefined,
            temperature: parts[2] ? parts[2] + '°C' : undefined,
            usage: parts[3] ? parts[3] + '%' : undefined,
        };
    } catch {
        return { detected: false };
    }
}

// ─── Disk Usage ──────────────────────────────────────────────────
interface DiskInfo {
    total: number;
    used: number;
    available: number;
    usage: number;
}

function getDiskUsage(): DiskInfo {
    try {
        const { execSync } = require('child_process');
        const output = execSync("df -B1 / | tail -1", { encoding: 'utf-8', timeout: 3000 });
        const parts = output.trim().split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const available = parseInt(parts[3]) || 0;
        return { total, used, available, usage: total > 0 ? Math.round(used / total * 100) : 0 };
    } catch {
        return { total: 0, used: 0, available: 0, usage: 0 };
    }
}

// ─── Network Info ────────────────────────────────────────────────
function getLocalIP(): string {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return '127.0.0.1';
}

// ─── Activity Log ────────────────────────────────────────────────
const activityLog: { ts: string; msg: string; type: string }[] = [];
const MAX_LOG = 200;

export function logActivity(msg: string, type: string = 'info'): void {
    activityLog.unshift({ ts: new Date().toISOString(), msg, type });
    if (activityLog.length > MAX_LOG) activityLog.length = MAX_LOG;
}

// ─── Node process state ──────────────────────────────────────────
let nodeStartedAt = Date.now();

// ─── Main Server ─────────────────────────────────────────────────
export async function startDashboard(port: number = 8080, host: string = '0.0.0.0'): Promise<void> {
    const app = express();
    app.use(express.json());

    // CORS for any local tools
    app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
        next();
    });

    // ─── API: Full Node Status ──────────────────────────────────
    app.get('/api/node/status', async (_req, res) => {
        const wallet = getWallet();
        let balance = null;
        try { balance = wallet ? await getBalance() : null; } catch { }
        const cpuInfo = cpus();
        const gpu = detectGpu();
        const disk = getDiskUsage();
        const load = loadavg();

        res.json({
            node: {
                name: process.env.NODE_NAME || hostname(),
                platform: platform(),
                arch: arch(),
                uptime: process.uptime(),
                os_uptime: osUptime(),
                version: '3.2.0',
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
                    total: totalmem(),
                    free: freemem(),
                    used: totalmem() - freemem(),
                    usage: Math.round(((totalmem() - freemem()) / totalmem()) * 100),
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
        const wallet = getWallet();
        if (!wallet) { res.json({ earnings: [], total: 0 }); return; }
        try {
            const resp = await fetch(
                `https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/earnings`
            ).catch(() => null);
            if (resp?.ok) { res.json(await resp.json()); return; }
        } catch { }
        res.json({ earnings: [], total: 0 });
    });

    // ─── API: Tasks ─────────────────────────────────────────────
    app.get('/api/node/tasks', async (_req, res) => {
        try {
            const resp = await fetch('https://app.gstdtoken.com/api/v1/monitor/unified').catch(() => null);
            if (resp?.ok) {
                const data: any = await resp.json();
                res.json({
                    pending: data.ecosystem?.tasks_pending || 0,
                    completed: data.ecosystem?.tasks_completed || 0,
                    processing: data.ecosystem?.tasks_processing || 0,
                });
                return;
            }
        } catch { }
        res.json({ pending: 0, completed: 0, processing: 0 });
    });

    // ─── API: Activity Log ──────────────────────────────────────
    app.get('/api/node/log', (_req, res) => {
        res.json({ entries: activityLog.slice(0, 100) });
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
                    const cwd = join(__dirname, '../..');
                    logActivity('Pulling latest from GitHub...', 'info');
                    execSync('git pull', { cwd, encoding: 'utf-8', timeout: 30000 });
                    logActivity('Building project (npx tsc)...', 'info');
                    execSync('npx tsc', { cwd, encoding: 'utf-8', timeout: 60000 });
                    logActivity('Update complete! Restart to apply.', 'success');
                    res.json({ ok: true, message: 'Updated. Restart to apply changes.' });
                } catch (e: any) {
                    logActivity('Update failed: ' + e.message, 'error');
                    res.json({ ok: false, message: 'Update failed: ' + e.message });
                }
                break;
            case 'gc':
                if (global.gc) {
                    global.gc();
                    logActivity('Garbage collection completed.', 'success');
                    res.json({ ok: true, message: 'GC completed.' });
                } else {
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
        const htmlPath = join(__dirname, '../../web/dashboard.html');
        if (existsSync(htmlPath)) {
            res.sendFile(htmlPath);
        } else {
            res.send(getFallbackHTML());
        }
    });

    // Serve static files from web/
    app.use('/static', express.static(join(__dirname, '../../web')));

    // Start
    app.listen(port, host, () => {
        logActivity(`Dashboard started on http://${host}:${port}`);
        console.log(`  📊 Dashboard: http://${host === '0.0.0.0' ? getLocalIP() : host}:${port}`);
    });
}

function getFallbackHTML(): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GSTD Node</title></head>
<body style="font-family:sans-serif;background:#030014;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;"><h1>🐝 GSTD Node Online</h1><p>Dashboard UI not found. Check web/dashboard.html</p>
<p><a href="/api/node/status" style="color:#06b6d4;">View API Status →</a></p></div></body></html>`;
}
