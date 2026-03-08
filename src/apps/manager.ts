/**
 * GSTD Node OS — App Manager
 *
 * Docker-based application management (like Umbrel App Store):
 * - Install/Remove apps from GSTD App Registry
 * - Manage app lifecycle (start/stop/restart)
 * - App manifest format (gstd-app.yml)
 * - Built-in apps: Chat, Monitor, Files
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logActivity } from '../gateway/server.js';

// ─── Types ───────────────────────────────────────────────────────
export interface AppManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    icon: string;
    author: string;
    category: 'ai' | 'tools' | 'network' | 'finance' | 'media' | 'system';
    port: number;
    docker?: {
        image: string;
        ports: string[];
        volumes: string[];
        environment: Record<string, string>;
    };
    script?: {
        install: string;
        start: string;
        stop: string;
    };
    requires?: string[];       // Required system features
    gstd_cost?: number;        // GSTD cost to install (0 = free)
}

export interface InstalledApp {
    manifest: AppManifest;
    installedAt: string;
    status: 'running' | 'stopped' | 'error' | 'installing';
    pid?: number;
    url?: string;
}

// ─── Built-in Apps Registry ─────────────────────────────────────
const BUILTIN_APPS: AppManifest[] = [
    {
        id: 'gstd-chat',
        name: 'AI Chat',
        version: '1.0.0',
        description: 'Multi-model AI chat with SmartMix consensus. 8 models, streaming, markdown.',
        icon: '💬',
        author: 'GSTD Team',
        category: 'ai',
        port: 3000,
        gstd_cost: 0,
    },
    {
        id: 'gstd-monitor',
        name: 'Network Monitor',
        version: '1.0.0',
        description: 'Real-time monitoring of the GSTD swarm network. Node stats, tasks, earnings.',
        icon: '📊',
        author: 'GSTD Team',
        category: 'network',
        port: 3001,
        gstd_cost: 0,
    },
    {
        id: 'gstd-files',
        name: 'File Manager',
        version: '1.0.0',
        description: 'Local file manager with IPFS integration. Store and share files across the swarm.',
        icon: '📁',
        author: 'GSTD Team',
        category: 'tools',
        port: 3002,
        gstd_cost: 0,
    },
    {
        id: 'gstd-wallet',
        name: 'Wallet Dashboard',
        version: '1.0.0',
        description: 'Full GSTD wallet with earnings history, staking, and transaction management.',
        icon: '💰',
        author: 'GSTD Team',
        category: 'finance',
        port: 3003,
        gstd_cost: 0,
    },
    {
        id: 'gstd-knowledge',
        name: 'Knowledge Base',
        version: '1.0.0',
        description: 'Browse and search the collective memory. Verify facts, contribute knowledge.',
        icon: '🧠',
        author: 'GSTD Team',
        category: 'ai',
        port: 3004,
        gstd_cost: 0,
    },
];

// ─── Community App Registry (fetched from platform) ─────────────
const REGISTRY_URL = 'https://app.gstdtoken.com/api/v1/apps/registry';

// ─── App Manager ────────────────────────────────────────────────
export class AppManager {
    private appsDir: string;
    private installed: Map<string, InstalledApp> = new Map();
    private stateFile: string;

    constructor(dataDir?: string) {
        this.appsDir = dataDir || join(homedir(), '.config', 'gstdbot', 'apps');
        this.stateFile = join(this.appsDir, 'installed.json');

        if (!existsSync(this.appsDir)) {
            mkdirSync(this.appsDir, { recursive: true });
        }
    }

    async init(): Promise<void> {
        // Load installed apps state
        if (existsSync(this.stateFile)) {
            try {
                const data = JSON.parse(readFileSync(this.stateFile, 'utf-8'));
                for (const app of data) {
                    this.installed.set(app.manifest.id, app);
                }
            } catch { }
        }

        console.log(`    Apps: ${this.installed.size} installed, ${BUILTIN_APPS.length} built-in available`);
    }

    // ─── List ────────────────────────────────────────────────────
    getInstalled(): InstalledApp[] {
        return Array.from(this.installed.values());
    }

    getAvailable(): AppManifest[] {
        return BUILTIN_APPS.filter(app => !this.installed.has(app.id));
    }

    async getRegistry(): Promise<AppManifest[]> {
        try {
            const resp = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const data: any = await resp.json();
                return data.apps || [];
            }
        } catch { }
        return BUILTIN_APPS;
    }

    // ─── Install ─────────────────────────────────────────────────
    async install(appId: string): Promise<boolean> {
        if (this.installed.has(appId)) {
            logActivity(`App ${appId} already installed`, 'warn');
            return false;
        }

        // Find manifest
        const manifest = BUILTIN_APPS.find(a => a.id === appId);
        if (!manifest) {
            logActivity(`App ${appId} not found in registry`, 'error');
            return false;
        }

        logActivity(`Installing app: ${manifest.name}...`, 'info');

        const installedApp: InstalledApp = {
            manifest,
            installedAt: new Date().toISOString(),
            status: 'installing',
        };

        this.installed.set(appId, installedApp);

        // Create app data directory
        const appDir = join(this.appsDir, appId);
        if (!existsSync(appDir)) {
            mkdirSync(appDir, { recursive: true });
        }

        // Docker-based install
        if (manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker pull ${manifest.docker.image}`, {
                    encoding: 'utf-8',
                    timeout: 120_000,
                });
                installedApp.status = 'stopped';
                logActivity(`App ${manifest.name} installed ✓`, 'success');
            } catch (e: any) {
                installedApp.status = 'error';
                logActivity(`App ${manifest.name} install failed: ${e.message}`, 'error');
                return false;
            }
        } else {
            // Script-based or built-in
            installedApp.status = 'stopped';
            logActivity(`App ${manifest.name} installed ✓`, 'success');
        }

        this.saveState();
        return true;
    }

    // ─── Uninstall ───────────────────────────────────────────────
    async uninstall(appId: string): Promise<boolean> {
        const app = this.installed.get(appId);
        if (!app) return false;

        // Stop first
        await this.stop(appId);

        // Remove data
        const appDir = join(this.appsDir, appId);
        if (existsSync(appDir)) {
            try { rmSync(appDir, { recursive: true, force: true }); } catch { }
        }

        // Remove docker container/image
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker rm -f gstd-${appId} 2>/dev/null; docker rmi ${app.manifest.docker.image} 2>/dev/null`, {
                    encoding: 'utf-8',
                    timeout: 30_000,
                });
            } catch { }
        }

        this.installed.delete(appId);
        this.saveState();
        logActivity(`App ${app.manifest.name} uninstalled`, 'warn');
        return true;
    }

    // ─── Start / Stop ────────────────────────────────────────────
    async start(appId: string): Promise<boolean> {
        const app = this.installed.get(appId);
        if (!app) return false;

        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                const m = app.manifest.docker;
                const ports = m.ports.map(p => `-p ${p}`).join(' ');
                const volumes = m.volumes.map(v => `-v ${v}`).join(' ');
                const envs = Object.entries(m.environment || {}).map(([k, v]) => `-e ${k}=${v}`).join(' ');

                execSync(`docker rm -f gstd-${appId} 2>/dev/null || true`, { encoding: 'utf-8' });
                execSync(
                    `docker run -d --name gstd-${appId} ${ports} ${volumes} ${envs} --restart unless-stopped ${m.image}`,
                    { encoding: 'utf-8', timeout: 30_000 }
                );

                app.status = 'running';
                app.url = `http://localhost:${app.manifest.port}`;
                this.saveState();
                logActivity(`App ${app.manifest.name} started on :${app.manifest.port}`, 'success');
                return true;
            } catch (e: any) {
                app.status = 'error';
                logActivity(`App ${app.manifest.name} start failed: ${e.message}`, 'error');
                return false;
            }
        }

        // Built-in apps just set status
        app.status = 'running';
        app.url = `http://localhost:${app.manifest.port}`;
        this.saveState();
        return true;
    }

    async stop(appId: string): Promise<boolean> {
        const app = this.installed.get(appId);
        if (!app) return false;

        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker stop gstd-${appId} 2>/dev/null || true`, { encoding: 'utf-8' });
            } catch { }
        }

        app.status = 'stopped';
        app.url = undefined;
        this.saveState();
        logActivity(`App ${app.manifest.name} stopped`, 'info');
        return true;
    }

    async restart(appId: string): Promise<boolean> {
        await this.stop(appId);
        return this.start(appId);
    }

    // ─── State Persistence ───────────────────────────────────────
    private saveState(): void {
        try {
            writeFileSync(this.stateFile, JSON.stringify(
                Array.from(this.installed.values()),
                null,
                2
            ));
        } catch { }
    }
}
