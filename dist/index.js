"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const server_js_1 = require("./gateway/server.js");
const telegram_js_1 = require("./channels/telegram.js");
const agent_js_1 = require("./swarm/agent.js");
const collective_js_1 = require("./memory/collective.js");
const manager_js_1 = require("./wallet/manager.js");
const token_js_1 = require("./blockchain/token.js");
const remote_js_1 = require("./network/remote.js");
const resources_js_1 = require("./network/resources.js");
const federated_js_1 = require("./training/federated.js");
const os_1 = require("os");
const fs_1 = require("fs");
const path_1 = require("path");
const os_2 = require("os");
function loadConfig() {
    const configPath = (0, path_1.join)((0, os_2.homedir)(), '.config', 'gstdbot', 'config.json');
    const defaults = {
        version: '3.2.0',
        mode: 'cloud',
        nodeId: process.env.GSTD_NODE_ID || `node-${Date.now()}`,
        nodeName: process.env.NODE_NAME || `${(0, os_1.hostname)()}-node`,
        installDir: process.env.GSTD_INSTALL_DIR || (0, path_1.join)((0, os_2.homedir)(), 'gstdbot'),
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
            dataDir: (0, path_1.join)((0, os_2.homedir)(), '.config', 'gstdbot', 'apps'),
        },
    };
    if ((0, fs_1.existsSync)(configPath)) {
        try {
            const file = JSON.parse((0, fs_1.readFileSync)(configPath, 'utf-8'));
            return {
                ...defaults, ...file,
                swarm: { ...defaults.swarm, ...file.swarm },
                dashboard: { ...defaults.dashboard, ...file.dashboard },
                memory: { ...defaults.memory, ...file.memory },
                apps: { ...defaults.apps, ...file.apps },
            };
        }
        catch { }
    }
    return defaults;
}
// ─── Main ────────────────────────────────────────────────────────
async function main() {
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
    const gateway = new server_js_1.OmegaGateway({
        apiPort: parseInt(process.env.GSTD_API_PORT || '8080'),
        swarmUrl: process.env.GSTD_SWARM_URL || process.env.OLLAMA_URL || 'http://localhost:11434',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
    });
    await gateway.start();
    // ── 2. Blockchain Manager (GSTD Wallet + Staking) ───────────
    console.log(`  [2/${TOTAL_STEPS}] Initializing blockchain...`);
    const blockchain = new token_js_1.BlockchainManager();
    await blockchain.init();
    // ── 3. Wallet Manager (Earnings Tracker) ────────────────────
    console.log(`  [3/${TOTAL_STEPS}] Starting wallet manager...`);
    const wallet = new manager_js_1.NodeWallet(config);
    await wallet.init();
    // Connect wallet to gateway → every query earns GSTD
    gateway.setWallet(wallet);
    // Auto-save earnings every 5 minutes
    setInterval(() => { try {
        wallet.saveEarnings();
    }
    catch { } }, 5 * 60 * 1000);
    // ── 4. Collective Memory ────────────────────────────────────
    console.log(`  [4/${TOTAL_STEPS}] Connecting collective memory...`);
    const memory = new collective_js_1.CollectiveMemory(config);
    await memory.init();
    // ── 5. Swarm Agent (P2P + Task Processing) ──────────────────
    console.log(`  [5/${TOTAL_STEPS}] Joining swarm network...`);
    const swarm = new agent_js_1.SwarmAgent(config, wallet, memory);
    await swarm.start();
    // ── 6. Resource Sharing ─────────────────────────────────────
    console.log(`  [6/${TOTAL_STEPS}] Enabling resource sharing...`);
    const resources = new resources_js_1.ResourceSharing(config);
    await resources.init();
    // ── 7. Federated Training ───────────────────────────────────
    console.log(`  [7/${TOTAL_STEPS}] Initializing training engine...`);
    const trainer = new federated_js_1.SwarmTrainer(config);
    await trainer.init();
    // ── 8. Remote Access + Channels ─────────────────────────────
    console.log(`  [8/${TOTAL_STEPS}] Setting up remote access...`);
    const remote = new remote_js_1.RemoteAccessManager(config.nodeId);
    await remote.init();
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
        const telegram = new telegram_js_1.TelegramChannel({
            botToken: telegramToken,
            swarmUrl: process.env.GSTD_SWARM_URL || 'http://localhost:11434',
            cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
            adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').filter(Boolean).map(Number),
            communityChat: process.env.TELEGRAM_COMMUNITY_CHAT ? parseInt(process.env.TELEGRAM_COMMUNITY_CHAT) : undefined,
        });
        await telegram.start();
    }
    else {
        console.log('    Telegram: disabled (no token)');
    }
    // ── 9. Node OS ready (Dashboard served via Gateway) ──────────
    console.log(`  [9/${TOTAL_STEPS}] Node OS UI active on gateway port...`);
    // Inject all subsystems into gateway for full status reporting
    gateway.setSubsystems({
        memory,
        trainer,
        resources,
        swarm,
        blockchain,
    });
    // ── Boot complete ───────────────────────────────────────────
    const bootTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const accessInfo = remote.getAccessInfo();
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════╗');
    console.log('  ║          🐝 GSTD Node OS — Ready!                ║');
    console.log('  ╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('  ✅ Boot time: ' + bootTime + 's');
    console.log('');
    console.log('  📊 Dashboard:   http://localhost:' + config.dashboard.port);
    if (accessInfo.methods.relay?.status === 'connected') {
        console.log('  🌐 Remote:      ' + accessInfo.methods.relay.url);
    }
    if (accessInfo.methods.tor?.onion) {
        console.log('  🧅 Tor:         http://' + accessInfo.methods.tor.onion);
    }
    console.log('  🐝 Swarm:       ' + (swarm.isConnected() ? 'connected' : 'standalone'));
    console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'not configured'));
    console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 (local)'));
    console.log('  📦 Resources:   sharing enabled');
    console.log('  🎓 Training:    ' + (trainer.getStats().activeJobs > 0 ? 'active' : 'ready'));
    console.log('');
    console.log('  ⚡ No external websites needed — everything is in your node!');
    console.log('  ⚡ More nodes = stronger swarm + collective memory');
    console.log('  ⚡ GSTD token = key to all platform functions');
    console.log('');
    (0, server_js_1.logActivity)('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');
    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log('\n  🛑 Shutting down GSTD Node OS...');
        (0, server_js_1.logActivity)('Node shutdown initiated', 'warn');
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
//# sourceMappingURL=index.js.map