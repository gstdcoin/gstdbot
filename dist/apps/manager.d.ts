/**
 * GSTD Node OS — App Manager
 *
 * Docker-based application management (77 apps, 11 Premium):
 * - Install/Remove apps from GSTD App Registry
 * - Manage app lifecycle (start/stop/restart)
 * - App manifest format (gstd-app.yml)
 * - Built-in apps: Chat, Monitor, Files
 */
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
}
export declare class AppManager {
    private appsDir;
    private installed;
    private stateFile;
    constructor(dataDir?: string);
    init(): Promise<void>;
    getInstalled(): InstalledApp[];
    getAvailable(): AppManifest[];
    getRegistry(): Promise<AppManifest[]>;
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