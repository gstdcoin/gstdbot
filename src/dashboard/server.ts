/**
 * GSTD Node — Dashboard Server
 * Local web dashboard for monitoring node status, earnings, and system health
 */

import express from 'express';
import { join } from 'path';
import { cpus, totalmem, freemem, hostname, platform, arch } from 'os';
import { getWallet, getBalance } from '../wallet/wallet.js';

export interface DashboardConfig {
    port: number;
    enabled: boolean;
}

export async function startDashboard(port: number = 8080): Promise<void> {
    const app = express();

    app.use(express.json());

    // ─── API Routes ──────────────────────────────────────────────

    // Node status
    app.get('/api/node/status', async (_req, res) => {
        const wallet = getWallet();
        const balance = wallet ? await getBalance() : null;
        const cpuInfo = cpus();

        res.json({
            node: {
                name: process.env.NODE_NAME || hostname(),
                platform: platform(),
                arch: arch(),
                uptime: process.uptime(),
                version: '2.0.0',
            },
            hardware: {
                cpu: {
                    model: cpuInfo[0]?.model || 'Unknown',
                    cores: cpuInfo.length,
                    usage: getCpuUsage(),
                },
                ram: {
                    total: totalmem(),
                    free: freemem(),
                    used: totalmem() - freemem(),
                    usage: Math.round(((totalmem() - freemem()) / totalmem()) * 100),
                },
                gpu: detectGpu(),
            },
            wallet: wallet ? {
                address: wallet.address,
                balance: balance,
            } : null,
            swarm: {
                enabled: process.env.SWARM_ENABLED !== 'false',
                status: 'connected',
            },
        });
    });

    // Earnings history
    app.get('/api/node/earnings', async (_req, res) => {
        const wallet = getWallet();
        if (!wallet) {
            res.json({ earnings: [], total: 0 });
            return;
        }

        try {
            const resp = await fetch(
                `https://app.gstdtoken.com/api/v1/wallet/${wallet.address}/earnings`
            ).catch(() => null);
            if (resp?.ok) {
                const data: any = await resp.json();
                res.json(data);
                return;
            }
        } catch { }

        res.json({ earnings: [], total: 0 });
    });

    // Tasks queue
    app.get('/api/node/tasks', async (_req, res) => {
        try {
            const resp = await fetch(
                'https://app.gstdtoken.com/api/v1/monitor/unified'
            ).catch(() => null);
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

    // Health check
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', version: '2.0.0' });
    });

    // ─── Dashboard UI ────────────────────────────────────────────
    app.get('/', (_req, res) => {
        res.send(getDashboardHTML());
    });

    // Start
    app.listen(port, () => {
        console.log(`  📊 Dashboard: http://localhost:${port}`);
    });
}

function getCpuUsage(): number {
    const cpuInfo = cpus();
    let totalIdle = 0, totalTick = 0;
    cpuInfo.forEach(cpu => {
        for (const type in cpu.times) {
            totalTick += (cpu.times as any)[type];
        }
        totalIdle += cpu.times.idle;
    });
    return Math.round(100 - (totalIdle / totalTick * 100));
}

function detectGpu(): { detected: boolean; model?: string } {
    try {
        const { execSync } = require('child_process');
        const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', { encoding: 'utf-8' });
        return { detected: true, model: output.trim() };
    } catch {
        return { detected: false };
    }
}

function getDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GSTD Node Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Inter',sans-serif;background:#030014;color:#e2e2e8;min-height:100vh}
        .container{max-width:1200px;margin:0 auto;padding:24px}
        h1{font-size:24px;font-weight:800;margin-bottom:24px;display:flex;align-items:center;gap:10px}
        h1 .tag{font-size:10px;padding:3px 8px;border-radius:4px;background:#22c55e;color:#030014;font-weight:700}
        .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
        .card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:24px}
        .card h3{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b6b80;margin-bottom:12px}
        .card .val{font-size:32px;font-weight:900;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .card .sub{font-size:12px;color:#6b6b80;margin-top:4px}
        .bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.06);margin-top:8px;overflow:hidden}
        .bar .fill{height:100%;border-radius:3px;transition:width 1s}
        .status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
        .status .dot{width:6px;height:6px;border-radius:50%;animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .log{font-family:'JetBrains Mono',monospace;font-size:11px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.04);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;color:#6b6b80}
    </style>
</head>
<body>
    <div class="container">
        <h1>🐝 GSTD Node <span class="tag">ONLINE</span></h1>
        <div class="grid" id="stats"></div>
        <div class="card" style="margin-bottom:16px"><h3>System</h3><div id="system"></div></div>
        <div class="card"><h3>Activity Log</h3><div class="log" id="log">Loading...</div></div>
    </div>
    <script>
    async function refresh(){
        try{
            const r=await fetch('/api/node/status');
            const d=await r.json();
            document.getElementById('stats').innerHTML=\`
                <div class="card"><h3>CPU Usage</h3><div class="val">\${d.hardware.cpu.usage}%</div><div class="sub">\${d.hardware.cpu.model} (\${d.hardware.cpu.cores} cores)</div><div class="bar"><div class="fill" style="width:\${d.hardware.cpu.usage}%;background:\${d.hardware.cpu.usage>80?'#f43f5e':'#22c55e'}"></div></div></div>
                <div class="card"><h3>RAM Usage</h3><div class="val">\${d.hardware.ram.usage}%</div><div class="sub">\${(d.hardware.ram.used/1073741824).toFixed(1)} / \${(d.hardware.ram.total/1073741824).toFixed(1)} GB</div><div class="bar"><div class="fill" style="width:\${d.hardware.ram.usage}%;background:\${d.hardware.ram.usage>80?'#f43f5e':'#06b6d4'}"></div></div></div>
                <div class="card"><h3>Wallet</h3><div class="val">\${d.wallet?d.wallet.balance.gstd.toFixed(1):0} GSTD</div><div class="sub">\${d.wallet?d.wallet.address.slice(0,12)+'...':'Not configured'}</div></div>
                <div class="card"><h3>Swarm</h3><div class="val"><span class="status"><span class="dot" style="background:#22c55e"></span> Connected</span></div><div class="sub">Node: \${d.node.name}</div></div>
            \`;
            document.getElementById('system').innerHTML=\`<div style="font-size:13px;color:#6b6b80">\${d.node.platform} \${d.node.arch} • Uptime: \${Math.round(d.node.uptime/60)}min • GPU: \${d.hardware.gpu.detected?d.hardware.gpu.model:'None'}</div>\`;
        }catch(e){document.getElementById('stats').innerHTML='<div class="card"><h3>Error</h3><div>Cannot reach node API</div></div>'}
    }
    refresh();setInterval(refresh,3000);
    document.getElementById('log').textContent='['+new Date().toISOString()+'] Dashboard started\\n['+new Date().toISOString()+'] Monitoring node status...';
    </script>
</body>
</html>`;
}
