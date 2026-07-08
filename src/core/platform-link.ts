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
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function readOracleTaskCount(): number {
    try {
        const logPath = join(homedir(), 'trading_bot', 'data', 'oracle_log.jsonl');
        if (!existsSync(logPath)) return 0;
        return readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim()).length;
    } catch { return 0; }
}

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

    constructor(config: { platformUrl: string; nodeId: string; walletAddress: string; version: string }) {
        super();
        this.platformUrl = config.platformUrl;
        this.nodeId = config.nodeId;
        this.walletAddress = config.walletAddress;
        this.version = config.version;
    }

    setStatsCollector(fn: () => Partial<HeartbeatData['stats']>) { this.statsCollector = fn; }
    setCapabilitiesProvider(fn: () => NodeCapabilities) { this.capabilitiesProvider = fn; }
    setWalletAddress(address: string) { this.walletAddress = address; }

    async start(intervalMs = 60000) {
        // Register
        await this.register();

        // Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), intervalMs);
        console.log(`  🔗 Platform Link: heartbeat every ${intervalMs / 1000}s → ${this.platformUrl}`);
    }

    private async register() {
        try {
            const caps = this.capabilitiesProvider?.() || {};
            const resp = await fetch(`${this.platformUrl}/api/v1/nodes/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': this.walletAddress,
                },
                body: JSON.stringify({
                    name: process.env.NODE_NAME || this.nodeId,
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
            if (!resp.ok) throw new Error(`Register failed: ${resp.status}`);
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
                    tasks_completed: readOracleTaskCount(),
                    gstd_earned:     stats.tasksCompleted ? stats.tasksCompleted * 0.00095 : 0,
                    capabilities:    models,
                    models_loaded:   models,
                    mode:            'node',
                    ...(tunnelUrl && { node_url: tunnelUrl }),
                }),
                signal: AbortSignal.timeout(10000),
            });

            if (!resp.ok) throw new Error(`Heartbeat ${resp.status}`);
            const data: any = await resp.json();
            this.lastHeartbeat = new Date();
            this.failCount = 0;
            this.emit('heartbeat', { ...data, sentAt: this.lastHeartbeat });

            // Handle platform commands
            if (data.commands?.length > 0) {
                for (const cmd of data.commands) {
                    this.emit('command', cmd);
                }
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
    }
}
