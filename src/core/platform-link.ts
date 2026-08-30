/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Platform Link (Heartbeat + Registration)
 * 
 * Maintains persistent connection to GSTD platform:
 *  - Registers node on startup with capabilities
 *  - Sends heartbeat every 60s with status
 *  - Reports resource availability for swarm tasks
 *  - Syncs earnings and rewards
 *  - Handles platform commands (update, restart, configure)
 * ═══════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { verifyPlatformCommand, isStaleCommand, type PlatformCommand } from '../lib/platform-auth.js';
import { isRegistered } from '../lib/model-registry.js';

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
    private registered = false;
    private lastHeartbeat: Date | null = null;
    private failCount = 0;
    private statsCollector: (() => Partial<HeartbeatData['stats']>) | null = null;
    private capabilitiesProvider: (() => NodeCapabilities) | null = null;
    private p2pPeerId: string = '';
    private p2pMultiaddrs: string[] = [];

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

    async start(intervalMs = 60000) {
        // Delay registration briefly so wallet.init() completes first
        // (gateway.start() fires this before index.ts reaches wallet init at step 4)
        if (!this.walletAddress) {
            await new Promise(resolve => setTimeout(resolve, 6000));
        }
        await this.register();

        // Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), intervalMs);
        console.log(`  🔗 Platform Link: heartbeat every ${intervalMs / 1000}s → ${this.platformUrl}`);
    }

    private readTunnelUrl(): string {
        try { return readFileSync('/tmp/gstd_tunnel_url.txt', 'utf8').trim(); } catch { return ''; }
    }

    private async register() {
        try {
            const caps = this.capabilitiesProvider?.() || {};
            const tunnelUrl = this.readTunnelUrl() || process.env.GSTD_PUBLIC_URL || '';
            const models: string[] = (caps as any).models || [];
            const resp = await fetch(`${this.platformUrl}/api/v1/nodes/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                },
                body: JSON.stringify({
                    node_id:      this.nodeId,
                    name:         process.env.NODE_NAME || this.nodeId,
                    wallet:       this.walletAddress,
                    public_url:   tunnelUrl,
                    capabilities: models,
                    node_version: this.version,
                    specs: {
                        node_id: this.nodeId,
                        version: this.version,
                        platform: process.platform,
                        arch: process.arch,
                        capabilities: caps,
                    },
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) {
                const body = await resp.text().catch(() => '');
                if (resp.status === 402 && body.includes('DEPLOYMENT_DISABLED')) {
                    console.warn('[PlatformLink] DEPLOYMENT_DISABLED — registration skipped, running standalone.');
                    return;
                }
                throw new Error(`Register failed: ${resp.status}`);
            }
            const data: any = await resp.json();
            this.registered = true;
            this.failCount = 0;
            this.emit('registered', data);
            console.log(`  ✅ Platform Link: node registered (${this.nodeId})`);
        } catch (e: any) {
            this.failCount++;
            this.emit('register:error', { error: e.message, failCount: this.failCount });
            // Retry on next heartbeat
        }
    }

    private async sendHeartbeat() {
        const stats = this.statsCollector?.() || {};
        const caps  = this.capabilitiesProvider?.() || {};
        const models: string[] = (caps as any).models || [];

        // Read tunnel URL for locality-aware routing
        const tunnelUrl = (() => {
            try { return readFileSync('/tmp/gstd_tunnel_url.txt', 'utf8').trim(); } catch { return ''; }
        })() || process.env.GSTD_PUBLIC_URL || '';

        try {
            const resp = await fetch(`${this.platformUrl}/api/v1/nodes/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                    'X-Node-Id': this.nodeId,
                },
                body: JSON.stringify({
                    node_id:         this.nodeId,
                    wallet_address:  this.walletAddress,
                    node_name:       process.env.NODE_NAME || this.nodeId,
                    node_version:    this.version,
                    uptime_hours:    Math.round(process.uptime() / 3600),
                    queries_served:  stats.queryCount || 0,
                    capabilities:    models,
                    models_loaded:   models.filter(m => isRegistered(m)),
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
            this.failCount = 0;
            this.emit('heartbeat', { ...data, sentAt: this.lastHeartbeat });

            if (data.commands?.length > 0) {
                this._processCommands(data.commands as unknown[]);
            }
        } catch (e: any) {
            this.failCount++;
            this.emit('heartbeat:error', { error: e.message, failCount: this.failCount });

            // Re-register if too many failures
            if (this.failCount >= 5) {
                this.registered = false;
                await this.register();
            }
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

    startTaskLoop(intervalMs = 5000) {
        this.taskTimer = setInterval(() => this.pollAndProcess(), intervalMs);
        console.log(`  ⚡ Task loop: polling every ${intervalMs / 1000}s`);
    }

    private async pollAndProcess() {
        if (this.tasksBusy || !this.registered) return;
        this.tasksBusy = true;
        try {
            const resp = await fetch(
                `${this.platformUrl}/api/v1/tasks/poll?node_id=${encodeURIComponent(this.nodeId)}`,
                { signal: AbortSignal.timeout(8000) }
            );
            if (!resp.ok) return;
            const data: any = await resp.json();
            if (!data.task?.task_id) return;

            const { task_id, model = 'llama3.2:3b', prompt = '' } = data.task;
            const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');

            let messages: any[];
            try { messages = JSON.parse(prompt); } catch { messages = [{ role: 'user', content: prompt }]; }
            if (!Array.isArray(messages)) messages = [{ role: 'user', content: prompt }];

            try {
                const aiResp = await fetch(`${ollamaUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model, messages, stream: false }),
                    signal: AbortSignal.timeout(90000),
                });
                const aiData: any = aiResp.ok ? await aiResp.json() : null;
                const content = aiData?.choices?.[0]?.message?.content || '';

                await fetch(`${this.platformUrl}/api/v1/tasks/complete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task_id,
                        node_id: this.nodeId,
                        result: content || null,
                        error: content ? null : 'empty response',
                    }),
                    signal: AbortSignal.timeout(10000),
                });

                if (content) {
                    console.log(`  ✅ Task ${task_id} completed (${model}, ${content.length} chars)`);
                    this.emit('task:completed', { task_id, model });
                }
            } catch (err: any) {
                await fetch(`${this.platformUrl}/api/v1/tasks/complete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id, node_id: this.nodeId, error: err.message }),
                    signal: AbortSignal.timeout(5000),
                }).catch(() => {});
            }
        } catch { /* ignore poll errors */ } finally {
            this.tasksBusy = false;
        }
    }

    getStatus() {
        return {
            registered: this.registered,
            lastHeartbeat: this.lastHeartbeat?.toISOString() || null,
            failCount: this.failCount,
            platformUrl: this.platformUrl,
            nodeId: this.nodeId,
        };
    }

    stop() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.taskTimer) clearInterval(this.taskTimer);
    }
}
