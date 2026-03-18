/**
 * GSTD Node OS — App Manager
 *
 * Docker-based application management (77 apps, 11 Premium):
 * - Install/Remove apps from GSTD App Registry
 * - Manage app lifecycle (start/stop/restart)
 * - App manifest format (gstd-app.yml)
 * - Built-in apps: Chat, Monitor, Files
 */
import { EventEmitter } from 'events';
export interface AppManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    icon: string;
    author: string;
    category: 'ai' | 'tools' | 'network' | 'finance' | 'media' | 'system' | 'cloud' | 'security' | 'communication' | 'web' | 'defi';
    port: number;
    premium?: boolean;
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
    requires?: string[];
    gstd_cost?: number;
}
export interface InstalledApp {
    manifest: AppManifest;
    installedAt: string;
    status: 'running' | 'stopped' | 'error' | 'installing';
    pid?: number;
    url?: string;
    installProgress?: InstallProgress;
}
export interface InstallProgress {
    appId: string;
    phase: 'pending' | 'downloading' | 'configuring' | 'initializing' | 'ready' | 'error';
    percent: number;
    currentStep: string;
    steps: InstallStep[];
    startedAt: number;
    error?: string;
}
export interface InstallStep {
    name: string;
    status: 'pending' | 'active' | 'done' | 'error';
    detail?: string;
}
export declare class AppManager extends EventEmitter {
    private appsDir;
    private installed;
    private stateFile;
    private activeInstalls;
    constructor(dataDir?: string);
    init(): Promise<void>;
    getInstalled(): InstalledApp[];
    getAvailable(): AppManifest[];
    getInstallProgress(appId: string): InstallProgress | null;
    getAllInstallProgress(): Record<string, InstallProgress>;
    getRegistry(): Promise<AppManifest[]>;
    private getInstallSteps;
    private updateProgress;
    /** Run a simulated step (with realistic delay for proper UX) */
    private runStep;
    install(appId: string): Promise<boolean>;
    uninstall(appId: string): Promise<boolean>;
    start(appId: string): Promise<boolean>;
    stop(appId: string): Promise<boolean>;
    restart(appId: string): Promise<boolean>;
    installAll(premiumToo?: boolean): Promise<{
        installed: string[];
        failed: string[];
        skipped: string[];
    }>;
    installAllFree(): Promise<{
        installed: string[];
        failed: string[];
        skipped: string[];
    }>;
    installAllPremium(): Promise<{
        installed: string[];
        failed: string[];
        skipped: string[];
    }>;
    private saveState;
}
//# sourceMappingURL=manager.d.ts.map