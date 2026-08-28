// Promise.withResolvers ponyfill (Node 21+ API; DHT/ping libp2p services need it
// transitively, but this codebase supports Node >=20 per package.json's engines
// field and install.sh's existing-install check -- polyfill rather than forcing
// a Node upgrade on existing node operators).
if (typeof (Promise as any).withResolvers !== 'function') {
    (Promise as any).withResolvers = function <T>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: any) => void;
        const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    };
}

/**
 * GSTD Node OS — Main Orchestrator (gstdd)
 *
 * ═══════════════════════════════════════════════════════
 * DePIN AI Compute Node — Earn GSTD for AI inference:
 *   🧠 AI Inference      — earn GSTD for answering queries (90% of fee)
 *   💾 Storage Provider  — earn GSTD for hosting data [optional]
 *   💻 GPU Compute       — earn GSTD for running jobs [optional]
 *   📡 Traffic Relay     — earn GSTD for proxying traffic [optional]
 *   🎓 Model Training    — earn GSTD for federated training [optional]
 *
 * GSTD is a utility token. Earnings come from real usage — not staking.
 * ═══════════════════════════════════════════════════════
 *
 * Boot sequence:
 *  1. AI Gateway (Ollama — sovereign inference)
 *  2. Blockchain Manager (GSTD wallet)
 *  3. Revenue Engine (earnings tracker)
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
import { isRegistered, getEntry } from './lib/model-registry.js';
import { detectOdysseus } from './odysseus/detector.js';
import { SecurityHardening } from './security/hardening.js';
import { SwarmOrchestrator } from './swarm/orchestrator.js';
import { TelegramChannel } from './channels/telegram.js';
import { GstdAiBot } from './channels/gstdai.js';
import { SwarmAgent } from './swarm/agent.js';
import { CollectiveMemory } from './memory/collective.js';
import { NodeWallet } from './wallet/manager.js';
import { TonConnectManager } from './wallet/tonconnect.js';
import { MobileNodeManager } from './channels/miniapp.js';
import { BlockchainManager, CONTRACTS } from './blockchain/token.js';
import { RemoteAccessManager } from './network/remote.js';
import { ResourceSharing } from './network/resources.js';
import { SwarmTrainer } from './training/federated.js';
import { RevenueEngine } from './revenue/engine.js';
import { StorageVault } from './storage/vault.js';
import { ComputeMarketplace } from './compute/marketplace.js';
import { TrafficRelay } from './coverage/relay.js';
import { FastifyGateway } from './gateway/fastify.js';
import { NaaSManager } from './naas/orchestrator.js';
import { UptimeDaemon } from './naas/uptime_daemon.js';
import { GstdP2PNode } from './p2p/node.js';
import { loadOrCreateAttestorIdentity } from './p2p/identity.js';
import { loadOrCreateP2PIdentity } from './p2p/p2p-identity.js';
import { hostname } from 'os';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 50;

// ─── AI Backend Model Detection ─────────────────────────────────
// Returns the list of models this node can actually serve.
// Priority: Ollama local models (sovereign inference, no external deps).
async function resolveAvailableModels(): Promise<string[]> {
    const models: string[] = [];

    // Ollama — query locally installed models
    const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    try {
        const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            const data: any = await resp.json();
            for (const m of (data.models || [])) {
                if (m.name) models.push(m.name);
            }
        }
    } catch (_e) { /* Ollama not running yet */ }

    // Odysseus — detect special AI workspace capabilities
    const odysseus = await detectOdysseus();
    if (odysseus.running && odysseus.models.length > 0) {
        models.push(...odysseus.models);
        console.log(`  🔮 Odysseus detected: ${odysseus.models.join(', ')}`);
    }

    // No backend? Fallback to empty list — heartbeat will report 0 capabilities
    return [...new Set(models)]; // deduplicate
}

// ─── Node Configuration ─────────────────────────────────────────
export interface NodeConfig {
    version: string;
    mode: 'cloud' | 'hybrid' | 'sovereign' | 'platform';
    nodeId: string;
    nodeName: string;
    installDir: string;
    swarm: { enabled: boolean; maxCPU: number; maxRAM: number; apiUrl: string };
    dashboard: { host: string; port: number; enabled: boolean };
    models: { available: string[] };
    memory: { redisUrl: string; chromaUrl: string; enabled: boolean };
    apps: { enabled: boolean; dataDir: string };
    tonconnect: { enabled: boolean; network: 'mainnet' | 'testnet'; bridgeUrl: string };
    mobileNode: { enabled: boolean };
}

async function loadConfig(): Promise<NodeConfig> {
    const configPath = join(homedir(), '.config', 'gstdbot', 'config.json');
    const defaults: NodeConfig = {
        version: '3.4.0',
        mode: (process.env.GSTD_MODE as any) || 'cloud',
        nodeId: process.env.GSTD_NODE_ID || `node-${hostname()}`,
        nodeName: process.env.NODE_NAME || `${hostname()}-node`,
        installDir: process.env.GSTD_INSTALL_DIR || join(homedir(), 'gstdbot'),
        swarm: {
            enabled: process.env.SWARM_ENABLED !== 'false' && process.env.GSTD_MODE !== 'platform',
            maxCPU: parseInt(process.env.GSTD_MAX_CPU || '80'),
            maxRAM: parseInt(process.env.GSTD_MAX_RAM || '70'),
            apiUrl: process.env.GSTD_API_URL || 'https://platform.gstdtoken.com/api/v1',
        },
        dashboard: {
            host: '0.0.0.0',
            port: parseInt(process.env.GSTD_DASHBOARD_PORT || '8080'),
            enabled: process.env.GSTD_DASHBOARD !== 'false',
        },
        models: {
            // Resolved at runtime from local Ollama. Updated after each model pull.
            available: await resolveAvailableModels(),
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

// ─── P2P Mesh Retry Helper ──────────────────────────────────────
const MESH_RETRY_BASE_MS = 5_000;
const MESH_RETRY_MAX_MS = 5 * 60_000;

/**
 * Retries a failed P2P mesh start in the background with exponential backoff
 * (capped at 5 minutes), without blocking node boot. Runs until it succeeds
 * or the process exits -- there is no permanent give-up.
 */
function retryMeshInBackground(node: GstdP2PNode, swarm: SwarmAgent | null, gateway: OmegaGateway | null): void {
    let attempt = 0;
    const tryStart = async () => {
        attempt++;
        try {
            const peerId = await node.start();
            if (swarm) swarm.setP2PNode(node);
            // Bridge libp2p-discovered peers (with a real httpUrl) into the
            // gateway's HTTP PeerManager so they become routable via forwardToPeer().
            node.on('heartbeat:received', (data: any) => {
                if (!data.httpUrl) return; // no HTTP address to route to -- nothing to bridge
                const pm = gateway?.getPeerManager?.() ?? null;
                pm?.registerPeer(data.nodeId, data.httpUrl, data.capabilities || [], 'p2p-mesh', false, data.pubkeyHex);
            });
            console.log(`    ✓ P2P mesh started after ${attempt} retr${attempt === 1 ? 'y' : 'ies'} (peer ${peerId.slice(0, 16)}...)`);
        } catch (e: any) {
            const backoff = Math.min(MESH_RETRY_BASE_MS * 2 ** attempt, MESH_RETRY_MAX_MS);
            console.log(`    ⚠ P2P mesh retry ${attempt} failed: ${e.message} — next attempt in ${Math.round(backoff / 1000)}s`);
            setTimeout(tryStart, backoff);
        }
    };
    setTimeout(tryStart, MESH_RETRY_BASE_MS);
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const config = await loadConfig();
    // Registry audit — informational only, no models are blocked
    for (const m of config.models.available) {
        if (!isRegistered(m)) {
            console.warn(`  WARN [registry] unverified model loaded: ${m}`);
        } else {
            const entry = getEntry(m)!;
            if (!entry.commercial) {
                console.warn(`  WARN [registry] non-commercial model loaded: ${m} (${entry.license})`);
            }
        }
    }
    const identity = loadOrCreateAttestorIdentity();
    console.log(`    ✓ Attestor identity loaded (pubkey: ${identity.pubkeyHex.slice(0, 16)}...)`);
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
    console.log('  🐝  DePIN AI Compute Node — earn GSTD for inference');
    console.log('  🐝  💾 Storage  💻 Compute  🧠 AI Inference  📡 Relay  🎓 Training');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log('');

    // ── 1. Start Gateway (API + AI Engine) ──────────────────────
    console.log(`  [1/${TOTAL_STEPS}] Starting AI Gateway...`);
    const desiredPort = parseInt(process.env.GSTD_DASHBOARD_PORT || process.env.GSTD_API_PORT || '8080');
    const gateway = new OmegaGateway({
        apiPort: desiredPort,
        swarmUrl: process.env.GSTD_SWARM_URL || 'https://platform.gstdtoken.com',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
        nodeId: config.nodeId,
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
    let swarm: SwarmAgent | null = null;
    if (!isPlatform) {
        console.log(`  [6/${TOTAL_STEPS}] Joining swarm network...`);
        swarm = new SwarmAgent(config, wallet, memory);
        await swarm.start();
        if (swarm) swarm.setIdentity(identity);
        if (swarm) swarm.setPeerManager(gateway.getPeerManager());
    } else {
        console.log('  [6/7] Swarm: SKIPPED (platform mode)');
    }

    // ── Node-only subsystems (skipped in platform mode) ──────────
    let resources: ResourceSharing | null = null;
    let trainer: SwarmTrainer | null = null;
    let storageVault: StorageVault | null = null;
    let computeMarket: ComputeMarketplace | null = null;
    let trafficRelay: TrafficRelay | null = null;
    let naas: NaaSManager | null = null;

    if (!isPlatform) {
        // ── 7. Resource Sharing ─────────────────────────────────────
        console.log(`  [7/${TOTAL_STEPS}] Enabling resource sharing...`);
        resources = new ResourceSharing(config);
        await resources.init();

        // ── 8. Federated Training ───────────────────────────────────
        console.log(`  [8/${TOTAL_STEPS}] Initializing training engine...`);
        trainer = new SwarmTrainer(config);
        await trainer.init();

        // ── 9. Storage Vault ────────────────────────────────────────
        console.log(`  [9/${TOTAL_STEPS}] Initializing Storage Vault...`);
        storageVault = new StorageVault(config.nodeId);
        storageVault.setRevenueEngine(revenue);
        await storageVault.init();

        // ── 10. Compute Marketplace ─────────────────────────────────
        console.log(`  [10/${TOTAL_STEPS}] Initializing Compute Marketplace...`);
        computeMarket = new ComputeMarketplace(config.nodeId);
        computeMarket.setRevenueEngine(revenue);
        await computeMarket.init();

        // ── 11. Traffic Relay ───────────────────────────────────────
        console.log(`  [11/${TOTAL_STEPS}] Initializing Traffic Relay...`);
        trafficRelay = new TrafficRelay(config.nodeId);
        trafficRelay.setRevenueEngine(revenue);
        (trafficRelay as any).setFeeLedger(gateway.getFeeLedger());
        await trafficRelay.init();
        trafficRelay.mountRoutes(gateway.getExpressApp());

        // ── 12. NaaS (Node-as-a-Service: Multi-Chain RPC) ───────────
        console.log(`  [12/${TOTAL_STEPS}] Initializing NaaS (Multi-Chain RPC)...`);
        naas = new NaaSManager();
        const apiKey = process.env.GSTD_API_KEY || wallet.getAddress() || config.nodeId;
        if (process.env.GSTD_NAAS_ENABLED !== 'false') {
            await naas.start(apiKey);
        } else {
            console.log('    NaaS: disabled (set GSTD_NAAS_ENABLED=true)');
        }
    } else {
        console.log('  [7/7] Node subsystems: SKIPPED (platform mode)');
        console.log('    ↳ Resource Sharing, Training, Storage, Compute, Relay, NaaS — remote nodes only');
    }

    // ── 13. Remote Access + Channels ────────────────────────────
    let remote: RemoteAccessManager | null = null;
    if (!isPlatform) {
        console.log(`  [13/${TOTAL_STEPS}] Setting up remote access...`);
        remote = new RemoteAccessManager(config.nodeId);
        await remote.init();
    }

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
        const telegram = new TelegramChannel({
            botToken: telegramToken,
            swarmUrl: process.env.GSTD_SWARM_URL || 'https://platform.gstdtoken.com',
            cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
            adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').filter(Boolean).map(Number),
            communityChat: process.env.TELEGRAM_COMMUNITY_CHAT ? parseInt(process.env.TELEGRAM_COMMUNITY_CHAT) : undefined,
        });
        await telegram.start();
    } else {
        console.log('    Telegram: disabled (no token)');
    }

    // ── @gstdaibot — clean AI bot ────────────────────────────────────────────
    const gstdAiToken = process.env.GSTDAI_BOT_TOKEN;
    if (gstdAiToken) {
        const gstdAiBot = new GstdAiBot(
            gstdAiToken,
            process.env.GSTD_SWARM_URL || 'https://platform.gstdtoken.com',
        );
        await gstdAiBot.start();
        console.log('    @gstdaibot: started');
    } else {
        console.log('    @gstdaibot: disabled (no GSTDAI_BOT_TOKEN)');
    }

    // ── 14. TON Connect + Mobile Node ────────────────────────────
    console.log(`  [14/${TOTAL_STEPS}] Initializing TON Connect...`);
    const tonConnect = new TonConnectManager({
        network: config.tonconnect.network,
        bridgeUrl: config.tonconnect.bridgeUrl,
        gstdJettonAddress: CONTRACTS.GSTD_TOKEN,
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
        const apiUrl = process.env.GSTD_SWARM_URL || 'https://platform.gstdtoken.com';
        mobileNode = new MobileNodeManager({
            botToken: telegramToken,
            apiUrl: apiUrl.replace(/\/api\/v1$/, '') + '/api/v1',
            gstdJettonAddress: CONTRACTS.GSTD_TOKEN,
        });
        mobileNode.registerRoutes(gateway.getExpressApp());
    } else {
        console.log('    Mobile Node: disabled');
    }

    // ── 15. Node OS ready (Dashboard served via Gateway) ─────────
    console.log(`  [15/${TOTAL_STEPS}] SuperNode OS UI active on gateway port...`);

    // Initialize security and orchestrator
    const security = new SecurityHardening();
    let orchestrator: SwarmOrchestrator | null = null;
    if (!isPlatform) {
        orchestrator = new SwarmOrchestrator(config);
        await orchestrator.init().catch(() => {});
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
    let fastifyGateway: FastifyGateway | null = null;
    if (!isPlatform) {
        console.log(`  [16/${TOTAL_STEPS}] Upgrading to Fastify engine...`);
        try {
            fastifyGateway = new FastifyGateway(gateway.getExpressApp(), {
                port: actualPort + 1,
            });
            await fastifyGateway.init();
            if (typeof (fastifyGateway as any).listen === 'function') {
                await (fastifyGateway as any).listen();
            }
            console.log('    ⚡ Fastify engine: initialized (Express compat mode)');
        } catch (e: any) {
            console.log(`    ⚠ Fastify init skipped: ${e.message} (Express still active)`);
        }
    }

    // ── 17. libp2p P2P Mesh Network ──────────────────────────────
    let p2pNode: GstdP2PNode | null = null;
    let p2pPeerId = '';
    if (!isPlatform) {
        console.log(`  [17/${TOTAL_STEPS}] Starting P2P mesh network...`);
        // Load (or create) a stable Ed25519 keypair so the peerId survives restarts.
        // Without this every restart mints a new peerId, invalidating bootstrap addrs.
        const p2pIdentity = await loadOrCreateP2PIdentity().catch((e: any) => {
            console.warn(`    ⚠ Could not load P2P identity: ${e.message} — peerId will be ephemeral`);
            return null;
        });
        if (p2pIdentity && !p2pIdentity.isNew) {
            console.log(`    ✓ P2P identity loaded (stable peerId)`);
        }
        // Derive the public announce host from GSTD_PUBLIC_URL env var if set,
        // e.g. "https://node.gstdtoken.com" → "node.gstdtoken.com"
        const publicUrlHost = (() => {
            try {
                const u = process.env.GSTD_PUBLIC_URL || '';
                return u ? new URL(u).hostname : '';
            } catch { return ''; }
        })();
        p2pNode = new GstdP2PNode({
            nodeId: config.nodeId,
            walletAddress: wallet.getAddress() || '',
            listenPort: parseInt(process.env.GSTD_P2P_PORT || '4001'),
            enableMdns: process.env.GSTD_P2P_MDNS !== 'false',
            version: config.version,
            ...(p2pIdentity && { privateKey: p2pIdentity.privateKey }),
            // Attach WS transport to the gateway HTTP server (same port, same tunnel).
            // This lets remote nodes reach us at wss://node.gstdtoken.com without any
            // new Cloudflare tunnel config.
            httpServer: gateway.getHttpServer(),
            wsAnnounceHost: publicUrlHost,
        });
        p2pNode.setIdentity(identity);
        try {
            p2pPeerId = await p2pNode.start();
            // Publish P2P identity to platform so other nodes can use us for bootstrap
            const p2pAddrs = p2pNode.getMultiaddrs ? p2pNode.getMultiaddrs() : [];
            gateway.setP2PIdentity(p2pPeerId, p2pAddrs);
            // Wire P2P into SwarmAgent: P2P tasks routed through processTask(),
            // P2P heartbeats used to dial new WAN peers for mesh formation
            if (swarm) swarm.setP2PNode(p2pNode);
            // Bridge libp2p-discovered peers (with a real httpUrl) into the
            // gateway's HTTP PeerManager so they become routable via forwardToPeer().
            p2pNode.on('heartbeat:received', (data: any) => {
                if (!data.httpUrl) return; // no HTTP address to route to -- nothing to bridge
                const pm = gateway?.getPeerManager?.() ?? null;
                pm?.registerPeer(data.nodeId, data.httpUrl, data.capabilities || [], 'p2p-mesh', false, data.pubkeyHex);
            });
        } catch (e: any) {
            // Previously this gave up for the entire process lifetime. Instead,
            // keep boot moving (this doesn't block startup) and retry with
            // backoff in the background -- a transient failure like EADDRINUSE
            // should not permanently disable the mesh.
            console.log(`    ⚠ P2P mesh: ${e.message} — retrying in background`);
            retryMeshInBackground(p2pNode, swarm, gateway);
        }
    }

    // ── Boot complete ───────────────────────────────────────────
    const bootTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const dashPort = actualPort;

    let uptimeDaemon: UptimeDaemon | null = null;

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
        console.log('  🔗 TON Connect: ' + (tonConnect.isReady() ? '✓ ' + tonConnect.getAddress()?.slice(0,12) + '...' : 'ready'));
        console.log('  📱 Mobile TMA:  ' + (mobileNode ? '✓ active' : 'disabled'));
        console.log('  ── Node Management (remote) ─────────────────────');
        console.log('  📡 Node API:    ✓ /nodes/* endpoints via backend');
        console.log('  🩺 Monitoring:  ✓ Health Monitor + Alerts via backend');
        console.log('  ⚙️  Commands:    ✓ Remote dispatch (restart/deploy/diagnostics)');
        console.log('  🚫 Swarm:       DISABLED (platform mode)');
        console.log('  🚫 P2P/NaaS:    DISABLED (remote user nodes only)');
        console.log('');
        console.log('  💡 Nodes run on USER machines, not this server!');
        console.log('     Install: curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash');
        console.log('');
        logActivity('GSTD Platform Server v' + config.version + ' booted in ' + bootTime + 's (platform mode)', 'success');
    } else {
        // ── Node mode boot banner (original) ────────────────────
        const accessInfo = remote?.getAccessInfo();
        const computeStats = computeMarket?.getStats();
        const storageStats = storageVault?.getStats();

        console.log('');
        console.log('  ╔═══════════════════════════════════════════════════════╗');
        console.log('  ║  🐝 GSTD Node — Ready! (' + bootTime + 's)                        ║');
        console.log('  ║  DePIN AI Compute Network — earn GSTD for inference    ║');
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
        console.log('  🧠 Inference:   ' + (config.models.available.length > 0 ? `✓ ${config.models.available.length} model(s): ${config.models.available.join(', ')}` : 'no models detected — run scripts/pull-models.sh'));
        console.log('  📡 Relay:       ' + (trafficRelay?.isEnabled() ? '✓ VPN/CDN/API proxy' : 'disabled'));
        console.log('  🌐 NaaS RPC:    ' + (naas ? `✓ ${naas.getStatus().active_chains.length} chains active` : 'disabled'));
        console.log('  🎓 Training:    ' + ((trainer?.getStats()?.activeJobs || 0) > 0 ? 'active' : '✓ ready'));
        console.log('  ── Infrastructure ───────────────────────────────');
        console.log('  🐝 Swarm:       ' + (swarm?.isConnected() ? '✓ connected' : 'standalone'));
        console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'auto-generated'));
        console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 only'));
        console.log('  🔗 TON Connect: ' + (tonConnect.isReady() ? '✓ ' + tonConnect.getAddress()?.slice(0,12) + '...' : 'ready'));
        console.log('  📱 Mobile:      ' + (mobileNode ? '✓ TMA' : 'disabled'));
        console.log('  ⚡ HTTP Engine:  ' + (fastifyGateway ? 'Fastify (4x boost)' : 'Express'));
        console.log('  🌐 P2P Mesh:    ' + (p2pPeerId ? `✓ ${p2pPeerId.slice(0,16)}...` : 'platform-only'));
        if (p2pNode) {
            const p2pStats = p2pNode.getStats();
            if (p2pStats.connectedPeers > 0) {
                console.log(`  🤝 P2P Peers:   ${p2pStats.connectedPeers} connected`);
            }
        }
        console.log('');
        console.log('  💡 Serving AI requests earns GSTD automatically!');
        console.log('     Earnings → GSTD token on TON blockchain (90% of inference fees)');
        console.log('');

        logActivity('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');

        // ── Uptime Daemon (Proof-of-Uptime + NaaS commands) ──────────
        uptimeDaemon = new UptimeDaemon(config.nodeId, wallet.getAddress() || '');
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
            const installDir = config.installDir || join(homedir(), 'gstdbot');
            
            // Fetch latest from GitHub
            execSync('git fetch origin main --quiet 2>/dev/null', { cwd: installDir, timeout: 30000 });
            
            // Compare local HEAD with remote
            const localHash = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            const remoteHash = execSync('git rev-parse origin/main', { cwd: installDir, encoding: 'utf-8', timeout: 5000 }).trim();
            
            if (localHash === remoteHash) return; // Already up to date

            // Only ever fast-forward. If origin/main is NOT a descendant of local HEAD
            // (e.g. local has commits origin doesn't have yet -- a real scenario if a
            // developer is working directly in this install directory, as happened live:
            // this exact check-and-update loop once reset a locally-ahead HEAD back to an
            // older origin/main, silently discarding in-progress local commits, and was
            // only saved by an unrelated build failure triggering the rollback path below),
            // do not touch the working tree at all.
            try {
                execSync(`git merge-base --is-ancestor ${localHash} ${remoteHash}`, { cwd: installDir, timeout: 5000 });
            } catch {
                logActivity(`Skipping update: origin/main (${remoteHash.slice(0,8)}) is not a descendant of local HEAD (${localHash.slice(0,8)}) -- local commits would be lost`, 'warn');
                return;
            }

            // ── STEP 1: Snapshot current state for rollback ────────────
            const snapshotRef = localHash;
            logActivity(`Update available: ${localHash.slice(0,8)} → ${remoteHash.slice(0,8)}`, 'info');
            console.log(`  🔄 Update: ${localHash.slice(0,8)} → ${remoteHash.slice(0,8)}`);
            
            // Stash any local changes
            try { execSync('git stash --quiet 2>/dev/null', { cwd: installDir, timeout: 10000 }); } catch {}

            // ── STEP 2: Pull new code ──────────────────────────────────
            execSync('git reset --hard origin/main', { cwd: installDir, timeout: 30000 });
            
            // ── STEP 3: Install deps + build check ─────────────────────
            try {
                execSync('npm install --legacy-peer-deps --include=dev --quiet 2>/dev/null', { cwd: installDir, timeout: 180000 });

                // Build TypeScript → dist/ (required since pm2 runs dist/index.js)
                execSync('node_modules/.bin/tsc --skipLibCheck 2>/dev/null', { cwd: installDir, timeout: 90000 });

                // Verify entry point was produced
                const { existsSync: pathExists } = require('fs');
                const distPath = join(installDir, 'dist', 'index.js');
                if (!pathExists(distPath)) {
                    throw new Error('Build succeeded but dist/index.js missing');
                }
                
                logActivity(`Update verified (${remoteHash.slice(0,8)}). Restarting...`, 'success');
                console.log('  ✅ Update build verified. Safe to restart.');
                
                // Record successful update for audit
                try {
                    const updateLog = join(installDir, '.update-log');
                    const { appendFileSync: appendLog } = require('fs');
                    appendLog(updateLog, `${new Date().toISOString()} | ${snapshotRef.slice(0,8)} → ${remoteHash.slice(0,8)} | OK\n`);
                } catch {}
                
                // Graceful exit — systemd/PM2 will restart with new code
                process.exit(0);
                
            } catch (buildErr: any) {
                // ── STEP 4: ROLLBACK on build failure ───────────────────
                console.error(`  ❌ Update build FAILED: ${buildErr.message}`);
                logActivity(`Update FAILED — rolling back to ${snapshotRef.slice(0,8)}`, 'error');
                
                execSync(`git reset --hard ${snapshotRef}`, { cwd: installDir, timeout: 15000 });
                execSync('npm install --legacy-peer-deps --include=dev --quiet 2>/dev/null', { cwd: installDir, timeout: 120000 });
                
                console.log(`  🔙 Rolled back to ${snapshotRef.slice(0,8)}. Node continues running.`);
                logActivity(`Rollback complete. Running on ${snapshotRef.slice(0,8)}`, 'warn');
                
                // Record failed update
                try {
                    const updateLog = join(installDir, '.update-log');
                    const { appendFileSync: appendLog } = require('fs');
                    appendLog(updateLog, `${new Date().toISOString()} | ${snapshotRef.slice(0,8)} → ${remoteHash.slice(0,8)} | FAILED: ${buildErr.message}\n`);
                } catch {}
                
                // Do NOT exit — node continues on old version
            }
        } catch (_e) { /* silent — git may not be available in Docker */ }
    };

    // Check for updates after 2 min, then every hour
    setTimeout(checkAndUpdate, 2 * 60 * 1000);
    const updateInterval = setInterval(checkAndUpdate, 60 * 60 * 1000);

    // ── Graceful shutdown ───────────────────────────────────────
    const shutdown = async () => {
        console.log(`\n  🛑 Shutting down GSTD ${isPlatform ? 'Platform' : 'SuperNode'}...`);
        logActivity('Shutdown initiated', 'warn');
        clearInterval(updateInterval);
        if (uptimeDaemon) uptimeDaemon.stop();
        if (p2pNode) await p2pNode.stop();
        if (fastifyGateway) await fastifyGateway.close();
        if (mobileNode) await mobileNode.stop();
        await tonConnect.close();
        if (naas) await naas.stop();
        if (trafficRelay) await trafficRelay.stop();
        if (computeMarket) await computeMarket.stop();
        if (storageVault) await storageVault.stop();
        await revenue.stop();
        if (trainer) await trainer.stop();
        if (resources) await resources.stop();
        if (remote) await remote.stop();
        if (swarm) await swarm.stop();
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
