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
const hardening_js_1 = require("./security/hardening.js");
const orchestrator_js_1 = require("./swarm/orchestrator.js");
const telegram_js_1 = require("./channels/telegram.js");
const agent_js_1 = require("./swarm/agent.js");
const collective_js_1 = require("./memory/collective.js");
const manager_js_1 = require("./wallet/manager.js");
const tonconnect_js_1 = require("./wallet/tonconnect.js");
const miniapp_js_1 = require("./channels/miniapp.js");
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
        version: '3.3.0',
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
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'moonshotai/kimi-k2-instruct'],
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
        tonconnect: {
            enabled: process.env.GSTD_TONCONNECT !== 'false',
            network: process.env.TON_NETWORK || 'mainnet',
            bridgeUrl: process.env.TON_BRIDGE_URL || 'https://connect.ton.org/bridge',
        },
        mobileNode: {
            enabled: process.env.GSTD_MOBILE_NODE !== 'false',
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
    const desiredPort = parseInt(process.env.GSTD_DASHBOARD_PORT || process.env.GSTD_API_PORT || '8080');
    const gateway = new server_js_1.OmegaGateway({
        apiPort: desiredPort,
        swarmUrl: process.env.GSTD_SWARM_URL || process.env.OLLAMA_URL || 'https://api.gstdtoken.com',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
    });
    await gateway.start();
    const actualPort = gateway.getPort();
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
            swarmUrl: process.env.GSTD_SWARM_URL || 'https://api.gstdtoken.com',
            cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
            adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').filter(Boolean).map(Number),
            communityChat: process.env.TELEGRAM_COMMUNITY_CHAT ? parseInt(process.env.TELEGRAM_COMMUNITY_CHAT) : undefined,
        });
        await telegram.start();
    }
    else {
        console.log('    Telegram: disabled (no token)');
    }
    // ── 9. TON Connect + Mobile Node ─────────────────────────────
    const TOTAL_STEPS_NEW = 11;
    console.log(`  [9/${TOTAL_STEPS_NEW}] Initializing TON Connect...`);
    const tonConnect = new tonconnect_js_1.TonConnectManager({
        network: config.tonconnect.network,
        bridgeUrl: config.tonconnect.bridgeUrl,
        gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
    });
    if (config.tonconnect.enabled) {
        // Try to load wallet mnemonic for signing
        const mnemonic = process.env.GSTD_WALLET_MNEMONIC?.split(' ');
        await tonConnect.init(mnemonic).catch(() => { });
    }
    else {
        console.log('    TON Connect: disabled (set GSTD_TONCONNECT=true)');
    }
    // ── 10. Mobile Node TMA ──────────────────────────────────────
    console.log(`  [10/${TOTAL_STEPS_NEW}] Enabling Mobile Node (TMA)...`);
    let mobileNode = null;
    if (config.mobileNode.enabled) {
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
        const apiUrl = process.env.GSTD_SWARM_URL || 'https://api.gstdtoken.com';
        mobileNode = new miniapp_js_1.MobileNodeManager({
            botToken: telegramToken,
            apiUrl: apiUrl.replace(/\/api\/v1$/, '') + '/api/v1',
            gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
        });
        mobileNode.registerRoutes(gateway.getExpressApp());
    }
    else {
        console.log('    Mobile Node: disabled');
    }
    // ── 11. Node OS ready (Dashboard served via Gateway) ─────────
    console.log(`  [11/${TOTAL_STEPS_NEW}] Node OS UI active on gateway port...`);
    // Initialize security and orchestrator
    const security = new hardening_js_1.SecurityHardening();
    const orchestrator = new orchestrator_js_1.SwarmOrchestrator(config);
    await orchestrator.init().catch(() => { });
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
    console.log('  🔗 TON Connect: ' + (tonConnect.isReady() ? '✓ ' + tonConnect.getAddress()?.slice(0, 12) + '...' : 'ready (no wallet)'));
    console.log('  📱 Mobile Node: ' + (mobileNode ? '✓ TMA enabled (/tma)' : 'disabled'));
    console.log('');
    console.log('  💡 Tips:');
    console.log('     • Your node earns GSTD tokens automatically while running');
    console.log('     • Open the dashboard to chat with 8 free AI models');
    console.log('     • Mobile users can run nodes via Telegram Mini App');
    console.log('     • To stop: press Ctrl+C');
    console.log('');
    (0, server_js_1.logActivity)('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');
    // ── Heartbeat: report to platform every 5 min ────────────────
    const PLATFORM_API = config.swarm.apiUrl || 'https://api.gstdtoken.com/api/v1';
    const walletAddr = wallet.getAddress() || '';
    const sendHeartbeat = async () => {
        try {
            const resp = await fetch(`${PLATFORM_API}/nodes/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet_address: walletAddr,
                    node_id: config.nodeId,
                    node_name: config.nodeName,
                    node_version: config.version,
                    status: 'online',
                    battery: 300,
                    signal: 100,
                    uptime_hours: Math.floor((Date.now() - startTime) / 3600000),
                    queries_served: 0,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.reward > 0) {
                    wallet.recordVerifiedEarning(data.reward, 'uptime', `Heartbeat reward`);
                }
            }
        }
        catch { /* silent — network may be unavailable */ }
    };
    // First heartbeat after 30s, then every 5 minutes
    setTimeout(sendHeartbeat, 30_000);
    const hbInterval = setInterval(sendHeartbeat, 5 * 60 * 1000);
    // ── Auto-update: check every hour ────────────────────────────
    const checkAndUpdate = async () => {
        try {
            const { execSync } = require('child_process');
            const installDir = config.installDir || (0, path_1.join)((0, os_2.homedir)(), 'gstdbot');
            // Fetch latest from GitHub
            execSync('git fetch origin main --quiet 2>/dev/null', { cwd: installDir, timeout: 30000 });
            // Compare local HEAD with remote
            const local = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            const remote = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            if (local !== remote) {
                (0, server_js_1.logActivity)('Update available — pulling from GitHub...', 'info');
                console.log('  🔄 Update detected. Pulling latest code...');
                // Pull and rebuild
                execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });
                execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
                (0, server_js_1.logActivity)('Update installed — restarting node...', 'success');
                console.log('  ✅ Update installed. Restarting...');
                // Systemd will restart us, or PM2, or the user manually
                process.exit(0);
            }
        }
        catch { /* silent — git may not be available in Docker */ }
    };
    // Check for updates after 2 min, then every hour
    setTimeout(checkAndUpdate, 2 * 60 * 1000);
    const updateInterval = setInterval(checkAndUpdate, 60 * 60 * 1000);
    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log('\n  🛑 Shutting down GSTD Node OS...');
        (0, server_js_1.logActivity)('Node shutdown initiated', 'warn');
        clearInterval(hbInterval);
        clearInterval(updateInterval);
        if (mobileNode)
            await mobileNode.stop();
        await tonConnect.close();
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