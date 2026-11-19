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
 *   🧠 AI Inference      — earn GSTD for answering queries (85% of funded accepted work)
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
import { updateApprovedNode, rollbackNodeUpdate } from './lib/node-update.js';
import { DEFAULT_GSTD_API_URL, normalizeGstdApiUrl } from './core/api-url.js';
import { readSavedNodeConfig } from './lib/saved-node-config.js';
import { isRegistered, getEntry, modelFitsInRam } from './lib/model-registry.js';
import { detectOdysseus } from './odysseus/detector.js';
import { SecurityHardening } from './security/hardening.js';
import { SwarmOrchestrator } from './swarm/orchestrator.js';
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
import { join } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 50;

// Archived subsystems are inert in the compute profile.
function inactive<T>(): T | null { return null; }

// ─── AI Backend Model Detection ─────────────────────────────────
// Returns the list of models this node can actually serve.
// Filters by available system RAM so we never advertise models we can't load.
async function resolveAvailableModels(): Promise<string[]> {
    const { totalmem } = await import('os');
    const ramGb = totalmem() / (1024 ** 3);

    const models: string[] = [];

    // Ollama — query locally installed models
    const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    try {
        const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            const data: any = await resp.json();
            for (const m of (data.models || [])) {
                if (m.name && modelFitsInRam(m.name, ramGb)) {
                    models.push(m.name);
                } else if (m.name) {
                    console.log(`  ⚠️  Model ${m.name} skipped — requires more RAM than available (${ramGb.toFixed(1)} GB)`);
                }
            }
        }
    } catch (_e) { /* Ollama not running yet */ }

    // Odysseus — detect special AI workspace capabilities
    const odysseus = await detectOdysseus();
    if (odysseus.running && odysseus.models.length > 0) {
        for (const m of odysseus.models) {
            if (modelFitsInRam(m, ramGb)) models.push(m);
        }
        console.log(`  🔮 Odysseus detected: ${odysseus.models.join(', ')}`);
    }

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
        version: require('../package.json').version,
        mode: (process.env.GSTD_MODE as any) || 'sovereign',
        nodeId: process.env.GSTD_NODE_ID || `node-${hostname()}`,
        nodeName: process.env.NODE_NAME || `${hostname()}-node`,
        installDir: process.env.GSTD_INSTALL_DIR || join(homedir(), 'gstdbot'),
        swarm: {
            enabled: process.env.SWARM_ENABLED !== 'false' && process.env.GSTD_MODE !== 'platform',
            maxCPU: parseInt(process.env.GSTD_MAX_CPU || '80'),
            maxRAM: parseInt(process.env.GSTD_MAX_RAM || '70'),
            apiUrl: process.env.GSTD_API_URL || DEFAULT_GSTD_API_URL,
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
            enabled: process.env.GSTD_MEMORY === 'true',
        },
        apps: {
            enabled: false,
            dataDir: join(homedir(), '.config', 'gstdbot', 'apps'),
        },
        tonconnect: {
            enabled: process.env.GSTD_TONCONNECT !== 'false',
            network: (process.env.TON_NETWORK as any) || 'mainnet',
            bridgeUrl: process.env.TON_BRIDGE_URL || 'https://connect.ton.org/bridge',
        },
        mobileNode: {
            enabled: false,
        },
    };

    const file = readSavedNodeConfig(configPath);
    if (file) {
        const configuredApiUrl = process.env.GSTD_API_URL || file.swarm?.apiUrl || defaults.swarm.apiUrl;
        const apiUrl = normalizeGstdApiUrl(configuredApiUrl);
        if (apiUrl !== configuredApiUrl) {
            console.warn('[Config] Migrated the legacy platform API URL to app.gstdtoken.com');
        }
        const merged = {
            ...defaults, ...file,
            version: defaults.version,
            swarm: { ...defaults.swarm, ...file.swarm, apiUrl },
            dashboard: { ...defaults.dashboard, ...file.dashboard },
            memory: { ...defaults.memory, ...file.memory, enabled:process.env.GSTD_MEMORY==='true' },
            apps: { ...defaults.apps, enabled:false },
            mobileNode: {enabled:false},
        };
        return merged;
    }
    const apiUrl = normalizeGstdApiUrl(defaults.swarm.apiUrl);
    if (apiUrl !== defaults.swarm.apiUrl) {
        console.warn('[Config] Migrated the legacy platform API URL to app.gstdtoken.com');
    }
    defaults.swarm.apiUrl = apiUrl;
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
    console.log('  🐝  Local-first AI compute · signed paid work · platform payments');
    console.log('  🐝 ═══════════════════════════════════════════════════');
    console.log('');

    // ── 1. Start Gateway (API + AI Engine) ──────────────────────
    console.log(`  [1/${TOTAL_STEPS}] Starting AI Gateway...`);
    const desiredPort = parseInt(process.env.GSTD_DASHBOARD_PORT || process.env.GSTD_API_PORT || '8080');
    const gateway = new OmegaGateway({
        apiPort: desiredPort,
        swarmUrl: process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
        nodeId: config.nodeId,
    });
    gateway.setAttestorIdentity(identity);
    await gateway.start();
    const actualPort = gateway.getPort();

    // ── 2. Blockchain Manager (GSTD Wallet + Staking) ───────────
    console.log(`  [2/${TOTAL_STEPS}] Node custody and staking disabled...`);
    const blockchain:BlockchainManager|null = inactive<BlockchainManager>();

    // ── 3. Revenue Engine (Unified 6-stream earnings) ───────────
    console.log(`  [3/${TOTAL_STEPS}] Local revenue estimates disabled...`);
    const revenue:RevenueEngine|null = inactive<RevenueEngine>();

    // ── 4. Wallet Manager (Earnings Tracker) ────────────────────
    console.log(`  [4/${TOTAL_STEPS}] Starting wallet manager...`);
    const wallet = new NodeWallet(config);
    await wallet.init();

    // Link public payout address; only accepted paid platform work earns GSTD
    gateway.setWallet(wallet);

    // Connect revenue engine wallet
    const addr = wallet.getAddress();
    if (addr && revenue) revenue.setWalletAddress(addr);

    // Auto-save earnings every 5 minutes
    setInterval(() => { try { wallet.saveEarnings(); } catch (_e) {} }, 5 * 60 * 1000);

    // ── 5. Collective Memory ────────────────────────────────────
    console.log(`  [5/${TOTAL_STEPS}] Connecting collective memory...`);
    const memory = new CollectiveMemory(config);
    await memory.init();

    // ── 6. Swarm Agent (P2P + Task Processing) ──────────────────
    // The signed PlatformLink worker is the only active assignment consumer.
    // Legacy SwarmAgent also polled storage/verification queues and uploaded P2P
    // responses to the platform; keep that research path out of the compute profile.
    const swarm:SwarmAgent|null = inactive<SwarmAgent>();
    console.log('    Signed inference worker active; legacy task consumer and quorum settlement disabled.');

    // ── Node-only subsystems (skipped in platform mode) ──────────
    let resources: ResourceSharing | null = inactive<ResourceSharing>();
    let trainer: SwarmTrainer | null = inactive<SwarmTrainer>();
    let storageVault: StorageVault | null = inactive<StorageVault>();
    let computeMarket: ComputeMarketplace | null = inactive<ComputeMarketplace>();
    let trafficRelay: TrafficRelay | null = inactive<TrafficRelay>();
    let naas: NaaSManager | null = inactive<NaaSManager>();

    console.log('    Compute profile: arbitrary jobs, training, relay, storage markets and NaaS are retired.');

    // Nodes hold no Telegram bot token and run no remote-control channel.
    const remote: RemoteAccessManager | null = inactive<RemoteAccessManager>();
    console.log('    Remote host control and legacy Telegram daemons: disabled (platform bot only).');

    // ── 14. TON Connect + Mobile Node ────────────────────────────
    console.log(`  [14/${TOTAL_STEPS}] Initializing TON Connect...`);
    const tonConnect:TonConnectManager|null = inactive<TonConnectManager>();
    console.log('    Custody signing, staking and local revenue estimates are disabled; use platform payments.');

    let mobileNode: MobileNodeManager | null = null;
    if (config.mobileNode.enabled) {
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
        const apiUrl = process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com';
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
            if (fastifyGateway.isReady()) {
                await fastifyGateway.listen();
                console.log('    ⚡ Fastify engine: initialized (Express compat mode)');
            } else {
                fastifyGateway = null;
                console.log('    HTTP engine: Express (Fastify unavailable)');
            }
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
        const p2pIdentity = await loadOrCreateP2PIdentity();
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

    let uptimeDaemon: UptimeDaemon | null = inactive<UptimeDaemon>();

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
        console.log('  🤖 Telegram:    handled by the separate platform webhook');
        console.log('  🧠 AI Chat:     local installed models only');
        console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 only'));
        console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'public payout address not configured'));
        console.log('  🔗 TON Connect: ' + 'disabled — use platform payments');
        console.log('  📱 Mobile TMA:  ' + (mobileNode ? '✓ active' : 'disabled'));
        console.log('  ── Node Management (remote) ─────────────────────');
        console.log('  📡 Node API:    ✓ /nodes/* endpoints via backend');
        console.log('  🩺 Monitoring:  ✓ Health Monitor + Alerts via backend');
        console.log('  ⚙️  Host control: disabled');
        console.log('  🚫 Swarm:       DISABLED (platform mode)');
        console.log('  🚫 P2P/NaaS:    DISABLED (remote user nodes only)');
        console.log('');
        console.log('  💡 Nodes run on USER machines, not this server!');
        console.log('     Verified installer instructions: https://github.com/gstdcoin/gstdbot#installation');
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
        console.log('  🎓 Training:    ' + (trainer ? ((trainer.getStats()?.activeJobs || 0) > 0 ? 'active' : 'idle') : 'disabled'));
        console.log('  ── Infrastructure ───────────────────────────────');
        console.log('  🐝 Swarm:       ' + (swarm?.isConnected() ? '✓ connected' : 'standalone'));
        console.log('  💰 Wallet:      ' + (wallet.getAddress() || 'public payout address not configured'));
        console.log('  🧠 Memory:      ' + (memory.isConnected() ? 'L1+L2+L3' : 'L1 only'));
        console.log('  🔗 TON Connect: ' + 'disabled — use platform payments');
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
        console.log('  Tasks must be completed and accepted before rewards accrue.');
        console.log('  On-chain settlement is a separate authorized operation.');
        console.log('');

        logActivity('GSTD Node OS v' + config.version + ' booted in ' + bootTime + 's', 'success');

        // Presence alone cannot create reward claims or execute remote NaaS commands.
        console.log('    Rewards: accepted funded work only, 85/10/5; no uptime multiplier.');
    }

    // ── Safe Auto-update: check every hour ─────────────────────────
    // Safety guarantees:
    //   1. Snapshot current HEAD before pulling
    //   2. Build/compile check before restart
    //   3. If build fails → automatic rollback
    //   4. If new version crashes → systemd/PM2 will restart from rolled-back code
    let shuttingDown = false;
    const checkAndUpdate = async () => {
        if (shuttingDown) return;
        try {
            const installDir = config.installDir || join(homedir(), 'gstdbot');
            const update = await updateApprovedNode(installDir, 'main');
            const { previousHash: localHash, updatedHash: remoteHash } = update;
            if (localHash === remoteHash) return; // Already up to date

            // ── STEP 1: Snapshot current state for rollback ────────────
            const snapshotRef = localHash;
            logActivity(`Update available: ${localHash.slice(0,8)} → ${remoteHash.slice(0,8)}`, 'info');
            console.log(`  🔄 Update: ${localHash.slice(0,8)} → ${remoteHash.slice(0,8)}`);
            
            // ── STEP 3: Install deps + build check ─────────────────────
            try {
                const { execSync } = require('child_process');
                execSync('npm install --legacy-peer-deps --include=dev --quiet', { cwd: installDir, timeout: 180000 });

                // Build TypeScript → dist/ (required since pm2 runs dist/index.js)
                execSync('node_modules/.bin/tsc --skipLibCheck', { cwd: installDir, timeout: 90000 });

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
                
                try {
                    rollbackNodeUpdate(installDir, snapshotRef);
                    const { execSync } = require('child_process');
                    execSync('npm install --legacy-peer-deps --include=dev --quiet', { cwd: installDir, timeout: 120000 });
                    execSync('node_modules/.bin/tsc --skipLibCheck', { cwd: installDir, timeout: 90000 });
                    console.log(`  🔙 Rolled back to ${snapshotRef.slice(0,8)}. Node continues running.`);
                    logActivity(`Rollback complete. Running on ${snapshotRef.slice(0,8)}`, 'warn');
                } catch (rollbackErr: any) {
                    console.error(`  ❌ Rollback failed: ${rollbackErr.message}`);
                    logActivity(`Update rollback FAILED; manual recovery required: ${rollbackErr.message}`, 'error');
                }
                
                // Record failed update
                try {
                    const updateLog = join(installDir, '.update-log');
                    const { appendFileSync: appendLog } = require('fs');
                    appendLog(updateLog, `${new Date().toISOString()} | ${snapshotRef.slice(0,8)} → ${remoteHash.slice(0,8)} | FAILED: ${buildErr.message}\n`);
                } catch {}
                
                // Do NOT exit — node continues on old version
            }
        } catch (e: any) {
            logActivity(`Automatic update check failed: ${e.message}`, 'warn');
        }
    };

    // Check for updates after 2 min, then every hour
    const updateStartTimer = process.env.GSTD_AUTO_UPDATE === 'true' ? setTimeout(checkAndUpdate, 2 * 60 * 1000) : undefined;
    const updateInterval = process.env.GSTD_AUTO_UPDATE === 'true' ? setInterval(checkAndUpdate, 60 * 60 * 1000) : undefined;

    // ── Graceful shutdown ───────────────────────────────────────
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = (): Promise<void> => {
        if (shutdownPromise) return shutdownPromise;
        shuttingDown = true;
        shutdownPromise = (async () => {
            const shutdownTimeout = setTimeout(() => {
                console.error('  ❌ Shutdown timed out after 30 seconds.');
                process.exit(1);
            }, 30_000);
            console.log(`\n  🛑 Shutting down GSTD ${isPlatform ? 'Platform' : 'SuperNode'}...`);
            logActivity('Shutdown initiated', 'warn');
            clearTimeout(updateStartTimer);
            clearInterval(updateInterval);
            if (uptimeDaemon) uptimeDaemon.stop();
            if (p2pNode) await p2pNode.stop();
            if (fastifyGateway) await fastifyGateway.close();
            if (mobileNode) await mobileNode.stop();
            if(tonConnect)await tonConnect.close();
            if (naas) await naas.stop();
            if (trafficRelay) await trafficRelay.stop();
            if (computeMarket) await computeMarket.stop();
            if (storageVault) await storageVault.stop();
            if(revenue)await revenue.stop();
            if (trainer) await trainer.stop();
            if (resources) await resources.stop();
            if (remote) await remote.stop();
            await gateway.stop();
            if (swarm) await swarm.stop();
            await memory.close();
            if(blockchain)await blockchain.close();
            console.log('  ✅ Clean shutdown complete.');
            clearTimeout(shutdownTimeout);
            process.exit(0);
        })();
        return shutdownPromise;
    };
    const onShutdownSignal = () => {
        void shutdown().catch(err => {
            console.error('  ❌ Graceful shutdown failed:', err);
            process.exitCode = 1;
        });
    };
    process.on('SIGINT', onShutdownSignal);
    process.on('SIGTERM', onShutdownSignal);
}

main().catch((err) => {
    console.error('  ❌ Fatal error:', err);
    process.exit(1);
});
