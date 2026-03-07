/**
 * GSTD Node OS — Main Orchestrator (gstdd)
 * 
 * Core daemon that manages all node services:
 * - Swarm Agent (P2P task processing)
 * - Collective Memory (distributed knowledge)
 * - Wallet & Earnings (GSTD tokens)
 * - AI Engine (Groq + Ollama)
 * - Dashboard (Web UI on :8080)
 * - App Manager (Docker-based apps)
 */

import { OmegaGateway } from './gateway/server.js';
import { TelegramChannel } from './channels/telegram.js';
import { startDashboard, logActivity } from './dashboard/server.js';
import { SwarmAgent } from './swarm/agent.js';
import { CollectiveMemory } from './memory/collective.js';
import { NodeWallet } from './wallet/manager.js';
import { AppManager } from './apps/manager.js';
import { hostname, cpus, totalmem, platform, arch } from 'os';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Node Configuration ─────────────────────────────────────────
export interface NodeConfig {
    version: string;
    mode: 'cloud' | 'hybrid' | 'sovereign';
    nodeId: string;
    nodeName: string;
    installDir: string;
    swarm: { enabled: boolean; maxCPU: number; maxRAM: number; apiUrl: string };
    dashboard: { host: string; port: number; enabled: boolean };
    groq: { models: string[] };
    memory: { redisUrl: string; chromaUrl: string; enabled: boolean };
    apps: { enabled: boolean; dataDir: string };
}

function loadConfig(): NodeConfig {
    const configPath = join(homedir(), '.config', 'gstdbot', 'config.json');
    const defaults: NodeConfig = {
        version: '3.1.0',
        mode: 'cloud',
        nodeId: process.env.GSTD_NODE_ID || `node-${Date.now()}`,
        nodeName: process.env.NODE_NAME || `${hostname()}-node`,
        installDir: process.env.GSTD_INSTALL_DIR || join(homedir(), 'gstdbot'),
        swarm: {
            enabled: process.env.SWARM_ENABLED !== 'false',
            maxCPU: parseInt(process.env.GSTD_MAX_CPU || '80'),
            maxRAM: parseInt(process.env.GSTD_MAX_RAM || '70'),
            apiUrl: process.env.GSTD_API_URL || 'https://app.gstdtoken.com/api/v1',
        },
        dashboard: {
            host: '0.0.0.0',
            port: parseInt(process.env.GSTD_DASHBOARD_PORT || '8080'),
            enabled: process.env.GSTD_DASHBOARD !== 'false',
        },
        groq: {
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'moonshotai/kimi-k2-instruct'],
        },
        memory: {
            redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
            chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
            enabled: process.env.GSTD_MEMORY !== 'false',
        },
        apps: {
            enabled: process.env.GSTD_APPS !== 'false',
            dataDir: join(homedir(), '.config', 'gstdbot', 'apps'),
        },
    };

    if (existsSync(configPath)) {
        try {
            const file = JSON.parse(readFileSync(configPath, 'utf-8'));
            return { ...defaults, ...file, swarm: { ...defaults.swarm, ...file.swarm }, dashboard: { ...defaults.dashboard, ...file.dashboard }, memory: { ...defaults.memory, ...file.memory }, apps: { ...defaults.apps, ...file.apps } };
        } catch { }
    }
    return defaults;
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const config = loadConfig();
    const startTime = Date.now();

    console.log('');
    console.log('  🐝 ═══════════════════════════════════════════');
    console.log('  🐝  GSTD Node OS v' + config.version);
    console.log('  🐝  ' + config.nodeName + ' (' + config.mode + ' mode)');
    console.log('  🐝 ═══════════════════════════════════════════');
    console.log('');

    // ── 1. Start Gateway (API + AI Engine) ──────────────────────
    console.log('  [1/6] Starting AI Gateway...');
    const gateway = new OmegaGateway({
        apiPort: parseInt(process.env.GSTD_API_PORT || '8080'),
        swarmUrl: process.env.GSTD_SWARM_URL || process.env.OLLAMA_URL || 'http://localhost:11434',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
    });
    await gateway.start();

    // ── 2. Start Wallet Manager ─────────────────────────────────
    console.log('  [2/6] Initializing wallet...');
    const wallet = new NodeWallet(config);
    await wallet.init();

    // ── 3. Start Collective Memory ──────────────────────────────
    console.log('  [3/6] Connecting collective memory...');
    const memory = new CollectiveMemory(config);
    await memory.init();

    // ── 4. Start Swarm Agent ────────────────────────────────────
    console.log('  [4/6] Joining swarm network...');
    const swarm = new SwarmAgent(config, wallet, memory);
    await swarm.start();

    // ── 5. Start Telegram Channel ───────────────────────────────
    console.log('  [5/6] Setting up channels...');
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
        const telegram = new TelegramChannel({
            botToken: telegramToken,
            swarmUrl: process.env.GSTD_SWARM_URL || 'http://localhost:11434',
            cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
            adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').filter(Boolean).map(Number),
            communityChat: process.env.TELEGRAM_COMMUNITY_CHAT ? parseInt(process.env.TELEGRAM_COMMUNITY_CHAT) : undefined,
        });
        await telegram.start();
    } else {
        console.log('    No TELEGRAM_BOT_TOKEN — Telegram disabled');
    }

    // ── 6. Start Dashboard ──────────────────────────────────────
    if (config.dashboard.enabled) {
        console.log('  [6/6] Starting dashboard...');
        await startDashboard(config.dashboard.port, config.dashboard.host);
    }

    // ── Boot complete ───────────────────────────────────────────
    const bootTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('  ✅ GSTD Node OS ready in ' + bootTime + 's');
    console.log('  📊 Dashboard: http://localhost:' + config.dashboard.port);
    console.log('  🌐 Swarm: ' + (swarm.isConnected() ? 'connected' : 'standalone'));
    console.log('  💰 Wallet: ' + (wallet.getAddress() || 'not configured'));
    console.log('  🧠 Memory: ' + (memory.isConnected() ? 'online' : 'local-only'));
    console.log('');

    logActivity('GSTD Node OS booted in ' + bootTime + 's', 'success');

    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log('\n  🛑 Shutting down GSTD Node OS...');
        logActivity('Node shutdown initiated', 'warn');
        await swarm.stop();
        await memory.close();
        await gateway.stop();
        console.log('  ✅ Clean shutdown complete.');
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('  ❌ Fatal error:', err);
    process.exit(1);
});
