/**
 * GSTD Node OS — Main Orchestrator (gstdd)
 *
 * ═══════════════════════════════════════════════════════
 * Your node is a fully self-contained AI platform:
 * - No external websites needed — everything is built-in
 * - Connect from any device, anywhere (LAN/Relay/Tor)
 * - More nodes = stronger swarm + collective memory
 * - Earn GSTD tokens for sharing resources
 * - GSTD token = key to all platform functions
 * ═══════════════════════════════════════════════════════
 *
 * Boot sequence:
 *  1. AI Gateway (Groq + Ollama)
 *  2. Blockchain Manager (GSTD wallet + staking)
 *  3. Collective Memory (L1 Map + L2 Redis + L3 Platform)
 *  4. Swarm Agent (P2P task processing + earnings)
 *  5. Resource Sharing (sell compute/GPU for GSTD)
 *  6. Federated Training (distributed model training)
 *  7. Remote Access (token auth + relay + Tor)
 *  8. Telegram Channel
 *  9. Dashboard (all-in-one control panel on :8080)
 */

import { OmegaGateway, logActivity } from './gateway/server.js';
import { SecurityHardening } from './security/hardening.js';
import { SwarmOrchestrator } from './swarm/orchestrator.js';
import { TelegramChannel } from './channels/telegram.js';
import { SwarmAgent } from './swarm/agent.js';
import { CollectiveMemory } from './memory/collective.js';
import { NodeWallet } from './wallet/manager.js';
import { AppManager } from './apps/manager.js';
import { BlockchainManager } from './blockchain/token.js';
import { RemoteAccessManager } from './network/remote.js';
import { ResourceSharing } from './network/resources.js';
import { SwarmTrainer } from './training/federated.js';
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
        version: '3.3.0',
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
            return {
                ...defaults, ...file,
                swarm: { ...defaults.swarm, ...file.swarm },
                dashboard: { ...defaults.dashboard, ...file.dashboard },
                memory: { ...defaults.memory, ...file.memory },
                apps: { ...defaults.apps, ...file.apps },
            };
        } catch { }
    }
    return defaults;
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const config = loadConfig();
    const startTime = Date.now();
    const TOTAL_STEPS = 9;

    console.log('');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log('  🐝  GSTD Node OS v' + config.version);
    console.log('  🐝  ' + config.nodeName + ' (' + config.mode + ' mode)');
    console.log('  🐝  All-in-one: AI + Swarm + Memory + Wallet + Apps');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log('');

    // ── 1. Start Gateway (API + AI Engine) ──────────────────────
    console.log(`  [1/${TOTAL_STEPS}] Starting AI Gateway...`);
    const desiredPort = parseInt(process.env.GSTD_DASHBOARD_PORT || process.env.GSTD_API_PORT || '8080');
    const gateway = new OmegaGateway({
        apiPort: desiredPort,
        swarmUrl: process.env.GSTD_SWARM_URL || process.env.OLLAMA_URL || 'http://localhost:11434',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
    });
    await gateway.start();
    const actualPort = gateway.getPort();

    // ── 2. Blockchain Manager (GSTD Wallet + Staking) ───────────
    console.log(`  [2/${TOTAL_STEPS}] Initializing blockchain...`);
    const blockchain = new BlockchainManager();
    await blockchain.init();

    // ── 3. Wallet Manager (Earnings Tracker) ────────────────────
    console.log(`  [3/${TOTAL_STEPS}] Starting wallet manager...`);
    const wallet = new NodeWallet(config);
    await wallet.init();

    // Connect wallet to gateway → every query earns GSTD
    gateway.setWallet(wallet);

    // Auto-save earnings every 5 minutes
    setInterval(() => { try { wallet.saveEarnings(); } catch {} }, 5 * 60 * 1000);

    // ── 4. Collective Memory ────────────────────────────────────
    console.log(`  [4/${TOTAL_STEPS}] Connecting collective memory...`);
    const memory = new CollectiveMemory(config);
    await memory.init();

    // ── 5. Swarm Agent (P2P + Task Processing) ──────────────────
    console.log(`  [5/${TOTAL_STEPS}] Joining swarm network...`);
    const swarm = new SwarmAgent(config, wallet, memory);
    await swarm.start();

    // ── 6. Resource Sharing ─────────────────────────────────────
    console.log(`  [6/${TOTAL_STEPS}] Enabling resource sharing...`);
    const resources = new ResourceSharing(config);
    await resources.init();

    // ── 7. Federated Training ───────────────────────────────────
    console.log(`  [7/${TOTAL_STEPS}] Initializing training engine...`);
    const trainer = new SwarmTrainer(config);
    await trainer.init();

    // ── 8. Remote Access + Channels ─────────────────────────────
    console.log(`  [8/${TOTAL_STEPS}] Setting up remote access...`);
    const remote = new RemoteAccessManager(config.nodeId);
    await remote.init();

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
        console.log('    Telegram: disabled (no token)');
    }

    // ── 9. Node OS ready (Dashboard served via Gateway) ──────────
    console.log(`  [9/${TOTAL_STEPS}] Node OS UI active on gateway port...`);

    // Initialize security and orchestrator
    const security = new SecurityHardening();
    const orchestrator = new SwarmOrchestrator(config);
    await orchestrator.init().catch(() => {});

    // Inject all subsystems into gateway for full status reporting
    gateway.setSubsystems({
        memory,
        trainer,
        resources,
        swarm,
        blockchain,
        security,
        orchestrator,
    });

    // ── Boot complete ───────────────────────────────────────────
    const bootTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const accessInfo = remote.getAccessInfo();
    const dashPort = actualPort;

    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════╗');
    console.log('  ║      🐝 GSTD Node OS — Ready! (' + bootTime + 's)             ║');
    console.log('  ╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('  👉 Open in your browser:');
    console.log('     http://localhost:' + dashPort);
    console.log('');
    if (accessInfo.methods.relay?.status === 'connected') {
        console.log('  🌐 Remote:      ' + accessInfo.methods.relay.url);
    }
    if (accessInfo.methods.tor?.onion) {
        console.log('  🧅 Tor:         http://' + accessInfo.methods.tor.onion);
    }
    console.log('  🐝 Swarm:       ' + (swarm.isConnected() ? '✓ connected to network' : 'standalone (will auto-connect)'));
    console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'auto-generated'));
    console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'full (L1+L2+L3)' : 'local (L1) — Redis optional'));
    console.log('  📦 Resources:   sharing enabled');
    console.log('  🎓 Training:    ' + (trainer.getStats().activeJobs > 0 ? 'active' : 'ready'));
    console.log('');
    console.log('  💡 Tips:');
    console.log('     • Your node earns GSTD tokens automatically while running');
    console.log('     • Open the dashboard to chat with 8 free AI models');
    console.log('     • To stop: press Ctrl+C');
    console.log('');

    logActivity('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');

    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log('\n  🛑 Shutting down GSTD Node OS...');
        logActivity('Node shutdown initiated', 'warn');
        await trainer.stop();
        await resources.stop();
        await remote.stop();
        await swarm.stop();
        await memory.close();
        await blockchain.close();
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
