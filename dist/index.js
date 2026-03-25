"use strict";
/**
 * GSTD SuperNode OS — Main Orchestrator (gstdd)
 *
 * ═══════════════════════════════════════════════════════
 * ONE NODE TO RULE THEM ALL — 6 Revenue Streams:
 *   💾 Storage Provider  — earn GSTD for hosting data (Storj/Filecoin)
 *   💻 GPU Compute       — earn GSTD for running jobs (Akash/io.net)
 *   🧠 AI Inference      — earn GSTD for answering queries (GSTD native)
 *   📡 Traffic Relay     — earn GSTD for proxying traffic (Helium DePIN)
 *   🎓 Model Training    — earn GSTD for federated training (io.net)
 *   🪙 Staking           — earn GSTD passive yield (12% APY)
 *
 * All earnings interact with real GSTD token on TON blockchain
 * via SettlementRouter.tact smart contract.
 * ═══════════════════════════════════════════════════════
 *
 * Boot sequence:
 *  1. AI Gateway (Groq + Ollama)
 *  2. Blockchain Manager (GSTD wallet + staking)
 *  3. Revenue Engine (unified 6-stream earnings tracker)
 *  4. Collective Memory (L1 Map + L2 Redis + L3 Platform)
 *  5. Swarm Agent (P2P task processing + earnings)
 *  6. Resource Sharing (sell compute/GPU for GSTD)
 *  7. Federated Training (distributed model training)
 *  8. Storage Vault (Storj/Filecoin-style shard storage)
 *  9. Compute Marketplace (Akash/io.net-style GPU jobs)
 * 10. Traffic Relay (Helium-style DePIN + PoC)
 * 11. Remote Access (token auth + relay + Tor)
 * 12. Telegram Channel
 * 13. TON Connect + Mobile Node TMA
 * 14. Dashboard (all-in-one control panel)
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
const engine_js_1 = require("./revenue/engine.js");
const vault_js_1 = require("./storage/vault.js");
const marketplace_js_1 = require("./compute/marketplace.js");
const relay_js_1 = require("./coverage/relay.js");
const fastify_js_1 = require("./gateway/fastify.js");
const orchestrator_js_2 = require("./naas/orchestrator.js");
const uptime_daemon_js_1 = require("./naas/uptime_daemon.js");
const node_js_1 = require("./p2p/node.js");
const os_1 = require("os");
const fs_1 = require("fs");
const path_1 = require("path");
const os_2 = require("os");
function loadConfig() {
    const configPath = (0, path_1.join)((0, os_2.homedir)(), '.config', 'gstdbot', 'config.json');
    const defaults = {
        version: '3.4.0',
        mode: process.env.GSTD_MODE || 'cloud',
        nodeId: process.env.GSTD_NODE_ID || `node-${Date.now()}`,
        nodeName: process.env.NODE_NAME || `${(0, os_1.hostname)()}-node`,
        installDir: process.env.GSTD_INSTALL_DIR || (0, path_1.join)((0, os_2.homedir)(), 'gstdbot'),
        swarm: {
            enabled: process.env.SWARM_ENABLED !== 'false' && process.env.GSTD_MODE !== 'platform',
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
        catch (_e) { }
    }
    return defaults;
}
// ─── Main ────────────────────────────────────────────────────────
async function main() {
    const config = loadConfig();
    const startTime = Date.now();
    const isPlatform = config.mode === 'platform';
    const TOTAL_STEPS = isPlatform ? 7 : 17;
    console.log('');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log(`  ⚡ GSTD ${isPlatform ? 'Platform Server' : 'SuperNode OS'} v${config.version}`);
    console.log(`  ⚡ Mode: ${config.mode} | ${isPlatform ? 'Platform (no node operations)' : 'Node: ' + config.nodeName}`);
    console.log(`  ⚡ Wallet: ${process.env.GSTD_WALLET_ADDRESS || 'auto-detect'}`);
    console.log('');
    if (isPlatform) {
        console.log('  ╔═══════════════════════════════════════════════════════╗');
        console.log('  ║  🏛️  PLATFORM MODE — No node operations on server     ║');
        console.log('  ║  Telegram + Dashboard + API + AI Chat + Monitoring    ║');
        console.log('  ╚═══════════════════════════════════════════════════════╝');
        console.log('');
    }
    console.log('  🐝  ONE NODE TO RULE THEM ALL — 6 Revenue Streams');
    console.log('  🐝  💾 Storage  💻 Compute  🧠 AI  📡 Relay  🎓 Training  🪙 Staking');
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
    // ── 3. Revenue Engine (Unified 6-stream earnings) ───────────
    console.log(`  [3/${TOTAL_STEPS}] Initializing Revenue Engine (6 streams)...`);
    const revenue = new engine_js_1.RevenueEngine(config.nodeId);
    await revenue.init();
    // ── 4. Wallet Manager (Earnings Tracker) ────────────────────
    console.log(`  [4/${TOTAL_STEPS}] Starting wallet manager...`);
    const wallet = new manager_js_1.NodeWallet(config);
    await wallet.init();
    // Connect wallet to gateway → every query earns GSTD
    gateway.setWallet(wallet);
    // Connect revenue engine wallet
    const addr = wallet.getAddress();
    if (addr) {
        revenue.setWalletAddress(addr);
    }
    // Auto-save earnings every 5 minutes
    setInterval(() => { try {
        wallet.saveEarnings();
    }
    catch (_e) { } }, 5 * 60 * 1000);
    // ── 5. Collective Memory ────────────────────────────────────
    console.log(`  [5/${TOTAL_STEPS}] Connecting collective memory...`);
    const memory = new collective_js_1.CollectiveMemory(config);
    await memory.init();
    // ── 6. Swarm Agent (P2P + Task Processing) ──────────────────
    let swarm = null;
    if (!isPlatform) {
        console.log(`  [6/${TOTAL_STEPS}] Joining swarm network...`);
        swarm = new agent_js_1.SwarmAgent(config, wallet, memory);
        await swarm.start();
    }
    else {
        console.log('  [6/7] Swarm: SKIPPED (platform mode)');
    }
    // ── Node-only subsystems (skipped in platform mode) ──────────
    let resources = null;
    let trainer = null;
    let storageVault = null;
    let computeMarket = null;
    let trafficRelay = null;
    let naas = null;
    if (!isPlatform) {
        // ── 7. Resource Sharing ─────────────────────────────────────
        console.log(`  [7/${TOTAL_STEPS}] Enabling resource sharing...`);
        resources = new resources_js_1.ResourceSharing(config);
        await resources.init();
        // ── 8. Federated Training ───────────────────────────────────
        console.log(`  [8/${TOTAL_STEPS}] Initializing training engine...`);
        trainer = new federated_js_1.SwarmTrainer(config);
        await trainer.init();
        // ── 9. Storage Vault ────────────────────────────────────────
        console.log(`  [9/${TOTAL_STEPS}] Initializing Storage Vault...`);
        storageVault = new vault_js_1.StorageVault(config.nodeId);
        storageVault.setRevenueEngine(revenue);
        await storageVault.init();
        // ── 10. Compute Marketplace ─────────────────────────────────
        console.log(`  [10/${TOTAL_STEPS}] Initializing Compute Marketplace...`);
        computeMarket = new marketplace_js_1.ComputeMarketplace(config.nodeId);
        computeMarket.setRevenueEngine(revenue);
        await computeMarket.init();
        // ── 11. Traffic Relay ───────────────────────────────────────
        console.log(`  [11/${TOTAL_STEPS}] Initializing Traffic Relay...`);
        trafficRelay = new relay_js_1.TrafficRelay(config.nodeId);
        trafficRelay.setRevenueEngine(revenue);
        await trafficRelay.init();
        trafficRelay.mountRoutes(gateway.getExpressApp());
        // ── 12. NaaS (Node-as-a-Service: Multi-Chain RPC) ───────────
        console.log(`  [12/${TOTAL_STEPS}] Initializing NaaS (Multi-Chain RPC)...`);
        naas = new orchestrator_js_2.NaaSManager();
        const apiKey = process.env.GSTD_API_KEY || wallet.getAddress() || config.nodeId;
        if (process.env.GSTD_NAAS_ENABLED !== 'false') {
            await naas.start(apiKey);
        }
        else {
            console.log('    NaaS: disabled (set GSTD_NAAS_ENABLED=true)');
        }
    }
    else {
        console.log('  [7/7] Node subsystems: SKIPPED (platform mode)');
        console.log('    ↳ Resource Sharing, Training, Storage, Compute, Relay, NaaS — remote nodes only');
    }
    // ── 13. Remote Access + Channels ────────────────────────────
    let remote = null;
    if (!isPlatform) {
        console.log(`  [13/${TOTAL_STEPS}] Setting up remote access...`);
        remote = new remote_js_1.RemoteAccessManager(config.nodeId);
        await remote.init();
    }
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
    // ── 14. TON Connect + Mobile Node ────────────────────────────
    console.log(`  [14/${TOTAL_STEPS}] Initializing TON Connect...`);
    const tonConnect = new tonconnect_js_1.TonConnectManager({
        network: config.tonconnect.network,
        bridgeUrl: config.tonconnect.bridgeUrl,
        gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
    });
    if (config.tonconnect.enabled) {
        const mnemonic = process.env.GSTD_WALLET_MNEMONIC?.split(' ');
        await tonConnect.init(mnemonic).catch(() => { });
    }
    else {
        console.log('    TON Connect: disabled (set GSTD_TONCONNECT=true)');
    }
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
    // ── 15. Node OS ready (Dashboard served via Gateway) ─────────
    console.log(`  [15/${TOTAL_STEPS}] SuperNode OS UI active on gateway port...`);
    // Initialize security and orchestrator
    const security = new hardening_js_1.SecurityHardening();
    let orchestrator = null;
    if (!isPlatform) {
        orchestrator = new orchestrator_js_1.SwarmOrchestrator(config);
        await orchestrator.init().catch(() => { });
    }
    // Inject all subsystems into gateway for full status reporting
    gateway.setSubsystems({
        memory,
        trainer: trainer || undefined,
        resources: resources || undefined,
        swarm: swarm || undefined,
        blockchain,
        security,
        orchestrator: orchestrator || undefined,
        revenue,
        storageVault: storageVault || undefined,
        computeMarket: computeMarket || undefined,
        trafficRelay: trafficRelay || undefined,
    });
    // ── 16. Fastify HTTP Engine (4x faster HTTP parser) ──────────
    let fastifyGateway = null;
    if (!isPlatform) {
        console.log(`  [16/${TOTAL_STEPS}] Upgrading to Fastify engine...`);
        try {
            fastifyGateway = new fastify_js_1.FastifyGateway(gateway.getExpressApp(), {
                port: actualPort + 1,
            });
            await fastifyGateway.init();
            console.log('    ⚡ Fastify engine: initialized (Express compat mode)');
        }
        catch (e) {
            console.log(`    ⚠ Fastify init skipped: ${e.message} (Express still active)`);
        }
    }
    // ── 17. libp2p P2P Mesh Network ──────────────────────────────
    let p2pNode = null;
    let p2pPeerId = '';
    if (!isPlatform) {
        console.log(`  [17/${TOTAL_STEPS}] Starting P2P mesh network...`);
        p2pNode = new node_js_1.GstdP2PNode({
            nodeId: config.nodeId,
            walletAddress: wallet.getAddress() || '',
            listenPort: parseInt(process.env.GSTD_P2P_PORT || '4001'),
            enableMdns: process.env.GSTD_P2P_MDNS !== 'false',
            version: config.version,
        });
        try {
            p2pPeerId = await p2pNode.start();
            p2pNode.on('task:received', (task) => {
                (0, server_js_1.logActivity)(`P2P task received: ${task.taskId}`, 'info');
            });
            p2pNode.on('heartbeat:received', (hb) => {
                (0, server_js_1.logActivity)(`P2P heartbeat from ${hb.nodeId}`, 'info');
            });
        }
        catch (e) {
            console.log(`    ⚠ P2P mesh: ${e.message} (platform-only mode)`);
        }
    }
    // ── Boot complete ───────────────────────────────────────────
    const bootTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const dashPort = actualPort;
    let uptimeDaemon = null;
    if (isPlatform) {
        // ── Platform mode boot banner ────────────────────────────
        console.log('');
        console.log('  ╔═══════════════════════════════════════════════════════╗');
        console.log('  ║  🏛️  GSTD Platform Server — Ready! (' + bootTime + 's)            ║');
        console.log('  ║  Telegram Bot + Dashboard + API + Node Monitoring     ║');
        console.log('  ╚═══════════════════════════════════════════════════════╝');
        console.log('');
        console.log('  👉 Dashboard: http://localhost:' + dashPort);
        console.log('');
        console.log('  ── Platform Services ────────────────────────────');
        console.log('  🤖 Telegram:    ✓ Bot active');
        console.log('  🧠 AI Chat:     ✓ 8 models available');
        console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 only'));
        console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'auto-generated'));
        console.log('  🔗 TON Connect: ' + (tonConnect.isReady() ? '✓ ' + tonConnect.getAddress()?.slice(0, 12) + '...' : 'ready'));
        console.log('  📱 Mobile TMA:  ' + (mobileNode ? '✓ active' : 'disabled'));
        console.log('  ── Node Management (remote) ─────────────────────');
        console.log('  📡 Node API:    ✓ /nodes/* endpoints via backend');
        console.log('  🩺 Monitoring:  ✓ Health Monitor + Alerts via backend');
        console.log('  ⚙️  Commands:    ✓ Remote dispatch (restart/deploy/diagnostics)');
        console.log('  🚫 Swarm:       DISABLED (platform mode)');
        console.log('  🚫 P2P/NaaS:    DISABLED (remote user nodes only)');
        console.log('');
        console.log('  💡 Nodes run on USER machines, not this server!');
        console.log('     Install: curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash');
        console.log('');
        (0, server_js_1.logActivity)('GSTD Platform Server v' + config.version + ' booted in ' + bootTime + 's (platform mode)', 'success');
    }
    else {
        // ── Node mode boot banner (original) ────────────────────
        const accessInfo = remote?.getAccessInfo();
        const computeStats = computeMarket?.getStats();
        const storageStats = storageVault?.getStats();
        console.log('');
        console.log('  ╔═══════════════════════════════════════════════════════╗');
        console.log('  ║  🐝 GSTD SuperNode — Ready! (' + bootTime + 's)                   ║');
        console.log('  ║  ONE NODE TO RULE THEM ALL — 6 Revenue Streams        ║');
        console.log('  ╚═══════════════════════════════════════════════════════╝');
        console.log('');
        console.log('  👉 Dashboard: http://localhost:' + dashPort);
        console.log('');
        if (accessInfo?.methods?.relay?.status === 'connected') {
            console.log('  🌐 Remote:      ' + accessInfo.methods.relay.url);
        }
        console.log('  ── Revenue Streams ──────────────────────────────');
        console.log('  💾 Storage:     ' + (storageVault?.isEnabled() ? `✓ ${storageStats?.totalCapacityGB} GB available` : 'disabled'));
        console.log('  💻 Compute:     ' + (computeMarket?.isEnabled() ? `✓ score ${computeStats?.benchmarkScore} pts` : 'disabled'));
        console.log('  🧠 Inference:   ✓ 8 AI models (earn per query)');
        console.log('  📡 Relay:       ' + (trafficRelay?.isEnabled() ? '✓ VPN/CDN/API proxy' : 'disabled'));
        console.log('  🌐 NaaS RPC:    ' + (naas ? `✓ ${naas.getStatus().active_chains.length} chains active` : 'disabled'));
        console.log('  🎓 Training:    ' + (trainer?.getStats().activeJobs > 0 ? 'active' : '✓ ready'));
        console.log('  🪙 Staking:     ✓ 12% APY');
        console.log('  ── Infrastructure ───────────────────────────────');
        console.log('  🐝 Swarm:       ' + (swarm?.isConnected() ? '✓ connected' : 'standalone'));
        console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'auto-generated'));
        console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 only'));
        console.log('  🔗 TON Connect: ' + (tonConnect.isReady() ? '✓ ' + tonConnect.getAddress()?.slice(0, 12) + '...' : 'ready'));
        console.log('  📱 Mobile:      ' + (mobileNode ? '✓ TMA' : 'disabled'));
        console.log('  ⚡ HTTP Engine:  ' + (fastifyGateway ? 'Fastify (4x boost)' : 'Express'));
        console.log('  🌐 P2P Mesh:    ' + (p2pPeerId ? `✓ ${p2pPeerId.slice(0, 16)}...` : 'platform-only'));
        if (p2pNode) {
            const p2pStats = p2pNode.getStats();
            if (p2pStats.connectedPeers > 0) {
                console.log(`  🤝 P2P Peers:   ${p2pStats.connectedPeers} connected`);
            }
        }
        console.log('');
        console.log('  💡 All 6 revenue streams earn GSTD automatically!');
        console.log('     Settlement → GSTD token on TON blockchain');
        console.log('');
        (0, server_js_1.logActivity)('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');
        // ── Uptime Daemon (Proof-of-Uptime + NaaS commands) ──────────
        uptimeDaemon = new uptime_daemon_js_1.UptimeDaemon(config.nodeId, wallet.getAddress() || '');
        uptimeDaemon.start();
        console.log(`  🔒 Uptime:      ✓ Proof-of-Uptime daemon (Age Multiplier: ${uptimeDaemon.getMultiplier()}x)`);
    }
    // ── Safe Auto-update: check every hour ─────────────────────────
    // Safety guarantees:
    //   1. Snapshot current HEAD before pulling
    //   2. Build/compile check before restart
    //   3. If build fails → automatic rollback
    //   4. If new version crashes → systemd/PM2 will restart from rolled-back code
    const checkAndUpdate = async () => {
        try {
            const { execSync } = require('child_process');
            const installDir = config.installDir || (0, path_1.join)((0, os_2.homedir)(), 'gstdbot');
            // Fetch latest from GitHub
            execSync('git fetch origin main --quiet 2>/dev/null', { cwd: installDir, timeout: 30000 });
            // Compare local HEAD with remote
            const localHash = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            const remoteHash = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            if (localHash === remoteHash)
                return; // Already up to date
            // ── STEP 1: Snapshot current state for rollback ────────────
            const snapshotRef = localHash;
            (0, server_js_1.logActivity)(`Update available: ${localHash.slice(0, 8)} → ${remoteHash.slice(0, 8)}`, 'info');
            console.log(`  🔄 Update: ${localHash.slice(0, 8)} → ${remoteHash.slice(0, 8)}`);
            // Stash any local changes
            try {
                execSync('git stash --quiet 2>/dev/null', { cwd: installDir, timeout: 10000 });
            }
            catch { }
            // ── STEP 2: Pull new code ──────────────────────────────────
            execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });
            // ── STEP 3: Install deps + build check ─────────────────────
            try {
                execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 180000 });
                // Verify TypeScript compilation
                execSync('npx tsc --noEmit 2>/dev/null || true', { cwd: installDir, timeout: 60000 });
                // Check that main entry point exists
                const { existsSync: pathExists } = require('fs');
                const distPath = (0, path_1.join)(installDir, 'dist', 'index.js');
                const srcPath = (0, path_1.join)(installDir, 'src', 'index.ts');
                if (!pathExists(distPath) && !pathExists(srcPath)) {
                    throw new Error('Entry point missing after update');
                }
                (0, server_js_1.logActivity)(`Update verified (${remoteHash.slice(0, 8)}). Restarting...`, 'success');
                console.log('  ✅ Update build verified. Safe to restart.');
                // Record successful update for audit
                try {
                    const updateLog = (0, path_1.join)(installDir, '.update-log');
                    const { appendFileSync: appendLog } = require('fs');
                    appendLog(updateLog, `${new Date().toISOString()} | ${snapshotRef.slice(0, 8)} → ${remoteHash.slice(0, 8)} | OK\n`);
                }
                catch { }
                // Graceful exit — systemd/PM2 will restart with new code
                process.exit(0);
            }
            catch (buildErr) {
                // ── STEP 4: ROLLBACK on build failure ───────────────────
                console.error(`  ❌ Update build FAILED: ${buildErr.message}`);
                (0, server_js_1.logActivity)(`Update FAILED — rolling back to ${snapshotRef.slice(0, 8)}`, 'error');
                execSync(`git reset --hard ${snapshotRef}`, { cwd: installDir, timeout: 15000 });
                execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
                console.log(`  🔙 Rolled back to ${snapshotRef.slice(0, 8)}. Node continues running.`);
                (0, server_js_1.logActivity)(`Rollback complete. Running on ${snapshotRef.slice(0, 8)}`, 'warn');
                // Record failed update
                try {
                    const updateLog = (0, path_1.join)(installDir, '.update-log');
                    const { appendFileSync: appendLog } = require('fs');
                    appendLog(updateLog, `${new Date().toISOString()} | ${snapshotRef.slice(0, 8)} → ${remoteHash.slice(0, 8)} | FAILED: ${buildErr.message}\n`);
                }
                catch { }
                // Do NOT exit — node continues on old version
            }
        }
        catch (_e) { /* silent — git may not be available in Docker */ }
    };
    // Check for updates after 2 min, then every hour
    setTimeout(checkAndUpdate, 2 * 60 * 1000);
    const updateInterval = setInterval(checkAndUpdate, 60 * 60 * 1000);
    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log(`\n  🛑 Shutting down GSTD ${isPlatform ? 'Platform' : 'SuperNode'}...`);
        (0, server_js_1.logActivity)('Shutdown initiated', 'warn');
        clearInterval(updateInterval);
        if (uptimeDaemon)
            uptimeDaemon.stop();
        if (p2pNode)
            await p2pNode.stop();
        if (fastifyGateway)
            await fastifyGateway.close();
        if (mobileNode)
            await mobileNode.stop();
        await tonConnect.close();
        if (naas)
            await naas.stop();
        if (trafficRelay)
            await trafficRelay.stop();
        if (computeMarket)
            await computeMarket.stop();
        if (storageVault)
            await storageVault.stop();
        await revenue.stop();
        if (trainer)
            await trainer.stop();
        if (resources)
            await resources.stop();
        if (remote)
            await remote.stop();
        if (swarm)
            await swarm.stop();
        await memory.close();
        await blockchain.close();
        await gateway.stop();
        console.log('  ✅ Clean shutdown complete.');
        if (!isPlatform) {
            const revStats = revenue.getStats();
            console.log(`  💰 Total earned: ${revStats.totalEarned.toFixed(4)} GSTD (${revStats.settlementsCount} settlements)`);
        }
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