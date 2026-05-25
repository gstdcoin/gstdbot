/**
 * GSTD NaaS — Proof-of-Uptime Daemon
 *
 * Lightweight background service that:
 * 1. Sends regular heartbeats to platform backend
 * 2. Reports container health (running/stopped/error)
 * 3. Measures and reports RPC latency for each chain
 * 4. Receives Age Multiplier from server
 * 5. Receives NaaS commands (deploy/stop/restart containers)
 */

import { execSync } from 'child_process';
import { cpus, totalmem, freemem, loadavg } from 'os';
import { readFileSync, existsSync } from 'fs';
import { logActivity } from '../gateway/server.js';

const HEARTBEAT_INTERVAL_MS = 30_000; // Every 30 seconds
const PLATFORM_URL = process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com';

export interface ContainerStatus {
    name: string;
    image: string;
    status: 'running' | 'stopped' | 'error';
    uptime_seconds: number;
    chain?: string;
    rpc_port?: number;
    rpc_latency_ms?: number;
}

export interface UptimeHeartbeat {
    node_id: string;
    wallet: string;
    timestamp: number;
    tier: 'light' | 'standard' | 'archive';
    version: string;
    containers: ContainerStatus[];
    hardware: {
        cpu_cores: number;
        cpu_usage: number;
        ram_total_gb: number;
        ram_used_gb: number;
        disk_total_gb: number;
        disk_used_gb: number;
        disk_iops: number;
        ping_ms: number;
        gpu?: { model: string; vram_mb: number };
        bandwidth_mbps?: number;
        chains?: string; // comma-separated running chains for backend matching
        rpc_endpoint?: string;
    };
    age_multiplier?: number;
}

export class UptimeDaemon {
    private nodeId: string;
    private walletAddress: string;
    private timer: NodeJS.Timeout | null = null;
    private currentMultiplier: number = 1.0;
    private cachedIOPS: number = 0;
    private cachedPing: number = 0;
    private heartbeatCount: number = 0;

    constructor(nodeId: string, walletAddress: string = '') {
        this.nodeId = nodeId;
        this.walletAddress = walletAddress;
    }

    setWallet(address: string): void {
        this.walletAddress = address;
    }

    getMultiplier(): number {
        return this.currentMultiplier;
    }

    start(): void {
        if (this.timer) return;

        // Initial hardware benchmarks (run once)
        this.cachedIOPS = this.measureDiskIOPS();
        this.cachedPing = this.measurePlatformPing();

        // Send first heartbeat immediately
        this.sendHeartbeat().catch(() => {});

        // Then every 30 seconds
        this.timer = setInterval(() => {
            this.sendHeartbeat().catch(err => {
                if (this.heartbeatCount % 10 === 0) {
                    logActivity(`Heartbeat failed: ${err.message}`, 'warn');
                }
            });
        }, HEARTBEAT_INTERVAL_MS);

        logActivity(`Uptime Daemon started (heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s)`, 'success');
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logActivity('Uptime Daemon stopped', 'info');
        }
    }

    // ─── Heartbeat ───────────────────────────────────────────

    private async sendHeartbeat(): Promise<void> {
        this.heartbeatCount++;
        const containers = this.getContainerStatuses();
        const runningChains = containers
            .filter(c => c.status === 'running' && c.chain)
            .map(c => c.chain)
            .join(',');

        const cpuInfo = cpus();
        const totalRam = totalmem();
        const freeRam = freemem();
        const disk = this.getDiskUsage();

        // Public node URL for P2P discovery — read from tunnel or env
        const tunnelUrl = this.getTunnelUrl();
        const multiaddrs = tunnelUrl ? [tunnelUrl] : [];

        const heartbeat: UptimeHeartbeat & { wallet_address?: string; multiaddrs?: string[]; node_url?: string } = {
            node_id: this.nodeId,
            wallet: this.walletAddress,
            wallet_address: this.walletAddress,
            timestamp: Date.now(),
            tier: this.classifyTier(cpuInfo.length, totalRam / (1024 ** 3), this.cachedIOPS),
            version: '3.4.0',
            containers,
            multiaddrs,
            ...(tunnelUrl && { node_url: tunnelUrl }),
            hardware: {
                cpu_cores: cpuInfo.length,
                cpu_usage: Math.round(loadavg()[0] / cpuInfo.length * 100),
                ram_total_gb: Math.round(totalRam / (1024 ** 3) * 10) / 10,
                ram_used_gb: Math.round((totalRam - freeRam) / (1024 ** 3) * 10) / 10,
                disk_total_gb: disk.total,
                disk_used_gb: disk.used,
                disk_iops: this.cachedIOPS,
                ping_ms: this.cachedPing,
                chains: runningChains,
                rpc_endpoint: tunnelUrl || undefined,
            },
        };

        try {
            const resp = await fetch(`${PLATFORM_URL}/api/v1/nodes/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(heartbeat),
                signal: AbortSignal.timeout(10000),
            });

            if (resp.ok) {
                const data = await resp.json() as any;
                // Server may return updated multiplier and commands
                if (data.age_multiplier !== undefined) {
                    this.currentMultiplier = data.age_multiplier;
                }
                if (data.commands && Array.isArray(data.commands)) {
                    for (const cmd of data.commands) {
                        this.executeNaaSCommand(cmd);
                    }
                }
            }
        } catch (err) {
            if (this.heartbeatCount % 10 === 0) {
                console.warn(`[NaaS] Heartbeat error (attempt ${this.heartbeatCount}):`, err instanceof Error ? err.message : err);
            }
        }

        // Re-measure ping every 5 minutes
        if (this.heartbeatCount % 10 === 0) {
            this.cachedPing = this.measurePlatformPing();
        }
        // Re-measure IOPS every hour
        if (this.heartbeatCount % 120 === 0) {
            this.cachedIOPS = this.measureDiskIOPS();
        }
    }

    // ─── Native Validator Discovery (no Docker) ──────────────

    private getContainerStatuses(): ContainerStatus[] {
        // Check native validator processes by probing their RPC ports.
        // We moved away from Docker — validators run as native binaries.
        const NATIVE_VALIDATORS = [
            { name: 'gstd-native-eth', chain: 'ETH', port: 8545,  image: 'helios-light-client' },
            { name: 'gstd-native-btc', chain: 'BTC', port: 8332,  image: 'bitcoin-core-pruned' },
            { name: 'gstd-native-ton', chain: 'TON', port: 43677, image: 'ton-lite-client' },
        ];

        const containers: ContainerStatus[] = [];
        for (const v of NATIVE_VALIDATORS) {
            const latency = this.measureRPCLatency(v.port);
            const isRunning = latency !== undefined;
            containers.push({
                name:             v.name,
                image:            v.image,
                status:           isRunning ? 'running' : 'stopped',
                uptime_seconds:   0,
                chain:            v.chain,
                rpc_port:         v.port,
                rpc_latency_ms:   latency,
            });
        }
        return containers;
    }

    // ─── NaaS Command Execution ──────────────────────────────

    private executeNaaSCommand(cmd: any): void {
        // Validator lifecycle is managed via ValidatorManager (native binaries).
        // Docker-based NaaS commands are no longer supported.
        const { action, image_id, container_name } = cmd;
        logActivity(`NaaS command received: ${action} ${image_id || container_name || ''} — use /api/validators/:chain/toggle instead`, 'warn');
    }

    // ─── Tunnel URL ───────────────────────────────────────────

    private getTunnelUrl(): string | null {
        // Priority: env var > localhost.run tunnel file > null
        if (process.env.GSTD_PUBLIC_URL) return process.env.GSTD_PUBLIC_URL.replace(/\/$/, '');
        const file = '/tmp/gstd_tunnel_url.txt';
        if (existsSync(file)) {
            const url = readFileSync(file, 'utf-8').trim();
            if (url.startsWith('http')) return url;
        }
        return null;
    }

    // ─── Hardware Benchmarks ─────────────────────────────────

    private measureDiskIOPS(): number {
        try {
            // Use dd for a quick IOPS estimate (portable)
            const start = Date.now();
            execSync('dd if=/dev/zero of=/tmp/gstd_iops_test bs=4k count=1000 oflag=direct 2>/dev/null', { timeout: 10000, stdio: 'pipe' });
            const elapsed = (Date.now() - start) / 1000;
            execSync('rm -f /tmp/gstd_iops_test', { stdio: 'pipe' });
            return Math.round(1000 / elapsed); // approximate IOPS
        } catch {
            return 500; // Default estimate
        }
    }

    private measurePlatformPing(): number {
        try {
            const resp = execSync(
                `curl -s -o /dev/null -w '%{time_total}' --max-time 5 ${PLATFORM_URL}/api/v1/health`,
                { encoding: 'utf-8', timeout: 6000 }
            );
            return Math.round(parseFloat(resp) * 1000);
        } catch {
            return 200; // Default
        }
    }

    private measureRPCLatency(port: number): number | undefined {
        try {
            const start = Date.now();
            execSync(
                `curl -s --max-time 2 -X POST http://localhost:${port} -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' -o /dev/null`,
                { timeout: 3000, stdio: 'pipe' }
            );
            return Date.now() - start;
        } catch {
            return undefined;
        }
    }

    private getDiskUsage(): { total: number; used: number } {
        try {
            const output = execSync("df -BG / | tail -1", { encoding: 'utf-8', timeout: 3000 });
            const parts = output.trim().split(/\s+/);
            return {
                total: parseInt(parts[1]?.replace('G', '') || '0'),
                used: parseInt(parts[2]?.replace('G', '') || '0'),
            };
        } catch {
            return { total: 0, used: 0 };
        }
    }

    // ─── Tier Classification ─────────────────────────────────

    private classifyTier(cpuCores: number, ramGB: number, iops: number): 'light' | 'standard' | 'archive' {
        if (ramGB >= 32 && cpuCores >= 8 && iops >= 2000) return 'archive';
        if (ramGB >= 8 && cpuCores >= 4 && iops >= 500) return 'standard';
        return 'light';
    }
}
