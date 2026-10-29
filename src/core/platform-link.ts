import { readTunnelUrl } from '../lib/tunnel-url.js';
import {isCloudModel,localModelOptions} from '../lib/local-model-options.js';
import {withComputeSlot,computeCapacityAvailable} from '../security/compute.js';
/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Platform Link (Heartbeat + Registration)
 * 
 * Maintains persistent connection to GSTD platform:
 *  - Registers node on startup with capabilities
 *  - Sends heartbeat every 120s with status
 *  - Reports resource availability for swarm tasks
 *  - Syncs earnings and rewards
 *  - Handles platform commands (update, restart, configure)
 * ═══════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { cpus, totalmem } from 'os';
import { verifyPlatformCommand, isStaleCommand, type PlatformCommand } from '../lib/platform-auth.js';
import { loadOrCreateAttestorIdentity, signPeerRequest, signWithIdentity, type AttestorIdentity } from '../p2p/identity.js';

export interface NodeCapabilities {
    models: string[];
    channels: string[];
    apps: number;
    memory: boolean;
    openclaw: boolean;
    dln: boolean;
    maxConcurrentTasks: number;
}

export interface HeartbeatData {
    node_id: string;
    version: string;
    uptime: number;
    wallet: string;
    status: 'online' | 'busy' | 'maintenance';
    capabilities: NodeCapabilities;
    stats: {
        tasksCompleted: number;
        tasksActive: number;
        queryCount: number;
        avgLatencyMs: number;
        memoryEntries: number;
        wsClients: number;
    };
    resources: {
        cpuUsage: number;
        memoryUsage: number;
        diskFree: number;
    };
}

export class PlatformLink extends EventEmitter {
    private platformUrl: string;
    private nodeId: string;
    private walletAddress: string;
    private version: string;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private tunnelTimer: NodeJS.Timeout | null = null;
    private heartbeatInFlight: Promise<void> | null = null;
    private taskPollInFlight: Promise<void> | null = null;
    private registrationRetryTimer: NodeJS.Timeout | null = null;
    private registrationRetryAttempt = 0;
    private registered = false;
    private lastHeartbeat: Date | null = null;
    private failCount = 0;
    private statsCollector: (() => Partial<HeartbeatData['stats']>) | null = null;
    private capabilitiesProvider: (() => NodeCapabilities) | null = null;
    private p2pPeerId: string = '';
    private p2pMultiaddrs: string[] = [];
    private nodePubkey: string = '';
    private identity: AttestorIdentity | null = null;
    private lastTaskErrorLog = 0;
    private lastTaskPoll: Date | null = null;
    private lastTaskCompletion: Date | null = null;
    private taskResultsSubmitted = 0;
    private lastTaskErrorPhase: string | null = null;
    private lastHeartbeatError: string | null = null;
    private lastHeartbeatErrorLog = 0;

    constructor(config: { platformUrl: string; nodeId: string; walletAddress: string; version: string }) {
        super();
        this.platformUrl = config.platformUrl;
        this.nodeId = config.nodeId;
        this.walletAddress = config.walletAddress;
        this.version = config.version;
    }

    /** Called once P2P mesh starts — so heartbeats include bootstrap-able peer data */
    setP2PIdentity(peerId: string, multiaddrs: string[]) {
        this.p2pPeerId   = peerId;
        this.p2pMultiaddrs = multiaddrs;
    }

    setStatsCollector(fn: () => Partial<HeartbeatData['stats']>) { this.statsCollector = fn; }
    setCapabilitiesProvider(fn: () => NodeCapabilities) { this.capabilitiesProvider = fn; }
    setWalletAddress(address: string) { this.walletAddress = address; }
    setNodePubkey(pubkeyHex: string) { this.nodePubkey = pubkeyHex; }
    setIdentity(identity: AttestorIdentity) { this.identity = identity; this.nodePubkey = identity.pubkeyHex; }

    /** Fresh Ed25519 signature headers proving this request comes from the key bound to node_id. */
    private authHeaders(): Record<string, string> {
        if (!this.identity && process.env.NODE_ENV !== 'test') {
            try { this.setIdentity(loadOrCreateAttestorIdentity()); } catch { /* unsigned fallback */ }
        }
        return this.identity ? signPeerRequest(this.identity, this.nodeId) : {};
    }

    async rewardWallet():Promise<{address:string;revision:number;updated_at:string}|null>{
        const r=await fetch(this.platformUrl+'/api/v1/nodes/payout-wallet?node_id='+encodeURIComponent(this.nodeId),
            {headers:this.authHeaders(),signal:AbortSignal.timeout(20000)});
        if(!r.ok)throw Error('payout_service_unavailable');
        return ((await r.json()) as any).payout;
    }
    async bindRewardWallet(address:string,revision:number){
        this.authHeaders(); // Ensure the persistent node identity is loaded.
        if(!this.identity)throw Error('node_identity_unavailable');
        const timestamp=Date.now();
        const message=createHash('sha256').update(JSON.stringify(['gstd:payout:v1',this.nodeId,address,revision,timestamp])).digest();
        const signature=signWithIdentity(this.identity,message).toString('hex');
        const r=await fetch(this.platformUrl+'/api/v1/nodes/payout-wallet',{
            method:'POST',headers:{'Content-Type':'application/json',...this.authHeaders()},
            body:JSON.stringify({node_id:this.nodeId,address,revision,timestamp,signature}),signal:AbortSignal.timeout(25000)});
        const data:any=await r.json();
        if(!r.ok)throw Error(data.error||'payout_service_unavailable');
        return data;
    }

    async start(intervalMs = 120_000) {
        // Delay registration briefly so wallet.init() completes first
        // (gateway.start() fires this before index.ts reaches wallet init at step 4)
        if (!this.walletAddress) {
            await new Promise(resolve => setTimeout(resolve, 6000));
        }
        let observedTunnelUrl = this.readTunnelUrl();
        await this.register();

        // Local file checks cost no platform requests. Announce a changed tunnel
        // once, rather than routing to a dead URL until the next regular heartbeat.
        this.tunnelTimer = setInterval(() => {
            const current = this.readTunnelUrl();
            if (!current || current === observedTunnelUrl) return;
            observedTunnelUrl = current;
            void this.runHeartbeat();
        }, 5000);
        this.tunnelTimer.unref();

        // Start heartbeat loop
        this.heartbeatTimer = setInterval(() => { void this.runHeartbeat(); }, intervalMs);
        console.log(`  🔗 Platform Link: heartbeat every ${intervalMs / 1000}s → ${this.platformUrl}`);
    }

    private readTunnelUrl(): string {
        return readTunnelUrl();
    }

    async syncRegistration(): Promise<boolean> {
        return this.register();
    }

    private async register(): Promise<boolean> {
        try {
            if (!this.walletAddress.trim()) {
                throw new Error('A wallet address is required before registering the node');
            }
            const caps = this.capabilitiesProvider?.() || {};
            const tunnelUrl = this.readTunnelUrl() || process.env.GSTD_PUBLIC_URL || '';
            const models: string[] = (caps as any).models || [];
            const resp = await fetch(`${this.platformUrl}/api/v1/nodes/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                    ...this.authHeaders(),
                },
                body: JSON.stringify({
                    node_id:      this.nodeId,
                    name:         process.env.NODE_NAME || this.nodeId,
                    wallet:       this.walletAddress,
                    public_url:   tunnelUrl,
                    node_url:     tunnelUrl,
                    capabilities: models,
                    node_version: this.version,
                    node_pubkey:  this.nodePubkey || undefined,
                    specs: {
                        node_id: this.nodeId,
                        version: this.version,
                        platform: process.platform,
                        arch: process.arch,
                        mode: 'node',
                        cpu_cores: cpus().length,
                        ram_total_mb: Math.round(totalmem() / 1024 / 1024),
                        capabilities: caps,
                    },
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) {
                const body = await resp.text().catch(() => '');
                if (resp.status === 402 && body.includes('DEPLOYMENT_DISABLED')) {
                    console.warn('[PlatformLink] DEPLOYMENT_DISABLED — registration skipped, running standalone.');
                    return false;
                }
                throw new Error(`Register failed: ${resp.status}`);
            }
            const data: any = await resp.json();
            this.registered = true;
            this.failCount = 0;
            this.registrationRetryAttempt = 0;
            if (this.registrationRetryTimer) clearTimeout(this.registrationRetryTimer);
            this.registrationRetryTimer = null;
            this.emit('registered', data);
            console.log(`  ✅ Platform Link: node registered (${this.nodeId})`);
            return true;
        } catch (e: any) {
            this.failCount++;
            this.emit('register:error', { error: e.message, failCount: this.failCount });
            this.scheduleRegistrationRetry();
            return false;
        }
    }

    private scheduleRegistrationRetry(): void {
        if (this.registered || this.registrationRetryTimer) return;
        const delayMs = Math.min(1000 * 2 ** this.registrationRetryAttempt, 60_000);
        this.registrationRetryAttempt++;
        this.registrationRetryTimer = setTimeout(() => {
            this.registrationRetryTimer = null;
            void this.register();
        }, delayMs);
    }

    private async sendHeartbeat() {
        if (!this.registered) {
            await this.register();
            if (!this.registered) return;
        }

        const stats = this.statsCollector?.() || {};
        const caps  = this.capabilitiesProvider?.() || {};
        const models: string[] = (caps as any).models || [];

        // Read tunnel URL for locality-aware routing
        const tunnelUrl = this.readTunnelUrl() || process.env.GSTD_PUBLIC_URL || '';

        try {
            const resp = await fetch(`${this.platformUrl}/api/v1/nodes/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                    ...this.authHeaders(),
                    'X-Node-Id': this.nodeId,
                },
                body: JSON.stringify({
                    node_id:         this.nodeId,
                    wallet_address:  this.walletAddress,
                    node_name:       process.env.NODE_NAME || this.nodeId,
                    node_version:    this.version,
                    platform: process.platform, arch: process.arch,
                    cpu_cores: cpus().length, ram_mb: Math.round(totalmem()/1024/1024),
                    uptime_hours:    Math.round(process.uptime() / 3600),
                    queries_served:  stats.queryCount || 0,
                    capabilities:    models,
                    mode:            'node',
                    ...(tunnelUrl && { node_url: tunnelUrl }),
                    ...(this.p2pPeerId && { peer_id: this.p2pPeerId }),
                    ...(this.p2pMultiaddrs.length && { multiaddrs: this.p2pMultiaddrs }),
                }),
                // Platform's /nodes/heartbeat has been observed taking ~18-22s in
                // production (same root cause already fixed in uptime_daemon.ts) --
                // 10s was too tight and caused a continuous fail/re-register loop.
                signal: AbortSignal.timeout(25000),
            });

            if (!resp.ok) {
                const body = await resp.text().catch(() => '');
                if (resp.status === 402 && body.includes('DEPLOYMENT_DISABLED')) {
                    // Platform intentionally disabled — stop heartbeating until restart
                    console.warn('[PlatformLink] DEPLOYMENT_DISABLED — heartbeats suspended.');
                    this.stop();
                    return;
                }
                throw new Error(`Heartbeat ${resp.status}`);
            }
            const data: any = await resp.json();
            this.lastHeartbeat = new Date();
            this.lastHeartbeatError = null;
            this.failCount = 0;
            if (data.uptime_reward > 0) {
                console.log(`  💰 Uptime reward: +${data.uptime_reward.toFixed(6)} GSTD`);
            }
            this.emit('heartbeat', { ...data, sentAt: this.lastHeartbeat });

            if (data.commands?.length > 0) {
                this._processCommands(data.commands as unknown[]);
            }
        } catch (e: any) {
            this.failCount++;
            const http = /^Heartbeat (\d{3})$/.exec(String(e?.message || ''));
            const code = http ? 'http_' + http[1] : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network_error';
            if (code !== this.lastHeartbeatError || Date.now() - this.lastHeartbeatErrorLog >= 300_000) {
                console.warn('[PlatformLink] Heartbeat unavailable: ' + code);
                this.lastHeartbeatErrorLog = Date.now();
            }
            this.lastHeartbeatError = code;
            this.emit('heartbeat:error', { error: code, failCount: this.failCount });

            // Re-register if too many failures
            if (this.failCount >= 5) {
                this.registered = false;
                await this.register();
            }
        }
    }

    private async runHeartbeat(): Promise<void> {
        if (this.heartbeatInFlight) return;
        const operation = this.sendHeartbeat();
        this.heartbeatInFlight = operation;
        try {
            await operation;
        } finally {
            if (this.heartbeatInFlight === operation) this.heartbeatInFlight = null;
        }
    }

    _processCommands(
        commands: unknown[],
        verifyFn: (cmd: PlatformCommand) => boolean = verifyPlatformCommand,
    ): void {
        for (const raw of commands) {
            const cmd = raw as Partial<PlatformCommand>;
            if (!cmd.sig) {
                console.warn(`[platform-auth] command '${cmd.type ?? '?'}' rejected — unsigned`);
                continue;
            }
            if (isStaleCommand(cmd.timestamp ?? 0)) {
                console.warn(`[platform-auth] command '${cmd.type ?? '?'}' rejected — stale timestamp`);
                continue;
            }
            if (!verifyFn(cmd as PlatformCommand)) {
                console.warn(`[platform-auth] command '${cmd.type ?? '?'}' rejected — invalid signature`);
                continue;
            }
            this.emit('command', raw);
        }
    }

    // ── Task poll loop ────────────────────────────────────────────────────────
    // Polls platform for pending AI tasks, runs them on local Ollama, reports result.
    // Nodes earn TASK_FEE_GSTD per completed task recorded in D1.

    private taskTimer: NodeJS.Timeout | null = null;
    private tasksBusy = false;
    private taskLoopEnabled = false;
    private idlePollMs = 30_000;
    private nextTaskPollMs = 30_000;
    private taskPollFailures = 0;
    private taskBackoffUntil = 0;

    private scheduleTaskPoll() {
        if (!this.taskLoopEnabled) return;
        if (this.taskTimer) clearTimeout(this.taskTimer);
        this.taskTimer = setTimeout(async () => {
            this.taskTimer = null;
            await this.runTaskPoll();
            this.scheduleTaskPoll();
        }, this.nextTaskPollMs);
    }

    /** A real chat request wakes the existing worker without permanent fast polling. */
    async wakeTaskLoop(): Promise<void> {
        if (!this.taskLoopEnabled || Date.now() < this.taskBackoffUntil) return;
        if (this.taskTimer) clearTimeout(this.taskTimer);
        this.taskTimer = null;
        await this.runTaskPoll();
        this.scheduleTaskPoll();
    }


    // Polling is the supported task-delivery path; retry frequently enough to keep
    // queue latency low while staying within the platform's per-node rate limit.
    startTaskLoop(intervalMs = 30_000) {
        this.taskLoopEnabled = true;
        this.idlePollMs = Math.max(5_000, intervalMs);
        this.nextTaskPollMs = this.idlePollMs;
        this.scheduleTaskPoll();
        console.log(`  Task loop: idle ${this.idlePollMs / 1000}s; chat wakes worker immediately`);
    }

    private async runTaskPoll(): Promise<void> {
        if (this.taskPollInFlight) return;
        const operation = this.pollAndProcess();
        this.taskPollInFlight = operation;
        try {
            await operation;
        } finally {
            if (this.taskPollInFlight === operation) this.taskPollInFlight = null;
        }
    }

    private async pollAndProcess() {
        if (this.tasksBusy || !this.registered || !computeCapacityAvailable()) return;
        this.tasksBusy = true;
        let phase = 'poll';
        try {
            // The legacy Worker exposes GET polling; the current app uses POST.
            // Select explicitly rather than downgrading on auth/server errors.
            const legacyPoll = process.env.GSTD_TASK_POLL_METHOD === 'GET';
            const pollUrl = `${this.platformUrl}/api/v1/tasks/poll`
                + (legacyPoll ? `?node_id=${encodeURIComponent(this.nodeId)}` : '');
            const resp = await fetch(
                pollUrl,
                {
                    method: legacyPoll ? 'GET' : 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Wallet-Address': this.walletAddress,
                        ...this.authHeaders(),
                    },
                    body: legacyPoll ? undefined : JSON.stringify({
                        node_id: this.nodeId,
                        capabilities: ['inference', ...(this.capabilitiesProvider?.().models || [])],
                        supported_task_kinds: ['inference'],
                        resources: {},
                    }),
                    signal: AbortSignal.timeout(25000),
                }
            );
            if (!resp.ok) {
                const retryAfter = Number(resp.headers.get('retry-after'));
                if ((resp.status === 429 || resp.status >= 500) && Number.isFinite(retryAfter) && retryAfter > 0) {
                    this.taskBackoffUntil = Date.now() + Math.min(retryAfter * 1000, 15 * 60_000);
                }
                throw new Error(`Task poll failed: HTTP ${resp.status}`);
            }
            const data: any = await resp.json();
            this.lastTaskPoll = new Date();
            this.lastTaskErrorPhase = null;
            this.taskPollFailures = 0;
            this.nextTaskPollMs = this.idlePollMs;
            if (!data.task?.task_id) return;
            this.nextTaskPollMs = 5_000;

            const task = data.task;
            const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
            const task_id: string = task.task_id;
            const requestedModel = payload.model ?? task.model;
            // Only an absent model or explicit auto opts into this node's configured default.
            const model = requestedModel == null || requestedModel === 'auto'
                ? (process.env.GSTD_DEFAULT_MODEL || 'llama3.2:3b') : requestedModel;
            if (typeof model !== 'string' || !model.trim() || model === 'auto') throw new Error('invalid_task_model');
            if(isCloudModel(model))throw Error('cloud_models_disabled');
            const prompt: unknown = payload.prompt ?? task.prompt ?? '';
            const taskMessages: unknown = payload.messages ?? task.messages;
            if (typeof prompt !== 'string' || (!prompt.trim() && !Array.isArray(taskMessages))) {
                throw new Error(`Task ${task_id} has no inference prompt`);
            }
            const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');

            let messages: any[];
            if (Array.isArray(taskMessages)) {
                messages = taskMessages;
            } else {
                try { messages = JSON.parse(prompt); } catch { messages = [{ role: 'user', content: prompt }]; }
            }
            if (!Array.isArray(messages)) messages = [{ role: 'user', content: prompt }];

            const maxTokens = payload.max_tokens ?? task.max_tokens;
            const temperature = payload.temperature ?? task.temperature;
            phase = 'inference';
            const inferenceStarted = Date.now();
            const aiData:any = await withComputeSlot(async()=>{
            const aiResp = await fetch(`${ollamaUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model, messages, ...localModelOptions(model), stream: false, keep_alive: -1,
                    options: { num_ctx: Math.max(512, Math.min(8192, Number(process.env.GSTD_OLLAMA_CONTEXT) || 2048)),
                    ...(typeof maxTokens === 'number' && Number.isInteger(maxTokens) && maxTokens > 0
                        ? { num_predict: Math.min(maxTokens, 8192) } : { num_predict: 256 }),
                    ...(typeof temperature === 'number' && Number.isFinite(temperature)
                        && temperature >= 0 && temperature <= 2 ? { temperature } : {}),
                    },
                }),
                signal: AbortSignal.timeout(90000),
            });
            if (!aiResp.ok) throw new Error(`Local inference failed: HTTP ${aiResp.status}`);
            return await aiResp.json();
            });
            // The worker queue must enforce the same exact-model contract as chat.
            const canonical = (id: string) => id.split('/').pop()!.includes(':') ? id : id + ':latest';
            if (typeof aiData?.model !== 'string' || canonical(aiData.model) !== canonical(model)) {
                throw new Error('requested_model_unavailable');
            }
            const actualModel: string = aiData.model;
            const content = aiData?.message?.content;
            if (typeof content !== 'string' || !content.trim()) {
                throw new Error('Local inference returned an empty response');
            }

            phase = 'completion';
            const completion = await fetch(`${this.platformUrl}/api/v1/tasks/complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                    ...this.authHeaders(),
                },
                body: JSON.stringify({ task_id, node_id: this.nodeId, result: content, model: actualModel, latency_ms: Math.max(0, Date.now() - inferenceStarted) }),
                signal: AbortSignal.timeout(25000),
            });
            if (!completion.ok) throw new Error(`Task completion failed: HTTP ${completion.status}`);

            this.lastTaskCompletion = new Date();
            this.taskResultsSubmitted++;
            console.log(`  ✅ Task ${task_id} completed (${actualModel}, ${content.length} chars)`);
            this.emit('task:completed', { task_id, model: actualModel });
        } catch (err: any) {
            // Expose only the phase, never a prompt or upstream response body.
            this.lastTaskErrorPhase = phase;
            if (Date.now() - this.lastTaskErrorLog > 60_000) {
                this.lastTaskErrorLog = Date.now();
                console.warn(`[PlatformLink] Task poll or execution failed: ${err.message}`);
            }
            if (phase === 'inference') {
                // Slow local compute is not a platform outage or a quota signal.
                this.nextTaskPollMs = this.idlePollMs;
                this.taskBackoffUntil = 0;
            } else {
            this.taskPollFailures++;
            this.nextTaskPollMs = Math.max(
                Math.min(60_000 * 2 ** Math.min(this.taskPollFailures - 1, 3), 300_000),
                this.taskBackoffUntil - Date.now(),
            );
            this.taskBackoffUntil = Date.now() + this.nextTaskPollMs;
            }
            this.emit('task:error', { error: err.message, nodeId: this.nodeId });
        } finally {
            this.tasksBusy = false;
        }
    }

    getStatus() {
        let publicUrl: string | null = null;
        try {
            const url = new URL(this.readTunnelUrl() || process.env.GSTD_PUBLIC_URL || '');
            const host = url.hostname.toLowerCase();
            if (url.protocol === 'https:' && !url.username && !url.password && !url.port
                && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local')
                && !host.endsWith('.internal') && !host.includes(':') && !/^\d+(?:\.\d+){3}$/.test(host)) publicUrl = url.origin;
        } catch { /* No usable public route is configured. Never expose URL credentials. */ }
        return {
            registered: this.registered,
            walletAddress: this.walletAddress,
            lastHeartbeat: this.lastHeartbeat?.toISOString() || null,
            lastHeartbeatError: this.lastHeartbeatError,
            failCount: this.failCount,
            platformUrl: this.platformUrl,
            nodeId: this.nodeId,
            publicUrl,
            worker: {
                enabled: this.taskLoopEnabled,
                busy: this.tasksBusy,
                lastPoll: this.lastTaskPoll?.toISOString() || null,
                lastResultSubmitted: this.lastTaskCompletion?.toISOString() || null,
                resultsSubmitted: this.taskResultsSubmitted,
                lastErrorPhase: this.lastTaskErrorPhase,
                retryAt: this.taskBackoffUntil > Date.now() ? new Date(this.taskBackoffUntil).toISOString() : null,
            },
        };
    }

    async stop(): Promise<void> {
        this.taskLoopEnabled = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.tunnelTimer) clearInterval(this.tunnelTimer);
        if (this.taskTimer) clearTimeout(this.taskTimer);
        if (this.registrationRetryTimer) clearTimeout(this.registrationRetryTimer);
        this.heartbeatTimer = null;
        this.tunnelTimer = null;
        this.taskTimer = null;
        this.registrationRetryTimer = null;
        await Promise.all(
            [this.heartbeatInFlight, this.taskPollInFlight].filter(
                (operation): operation is Promise<void> => operation !== null,
            ),
        );
    }
}
