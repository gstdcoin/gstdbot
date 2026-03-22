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

import { OmegaGateway, logActivity } from './gateway/server.js';
import { SecurityHardening } from './security/hardening.js';
import { SwarmOrchestrator } from './swarm/orchestrator.js';
import { TelegramChannel } from './channels/telegram.js';
import { SwarmAgent } from './swarm/agent.js';
import { CollectiveMemory } from './memory/collective.js';
import { NodeWallet } from './wallet/manager.js';
import { TonConnectManager } from './wallet/tonconnect.js';
import { MobileNodeManager } from './channels/miniapp.js';
import { BlockchainManager } from './blockchain/token.js';
import { RemoteAccessManager } from './network/remote.js';
import { ResourceSharing } from './network/resources.js';
import { SwarmTrainer } from './training/federated.js';
import { RevenueEngine } from './revenue/engine.js';
import { StorageVault } from './storage/vault.js';
import { ComputeMarketplace } from './compute/marketplace.js';
import { TrafficRelay } from './coverage/relay.js';
import { FastifyGateway } from './gateway/fastify.js';
import { GstdP2PNode } from './p2p/node.js';
import { hostname } from 'os';
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
    tonconnect: { enabled: boolean; network: 'mainnet' | 'testnet'; bridgeUrl: string };
    mobileNode: { enabled: boolean };
}

function loadConfig(): NodeConfig {
    const configPath = join(homedir(), '.config', 'gstdbot', 'config.json');
    const defaults: NodeConfig = {
        version: '3.4.0',
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
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'moonshotai/kimi-k2-instruct'],
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
        tonconnect: {
            enabled: process.env.GSTD_TONCONNECT !== 'false',
            network: (process.env.TON_NETWORK as any) || 'mainnet',
            bridgeUrl: process.env.TON_BRIDGE_URL || 'https://connect.ton.org/bridge',
        },
        mobileNode: {
            enabled: process.env.GSTD_MOBILE_NODE !== 'false',
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
        } catch (_e) { }
    }
    return defaults;
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const config = loadConfig();
    const startTime = Date.now();
    const TOTAL_STEPS = 16;

    console.log('');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log('  🐝  GSTD SuperNode OS v' + config.version);
    console.log('  🐝  ' + config.nodeName + ' (' + config.mode + ' mode)');
    console.log('  🐝  ONE NODE TO RULE THEM ALL — 6 Revenue Streams');
    console.log('  🐝  💾 Storage  💻 Compute  🧠 AI  📡 Relay  🎓 Training  🪙 Staking');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log('');

    // ── 1. Start Gateway (API + AI Engine) ──────────────────────
    console.log(`  [1/${TOTAL_STEPS}] Starting AI Gateway...`);
    const desiredPort = parseInt(process.env.GSTD_DASHBOARD_PORT || process.env.GSTD_API_PORT || '8080');
    const gateway = new OmegaGateway({
        apiPort: desiredPort,
        swarmUrl: process.env.GSTD_SWARM_URL || process.env.OLLAMA_URL || 'https://api.gstdtoken.com',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
    });
    await gateway.start();
    const actualPort = gateway.getPort();

    // ── 2. Blockchain Manager (GSTD Wallet + Staking) ───────────
    console.log(`  [2/${TOTAL_STEPS}] Initializing blockchain...`);
    const blockchain = new BlockchainManager();
    await blockchain.init();

    // ── 3. Revenue Engine (Unified 6-stream earnings) ───────────
    console.log(`  [3/${TOTAL_STEPS}] Initializing Revenue Engine (6 streams)...`);
    const revenue = new RevenueEngine(config.nodeId);
    await revenue.init();

    // ── 4. Wallet Manager (Earnings Tracker) ────────────────────
    console.log(`  [4/${TOTAL_STEPS}] Starting wallet manager...`);
    const wallet = new NodeWallet(config);
    await wallet.init();

    // Connect wallet to gateway → every query earns GSTD
    gateway.setWallet(wallet);

    // Connect revenue engine wallet
    const addr = wallet.getAddress();
    if (addr) {
        revenue.setWalletAddress(addr);
    }

    // Auto-save earnings every 5 minutes
    setInterval(() => { try { wallet.saveEarnings(); } catch (_e) {} }, 5 * 60 * 1000);

    // ── 5. Collective Memory ────────────────────────────────────
    console.log(`  [5/${TOTAL_STEPS}] Connecting collective memory...`);
    const memory = new CollectiveMemory(config);
    await memory.init();

    // ── 6. Swarm Agent (P2P + Task Processing) ──────────────────
    console.log(`  [6/${TOTAL_STEPS}] Joining swarm network...`);
    const swarm = new SwarmAgent(config, wallet, memory);
    await swarm.start();

    // ── 7. Resource Sharing ─────────────────────────────────────
    console.log(`  [7/${TOTAL_STEPS}] Enabling resource sharing...`);
    const resources = new ResourceSharing(config);
    await resources.init();

    // ── 8. Federated Training (🎓 earn GSTD for training) ───────
    console.log(`  [8/${TOTAL_STEPS}] Initializing training engine...`);
    const trainer = new SwarmTrainer(config);
    await trainer.init();

    // ── 9. Storage Vault (💾 earn GSTD for storing data) ────────
    console.log(`  [9/${TOTAL_STEPS}] Initializing Storage Vault...`);
    const storageVault = new StorageVault(config.nodeId);
    storageVault.setRevenueEngine(revenue);
    await storageVault.init();

    // ── 10. Compute Marketplace (💻 earn GSTD for GPU jobs) ──────
    console.log(`  [10/${TOTAL_STEPS}] Initializing Compute Marketplace...`);
    const computeMarket = new ComputeMarketplace(config.nodeId);
    computeMarket.setRevenueEngine(revenue);
    await computeMarket.init();

    // ── 11. Traffic Relay (📡 earn GSTD for proxying traffic) ────
    console.log(`  [11/${TOTAL_STEPS}] Initializing Traffic Relay...`);
    const trafficRelay = new TrafficRelay(config.nodeId);
    trafficRelay.setRevenueEngine(revenue);
    await trafficRelay.init();
    trafficRelay.mountRoutes(gateway.getExpressApp());

    // ── 12. Remote Access + Channels ────────────────────────────
    console.log(`  [12/${TOTAL_STEPS}] Setting up remote access...`);
    const remote = new RemoteAccessManager(config.nodeId);
    await remote.init();

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
        const telegram = new TelegramChannel({
            botToken: telegramToken,
            swarmUrl: process.env.GSTD_SWARM_URL || 'https://api.gstdtoken.com',
            cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
            adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').filter(Boolean).map(Number),
            communityChat: process.env.TELEGRAM_COMMUNITY_CHAT ? parseInt(process.env.TELEGRAM_COMMUNITY_CHAT) : undefined,
        });
        await telegram.start();
    } else {
        console.log('    Telegram: disabled (no token)');
    }

    // ── 13. TON Connect + Mobile Node ────────────────────────────
    console.log(`  [13/${TOTAL_STEPS}] Initializing TON Connect...`);
    const tonConnect = new TonConnectManager({
        network: config.tonconnect.network,
        bridgeUrl: config.tonconnect.bridgeUrl,
        gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
    });
    if (config.tonconnect.enabled) {
        const mnemonic = process.env.GSTD_WALLET_MNEMONIC?.split(' ');
        await tonConnect.init(mnemonic).catch(() => {});
    } else {
        console.log('    TON Connect: disabled (set GSTD_TONCONNECT=true)');
    }

    let mobileNode: MobileNodeManager | null = null;
    if (config.mobileNode.enabled) {
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
        const apiUrl = process.env.GSTD_SWARM_URL || 'https://api.gstdtoken.com';
        mobileNode = new MobileNodeManager({
            botToken: telegramToken,
            apiUrl: apiUrl.replace(/\/api\/v1$/, '') + '/api/v1',
            gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',
        });
        mobileNode.registerRoutes(gateway.getExpressApp());
    } else {
        console.log('    Mobile Node: disabled');
    }

    // ── 14. Node OS ready (Dashboard served via Gateway) ─────────
    console.log(`  [14/${TOTAL_STEPS}] SuperNode OS UI active on gateway port...`);

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
        revenue,
        storageVault,
        computeMarket,
        trafficRelay,
    });

    // ── 15. Fastify HTTP Engine (4x faster HTTP parser) ──────────
    console.log(`  [15/${TOTAL_STEPS}] Upgrading to Fastify engine...`);
    let fastifyGateway: FastifyGateway | null = null;
    try {
        // Fastify wraps Express — all existing routes work through Fastify's faster parser
        fastifyGateway = new FastifyGateway(gateway.getExpressApp(), {
            port: actualPort + 1, // Fastify on port+1 (reverse proxy handles routing)
        });
        await fastifyGateway.init();
        console.log('    ⚡ Fastify engine: initialized (Express compat mode)');
    } catch (e: any) {
        console.log(`    ⚠ Fastify init skipped: ${e.message} (Express still active)`);
    }

    // ── 16. libp2p P2P Mesh Network ──────────────────────────────
    console.log(`  [16/${TOTAL_STEPS}] Starting P2P mesh network...`);
    const p2pNode = new GstdP2PNode({
        nodeId: config.nodeId,
        walletAddress: wallet.getAddress() || '',
        listenPort: parseInt(process.env.GSTD_P2P_PORT || '4001'),
        enableMdns: process.env.GSTD_P2P_MDNS !== 'false',
        version: config.version,
    });
    let p2pPeerId = '';
    try {
        p2pPeerId = await p2pNode.start();
        // Wire P2P task events to swarm agent
        p2pNode.on('task:received', (task: any) => {
            logActivity(`P2P task received: ${task.taskId}`, 'info');
        });
        p2pNode.on('heartbeat:received', (hb: any) => {
            logActivity(`P2P heartbeat from ${hb.nodeId}`, 'info');
        });
    } catch (e: any) {
        console.log(`    ⚠ P2P mesh: ${e.message} (platform-only mode)`);
    }

    // ── Boot complete ───────────────────────────────────────────
    const bootTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const accessInfo = remote.getAccessInfo();
    const dashPort = actualPort;
    const computeStats = computeMarket.getStats();
    const storageStats = storageVault.getStats();

    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════════╗');
    console.log('  ║  🐝 GSTD SuperNode — Ready! (' + bootTime + 's)                   ║');
    console.log('  ║  ONE NODE TO RULE THEM ALL — 6 Revenue Streams        ║');
    console.log('  ╚═══════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  👉 Dashboard: http://localhost:' + dashPort);
    console.log('');
    if (accessInfo.methods.relay?.status === 'connected') {
        console.log('  🌐 Remote:      ' + accessInfo.methods.relay.url);
    }
    console.log('  ── Revenue Streams ──────────────────────────────');
    console.log('  💾 Storage:     ' + (storageVault.isEnabled() ? `✓ ${storageStats.totalCapacityGB} GB available` : 'disabled'));
    console.log('  💻 Compute:     ' + (computeMarket.isEnabled() ? `✓ score ${computeStats.benchmarkScore} pts` : 'disabled'));
    console.log('  🧠 Inference:   ✓ 8 AI models (earn per query)');
    console.log('  📡 Relay:       ' + (trafficRelay.isEnabled() ? '✓ VPN/CDN/API proxy' : 'disabled'));
    console.log('  🎓 Training:    ' + (trainer.getStats().activeJobs > 0 ? 'active' : '✓ ready'));
    console.log('  🪙 Staking:     ✓ 12% APY');
    console.log('  ── Infrastructure ───────────────────────────────');
    console.log('  🐝 Swarm:       ' + (swarm.isConnected() ? '✓ connected' : 'standalone'));
    console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'auto-generated'));
    console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 only'));
    console.log('  🔗 TON Connect: ' + (tonConnect.isReady() ? '✓ ' + tonConnect.getAddress()?.slice(0,12) + '...' : 'ready'));
    console.log('  📱 Mobile:      ' + (mobileNode ? '✓ TMA' : 'disabled'));
    console.log('  ⚡ HTTP Engine:  ' + (fastifyGateway ? 'Fastify (4x boost)' : 'Express'));
    console.log('  🌐 P2P Mesh:    ' + (p2pPeerId ? `✓ ${p2pPeerId.slice(0,16)}...` : 'platform-only'));
    const p2pStats = p2pNode.getStats();
    if (p2pStats.connectedPeers > 0) {
        console.log(`  🤝 P2P Peers:   ${p2pStats.connectedPeers} connected`);
    }
    console.log('');
    console.log('  💡 All 6 revenue streams earn GSTD automatically!');
    console.log('     Settlement → GSTD token on TON blockchain');
    console.log('');

    logActivity('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');

    // ── Heartbeat: centralized in SwarmAgent (swarm/agent.ts) ─────
    // SwarmAgent already sends heartbeats every 60 min with full node info,
    // so no duplicate heartbeat is needed here. SwarmAgent calls
    // wallet.recordVerifiedEarning() when backend returns a reward.

    // ── Auto-update: check every hour ────────────────────────────
    const checkAndUpdate = async () => {
        try {
            const { execSync } = require('child_process');
            const installDir = config.installDir || join(homedir(), 'gstdbot');
            
            // Fetch latest from GitHub
            execSync('git fetch origin main --quiet 2>/dev/null', { cwd: installDir, timeout: 30000 });
            
            // Compare local HEAD with remote
            const local = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            const remote = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            
            if (local !== remote) {
                logActivity('Update available — pulling from GitHub...', 'info');
                console.log('  🔄 Update detected. Pulling latest code...');
                
                // Pull and rebuild
                execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });
                execSync('npm install --legacy-peer-deps --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
                
                logActivity('Update installed — restarting node...', 'success');
                console.log('  ✅ Update installed. Restarting...');
                
                // Systemd will restart us, or PM2, or the user manually
                process.exit(0);
            }
        } catch (_e) { /* silent — git may not be available in Docker */ }
    };

    // Check for updates after 2 min, then every hour
    setTimeout(checkAndUpdate, 2 * 60 * 1000);
    const updateInterval = setInterval(checkAndUpdate, 60 * 60 * 1000);

    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log('\n  🛑 Shutting down GSTD SuperNode...');
        logActivity('Node shutdown initiated', 'warn');
        clearInterval(updateInterval);
        await p2pNode.stop();
        if (fastifyGateway) await fastifyGateway.close();
        if (mobileNode) await mobileNode.stop();
        await tonConnect.close();
        await trafficRelay.stop();
        await computeMarket.stop();
        await storageVault.stop();
        await revenue.stop();
        await trainer.stop();
        await resources.stop();
        await remote.stop();
        await swarm.stop();
        await memory.close();
        await blockchain.close();
        await gateway.stop();
        console.log('  ✅ Clean shutdown complete.');
        const revStats = revenue.getStats();
        console.log(`  💰 Total earned: ${revStats.totalEarned.toFixed(4)} GSTD (${revStats.settlementsCount} settlements)`);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('  ❌ Fatal error:', err);
    process.exit(1);
});
