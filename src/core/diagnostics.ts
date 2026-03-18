/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Self-Diagnostics (like OpenClaw's `doctor`)
 * 
 * Runs comprehensive health checks:
 *  - API connectivity
 *  - Memory system
 *  - Model availability
 *  - Wallet status
 *  - Platform connection
 *  - Disk space
 *  - Container environment checks
 * ═══════════════════════════════════════════════════════════════
 */

import * as os from 'os';
import * as fs from 'fs';

export interface DiagCheck {
    name: string;
    category: 'core' | 'network' | 'storage' | 'models' | 'wallet' | 'security';
    status: 'ok' | 'warn' | 'error';
    message: string;
    details?: any;
    fixHint?: string;
}

export interface DiagReport {
    timestamp: string;
    nodeId: string;
    version: string;
    uptime: number;
    overall: 'healthy' | 'degraded' | 'critical';
    checks: DiagCheck[];
    system: {
        platform: string;
        arch: string;
        nodeVersion: string;
        totalMemory: string;
        freeMemory: string;
        cpus: number;
        loadAvg: number[];
    };
    score: number; // 0-100
}

export class Diagnostics {
    private nodeId: string;
    private version: string;
    private platformUrl: string;
    private getters: Record<string, () => any> = {};

    constructor(config: { nodeId: string; version: string; platformUrl: string }) {
        this.nodeId = config.nodeId;
        this.version = config.version;
        this.platformUrl = config.platformUrl;
    }

    /** Register data getters for checks */
    registerGetter(name: string, fn: () => any) { this.getters[name] = fn; }

    /** Run all diagnostics */
    async runFull(): Promise<DiagReport> {
        const checks: DiagCheck[] = [];

        // Core checks
        checks.push(this.checkNode());
        checks.push(this.checkMemoryUsage());
        checks.push(this.checkDisk());

        // Network checks
        checks.push(await this.checkPlatformApi());
        checks.push(await this.checkGroqApi());

        // Module checks
        checks.push(this.checkWallet());
        checks.push(this.checkMemoryModule());
        checks.push(this.checkAppStore());

        // Security checks
        checks.push(this.checkSecurity());

        // Calculate score
        const okCount = checks.filter(c => c.status === 'ok').length;
        const warnCount = checks.filter(c => c.status === 'warn').length;
        const errorCount = checks.filter(c => c.status === 'error').length;
        const score = Math.round(((okCount * 100 + warnCount * 50) / checks.length));
        const overall = errorCount > 2 ? 'critical' : errorCount > 0 || warnCount > 2 ? 'degraded' : 'healthy';

        return {
            timestamp: new Date().toISOString(),
            nodeId: this.nodeId,
            version: this.version,
            uptime: process.uptime(),
            overall,
            checks,
            system: {
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
                freeMemory: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
                cpus: os.cpus().length,
                loadAvg: os.loadavg().map(l => Math.round(l * 100) / 100),
            },
            score,
        };
    }

    private checkNode(): DiagCheck {
        const uptimeHours = process.uptime() / 3600;
        return {
            name: 'Node Runtime',
            category: 'core',
            status: 'ok',
            message: `Node.js ${process.version} running for ${uptimeHours.toFixed(1)}h`,
            details: { pid: process.pid, nodeVersion: process.version, uptime: process.uptime() },
        };
    }

    private checkMemoryUsage(): DiagCheck {
        const mem = process.memoryUsage();
        const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        const pct = Math.round(mem.heapUsed / mem.heapTotal * 100);

        return {
            name: 'Memory Usage',
            category: 'core',
            status: pct > 90 ? 'error' : pct > 70 ? 'warn' : 'ok',
            message: `Heap: ${heapUsedMB}/${heapTotalMB}MB (${pct}%)`,
            details: { heapUsed: heapUsedMB, heapTotal: heapTotalMB, rss: Math.round(mem.rss / 1024 / 1024) },
            fixHint: pct > 90 ? 'Consider increasing NODE_OPTIONS=--max-old-space-size' : undefined,
        };
    }

    private checkDisk(): DiagCheck {
        try {
            const dataDir = process.env.GSTD_DATA_DIR || '/data/gstdbot';
            const exists = fs.existsSync(dataDir);
            if (!exists) {
                return { name: 'Data Directory', category: 'storage', status: 'warn', message: `Data dir not found: ${dataDir}`, fixHint: 'Create the directory or set GSTD_DATA_DIR' };
            }
            return { name: 'Data Directory', category: 'storage', status: 'ok', message: `${dataDir} — accessible` };
        } catch (e: any) {
            return { name: 'Data Directory', category: 'storage', status: 'error', message: e.message };
        }
    }

    private async checkPlatformApi(): Promise<DiagCheck> {
        try {
            const start = Date.now();
            const resp = await fetch(`${this.platformUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
            const latency = Date.now() - start;

            return {
                name: 'Platform API',
                category: 'network',
                status: resp.ok ? 'ok' : 'warn',
                message: `${this.platformUrl} — ${resp.status} (${latency}ms)`,
                details: { url: this.platformUrl, status: resp.status, latencyMs: latency },
            };
        } catch (e: any) {
            return {
                name: 'Platform API',
                category: 'network',
                status: 'error',
                message: `Cannot reach platform: ${e.message}`,
                fixHint: 'Check network connectivity and GSTD_SWARM_URL',
            };
        }
    }

    private async checkGroqApi(): Promise<DiagCheck> {
        try {
            const key = process.env.GROQ_API_KEY;
            if (!key) {
                return { name: 'Groq API', category: 'models', status: 'warn', message: 'GROQ_API_KEY not set', fixHint: 'Set GROQ_API_KEY for AI model access' };
            }
            const start = Date.now();
            const resp = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${key}` },
                signal: AbortSignal.timeout(5000),
            });
            const latency = Date.now() - start;
            return {
                name: 'Groq API',
                category: 'models',
                status: resp.ok ? 'ok' : 'warn',
                message: resp.ok ? `Connected (${latency}ms)` : `Status ${resp.status}`,
                details: { latencyMs: latency, status: resp.status },
            };
        } catch (e: any) {
            return { name: 'Groq API', category: 'models', status: 'error', message: e.message };
        }
    }

    private checkWallet(): DiagCheck {
        const wallet = this.getters['wallet']?.();
        if (!wallet?.address) {
            return { name: 'Wallet', category: 'wallet', status: 'warn', message: 'No wallet configured', fixHint: 'Bind a TON wallet to earn GSTD' };
        }
        return {
            name: 'Wallet',
            category: 'wallet',
            status: 'ok',
            message: `${wallet.address.slice(0, 8)}...${wallet.address.slice(-4)} — balance: ${wallet.balance?.gstd || 0} GSTD`,
            details: wallet,
        };
    }

    private checkMemoryModule(): DiagCheck {
        const memory = this.getters['memory']?.();
        if (!memory) {
            return { name: 'Memory System', category: 'core', status: 'warn', message: 'Memory module not loaded' };
        }
        return {
            name: 'Memory System',
            category: 'core',
            status: memory.connected ? 'ok' : 'warn',
            message: `${memory.entries || 0} entries, ${memory.connected ? 'connected' : 'disconnected'}`,
        };
    }

    private checkAppStore(): DiagCheck {
        const apps = this.getters['apps']?.();
        return {
            name: 'App Store',
            category: 'core',
            status: 'ok',
            message: `${apps?.available || 0} available, ${apps?.installed || 0} installed`,
            details: apps,
        };
    }

    private checkSecurity(): DiagCheck {
        const hasPinAuth = !!process.env.GSTD_PIN_HASH || !!this.getters['pinAuth']?.();
        return {
            name: 'Security',
            category: 'security',
            status: hasPinAuth ? 'ok' : 'warn',
            message: hasPinAuth ? 'PIN auth enabled' : 'No PIN set — dashboard unprotected',
            fixHint: hasPinAuth ? undefined : 'Set a PIN code in Dashboard → Settings for security',
        };
    }
}
