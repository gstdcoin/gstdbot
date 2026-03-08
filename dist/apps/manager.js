"use strict";
/**
 * GSTD Node OS — App Manager
 *
 * Docker-based application management (like Umbrel App Store):
 * - Install/Remove apps from GSTD App Registry
 * - Manage app lifecycle (start/stop/restart)
 * - App manifest format (gstd-app.yml)
 * - Built-in apps: Chat, Monitor, Files
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppManager = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const server_js_1 = require("../gateway/server.js");
// ─── Built-in Apps Registry ─────────────────────────────────────
const BUILTIN_APPS = [
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
class AppManager {
    appsDir;
    installed = new Map();
    stateFile;
    constructor(dataDir) {
        this.appsDir = dataDir || (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot', 'apps');
        this.stateFile = (0, path_1.join)(this.appsDir, 'installed.json');
        if (!(0, fs_1.existsSync)(this.appsDir)) {
            (0, fs_1.mkdirSync)(this.appsDir, { recursive: true });
        }
    }
    async init() {
        // Load installed apps state
        if ((0, fs_1.existsSync)(this.stateFile)) {
            try {
                const data = JSON.parse((0, fs_1.readFileSync)(this.stateFile, 'utf-8'));
                for (const app of data) {
                    this.installed.set(app.manifest.id, app);
                }
            }
            catch { }
        }
        console.log(`    Apps: ${this.installed.size} installed, ${BUILTIN_APPS.length} built-in available`);
    }
    // ─── List ────────────────────────────────────────────────────
    getInstalled() {
        return Array.from(this.installed.values());
    }
    getAvailable() {
        return BUILTIN_APPS.filter(app => !this.installed.has(app.id));
    }
    async getRegistry() {
        try {
            const resp = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const data = await resp.json();
                return data.apps || [];
            }
        }
        catch { }
        return BUILTIN_APPS;
    }
    // ─── Install ─────────────────────────────────────────────────
    async install(appId) {
        if (this.installed.has(appId)) {
            (0, server_js_1.logActivity)(`App ${appId} already installed`, 'warn');
            return false;
        }
        // Find manifest
        const manifest = BUILTIN_APPS.find(a => a.id === appId);
        if (!manifest) {
            (0, server_js_1.logActivity)(`App ${appId} not found in registry`, 'error');
            return false;
        }
        (0, server_js_1.logActivity)(`Installing app: ${manifest.name}...`, 'info');
        const installedApp = {
            manifest,
            installedAt: new Date().toISOString(),
            status: 'installing',
        };
        this.installed.set(appId, installedApp);
        // Create app data directory
        const appDir = (0, path_1.join)(this.appsDir, appId);
        if (!(0, fs_1.existsSync)(appDir)) {
            (0, fs_1.mkdirSync)(appDir, { recursive: true });
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
                (0, server_js_1.logActivity)(`App ${manifest.name} installed ✓`, 'success');
            }
            catch (e) {
                installedApp.status = 'error';
                (0, server_js_1.logActivity)(`App ${manifest.name} install failed: ${e.message}`, 'error');
                return false;
            }
        }
        else {
            // Script-based or built-in
            installedApp.status = 'stopped';
            (0, server_js_1.logActivity)(`App ${manifest.name} installed ✓`, 'success');
        }
        this.saveState();
        return true;
    }
    // ─── Uninstall ───────────────────────────────────────────────
    async uninstall(appId) {
        const app = this.installed.get(appId);
        if (!app)
            return false;
        // Stop first
        await this.stop(appId);
        // Remove data
        const appDir = (0, path_1.join)(this.appsDir, appId);
        if ((0, fs_1.existsSync)(appDir)) {
            try {
                (0, fs_1.rmSync)(appDir, { recursive: true, force: true });
            }
            catch { }
        }
        // Remove docker container/image
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker rm -f gstd-${appId} 2>/dev/null; docker rmi ${app.manifest.docker.image} 2>/dev/null`, {
                    encoding: 'utf-8',
                    timeout: 30_000,
                });
            }
            catch { }
        }
        this.installed.delete(appId);
        this.saveState();
        (0, server_js_1.logActivity)(`App ${app.manifest.name} uninstalled`, 'warn');
        return true;
    }
    // ─── Start / Stop ────────────────────────────────────────────
    async start(appId) {
        const app = this.installed.get(appId);
        if (!app)
            return false;
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                const m = app.manifest.docker;
                const ports = m.ports.map(p => `-p ${p}`).join(' ');
                const volumes = m.volumes.map(v => `-v ${v}`).join(' ');
                const envs = Object.entries(m.environment || {}).map(([k, v]) => `-e ${k}=${v}`).join(' ');
                execSync(`docker rm -f gstd-${appId} 2>/dev/null || true`, { encoding: 'utf-8' });
                execSync(`docker run -d --name gstd-${appId} ${ports} ${volumes} ${envs} --restart unless-stopped ${m.image}`, { encoding: 'utf-8', timeout: 30_000 });
                app.status = 'running';
                app.url = `http://localhost:${app.manifest.port}`;
                this.saveState();
                (0, server_js_1.logActivity)(`App ${app.manifest.name} started on :${app.manifest.port}`, 'success');
                return true;
            }
            catch (e) {
                app.status = 'error';
                (0, server_js_1.logActivity)(`App ${app.manifest.name} start failed: ${e.message}`, 'error');
                return false;
            }
        }
        // Built-in apps just set status
        app.status = 'running';
        app.url = `http://localhost:${app.manifest.port}`;
        this.saveState();
        return true;
    }
    async stop(appId) {
        const app = this.installed.get(appId);
        if (!app)
            return false;
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker stop gstd-${appId} 2>/dev/null || true`, { encoding: 'utf-8' });
            }
            catch { }
        }
        app.status = 'stopped';
        app.url = undefined;
        this.saveState();
        (0, server_js_1.logActivity)(`App ${app.manifest.name} stopped`, 'info');
        return true;
    }
    async restart(appId) {
        await this.stop(appId);
        return this.start(appId);
    }
    // ─── State Persistence ───────────────────────────────────────
    saveState() {
        try {
            (0, fs_1.writeFileSync)(this.stateFile, JSON.stringify(Array.from(this.installed.values()), null, 2));
        }
        catch { }
    }
}
exports.AppManager = AppManager;
//# sourceMappingURL=manager.js.map