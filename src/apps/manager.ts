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
    // ═══ AI — Core Intelligence ═══
    {
        id: 'gstd-chat',
        name: 'Sovereign AI Chat',
        version: '2.0.0',
        description: 'Multi-model AI chat with SmartMix consensus. 8 models, streaming, markdown, code execution.',
        icon: '💬',
        author: 'GSTD Team',
        category: 'ai',
        port: 3000,
        gstd_cost: 0,
    },
    {
        id: 'gstd-coder',
        name: 'AI Code Studio',
        version: '1.0.0',
        description: 'AI-powered code generation, debugging, and review. Supports 50+ languages. Uses swarm consensus for better results.',
        icon: '👨‍💻',
        author: 'GSTD Team',
        category: 'ai',
        port: 3010,
        gstd_cost: 0,
    },
    {
        id: 'gstd-image-gen',
        name: 'AI Image Studio',
        version: '1.0.0',
        description: 'Generate and edit images with AI. Text-to-image, style transfer, upscaling. Powered by swarm GPU sharing.',
        icon: '🎨',
        author: 'GSTD Team',
        category: 'ai',
        port: 3011,
        gstd_cost: 0,
    },
    {
        id: 'gstd-translator',
        name: 'AI Translator',
        version: '1.0.0',
        description: 'Real-time text and document translation between 100+ languages. Private — no data leaves your node.',
        icon: '🌍',
        author: 'GSTD Team',
        category: 'ai',
        port: 3012,
        gstd_cost: 0,
    },
    {
        id: 'gstd-search',
        name: 'Sovereign Search',
        version: '1.0.0',
        description: 'AI-powered web search engine. Private, ad-free, unbiased. Results enhanced by collective swarm memory.',
        icon: '🔍',
        author: 'GSTD Team',
        category: 'ai',
        port: 3013,
        gstd_cost: 0,
    },
    // ═══ Tools — Everyday Productivity ═══
    {
        id: 'gstd-notes',
        name: 'Smart Notes',
        version: '1.0.0',
        description: 'AI-enhanced notes and documents. Markdown, auto-summarization, smart search, tag suggestions. Synced across your devices.',
        icon: '📝',
        author: 'GSTD Team',
        category: 'tools',
        port: 3020,
        gstd_cost: 0,
    },
    {
        id: 'gstd-tasks',
        name: 'AI Task Manager',
        version: '1.0.0',
        description: 'Smart to-do lists and project boards. AI auto-prioritizes, suggests deadlines, and breaks tasks into subtasks.',
        icon: '✅',
        author: 'GSTD Team',
        category: 'tools',
        port: 3021,
        gstd_cost: 0,
    },
    {
        id: 'gstd-calendar',
        name: 'Calendar',
        version: '1.0.0',
        description: 'Private calendar with AI scheduling assistant. Natural language events, smart reminders, timezone sync.',
        icon: '📅',
        author: 'GSTD Team',
        category: 'tools',
        port: 3022,
        gstd_cost: 0,
    },
    {
        id: 'gstd-files',
        name: 'File Manager',
        version: '1.0.0',
        description: 'Local file manager with swarm sharing. Upload, organize, and share files across your node network.',
        icon: '📁',
        author: 'GSTD Team',
        category: 'tools',
        port: 3002,
        gstd_cost: 0,
    },
    {
        id: 'gstd-passwords',
        name: 'Password Vault',
        version: '1.0.0',
        description: 'Self-hosted password manager. End-to-end encrypted, AI password generator, breach detection alerts.',
        icon: '🔐',
        author: 'GSTD Team',
        category: 'tools',
        port: 3023,
        gstd_cost: 0,
    },
    {
        id: 'gstd-email',
        name: 'AI Mail Assistant',
        version: '1.0.0',
        description: 'Smart email composition and management. AI writes replies, summarizes threads, and prioritizes inbox.',
        icon: '📧',
        author: 'GSTD Team',
        category: 'tools',
        port: 3024,
        gstd_cost: 0,
    },
    {
        id: 'gstd-writer',
        name: 'AI Writer',
        version: '1.0.0',
        description: 'Professional content creation. Blog posts, reports, stories, social media. Multiple AI models for different styles.',
        icon: '✍️',
        author: 'GSTD Team',
        category: 'tools',
        port: 3025,
        gstd_cost: 0,
    },
    {
        id: 'gstd-pdf',
        name: 'PDF Studio',
        version: '1.0.0',
        description: 'View, create, merge, and convert PDFs. AI-powered OCR, text extraction, and document summarization.',
        icon: '📄',
        author: 'GSTD Team',
        category: 'tools',
        port: 3026,
        gstd_cost: 0,
    },
    // ═══ Finance — Wealth & Crypto ═══
    {
        id: 'gstd-wallet',
        name: 'Wallet & Staking',
        version: '2.0.0',
        description: 'Full GSTD/TON wallet with earnings tracker, staking (12% APY), transaction history, and auto-compound.',
        icon: '💰',
        author: 'GSTD Team',
        category: 'finance',
        port: 3003,
        gstd_cost: 0,
    },
    {
        id: 'gstd-defi',
        name: 'DeFi Dashboard',
        version: '1.0.0',
        description: 'Monitor DeFi positions across TON, Ethereum, and BSC. Track yields, impermanent loss, and swap opportunities.',
        icon: '📊',
        author: 'GSTD Team',
        category: 'finance',
        port: 3030,
        gstd_cost: 0,
    },
    {
        id: 'gstd-portfolio',
        name: 'Portfolio Tracker',
        version: '1.0.0',
        description: 'Track crypto and traditional investments. AI market analysis, price alerts, and portfolio rebalancing suggestions.',
        icon: '📈',
        author: 'GSTD Team',
        category: 'finance',
        port: 3031,
        gstd_cost: 0,
    },
    {
        id: 'gstd-dex',
        name: 'Swap Terminal',
        version: '1.0.0',
        description: 'Decentralized token swap aggregator. Best rates across DEXs. AI-powered slippage protection and MEV defense.',
        icon: '🔄',
        author: 'GSTD Team',
        category: 'finance',
        port: 3032,
        gstd_cost: 0,
    },
    // ═══ Media — Content & Entertainment ═══
    {
        id: 'gstd-photos',
        name: 'Photo Gallery',
        version: '1.0.0',
        description: 'Self-hosted photo backup and gallery. AI auto-tagging, face recognition, smart albums. Never lose a memory.',
        icon: '📸',
        author: 'GSTD Team',
        category: 'media',
        port: 3040,
        gstd_cost: 0,
    },
    {
        id: 'gstd-music',
        name: 'Music Player',
        version: '1.0.0',
        description: 'Personal music streaming server. Upload your library, create playlists, stream from any device.',
        icon: '🎵',
        author: 'GSTD Team',
        category: 'media',
        port: 3041,
        gstd_cost: 0,
    },
    {
        id: 'gstd-reader',
        name: 'AI Reader',
        version: '1.0.0',
        description: 'eBook reader and RSS feed aggregator. AI summarizes articles, highlights key points, text-to-speech.',
        icon: '📖',
        author: 'GSTD Team',
        category: 'media',
        port: 3042,
        gstd_cost: 0,
    },
    {
        id: 'gstd-downloader',
        name: 'Media Downloader',
        version: '1.0.0',
        description: 'Download videos and audio from 1000+ sites. Queue management, format conversion, metadata extraction.',
        icon: '⬇️',
        author: 'GSTD Team',
        category: 'media',
        port: 3043,
        gstd_cost: 0,
    },
    // ═══ Network — Privacy & Security ═══
    {
        id: 'gstd-vpn',
        name: 'VPN Gateway',
        version: '1.0.0',
        description: 'Built-in WireGuard VPN server. Access your node from anywhere. Encrypted tunnel, QR code config for phones.',
        icon: '🛡️',
        author: 'GSTD Team',
        category: 'network',
        port: 3050,
        gstd_cost: 0,
    },
    {
        id: 'gstd-adblock',
        name: 'Ad Blocker',
        version: '1.0.0',
        description: 'Network-wide ad and tracker blocking. DNS-level filtering for all devices on your network. Privacy first.',
        icon: '🚫',
        author: 'GSTD Team',
        category: 'network',
        port: 3051,
        gstd_cost: 0,
    },
    {
        id: 'gstd-monitor',
        name: 'Network Monitor',
        version: '1.0.0',
        description: 'Real-time monitoring of the GSTD swarm network. Node stats, tasks, earnings, peer connections.',
        icon: '🌐',
        author: 'GSTD Team',
        category: 'network',
        port: 3001,
        gstd_cost: 0,
    },
    // ═══ System — Node Management ═══
    {
        id: 'gstd-knowledge',
        name: 'Knowledge Base',
        version: '1.0.0',
        description: 'Browse and search the collective memory. Verify facts, contribute knowledge to the swarm brain.',
        icon: '🧠',
        author: 'GSTD Team',
        category: 'system',
        port: 3004,
        gstd_cost: 0,
    },
    {
        id: 'gstd-automation',
        name: 'AI Automations',
        version: '1.0.0',
        description: 'Visual workflow builder. Create AI-powered automations: schedule tasks, trigger actions, connect apps. Your personal IFTTT.',
        icon: '⚡',
        author: 'GSTD Team',
        category: 'system',
        port: 3060,
        gstd_cost: 0,
    },
    {
        id: 'gstd-terminal',
        name: 'Web Terminal',
        version: '1.0.0',
        description: 'Browser-based terminal with AI shell assistant. Natural language commands, auto-completion, error explanation.',
        icon: '🖥️',
        author: 'GSTD Team',
        category: 'system',
        port: 3061,
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
