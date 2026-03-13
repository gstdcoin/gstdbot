/**
 * GSTD Mobile Node — Telegram Mini App Backend
 *
 * Turns any smartphone into a GSTD node via Telegram.
 * Users open the Mini App → instant node activation → earn GSTD.
 *
 * Key flows:
 *  1. User opens TMA → auto-registers as mobile node
 *  2. Background heartbeat keeps node "alive" while app is open
 *  3. TON Connect wallet attachment for reward claims
 *  4. Task processing (lightweight: AI queries, verification)
 *  5. Real-time stats: earnings, uptime, tier progression
 */
import type { Express } from 'express';
/** Real device resources collected from the user's smartphone */
export interface DeviceResources {
    /** CPU cores (navigator.hardwareConcurrency) */
    cpuCores: number;
    /** Device RAM in GB (navigator.deviceMemory or estimated) */
    ramGb: number;
    /** Battery level 0-100 (Battery API) */
    batteryLevel: number;
    /** Whether device is charging */
    isCharging: boolean;
    /** Network type: wifi | cellular | ethernet | unknown */
    networkType: string;
    /** Downlink speed in Mbps (NetworkInformation API) */
    downlinkMbps: number;
    /** Effective connection type: slow-2g | 2g | 3g | 4g */
    effectiveType: string;
    /** Device platform: android | ios | other */
    platform: string;
    /** JS heap used in MB (performance.memory) */
    jsHeapMb: number;
    /** Screen resolution */
    screenRes: string;
    /** User-Agent (for device identification) */
    userAgent: string;
}
export interface MobileNodeSession {
    telegramId: number;
    username: string;
    firstName: string;
    walletAddress?: string;
    nodeId: string;
    startedAt: number;
    lastHeartbeat: number;
    uptimeMinutes: number;
    tasksCompleted: number;
    earningsSession: number;
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    isActive: boolean;
    /** Real device resources — updated every heartbeat from the phone */
    device: DeviceResources;
}
export interface MobileNodeConfig {
    botToken: string;
    apiUrl: string;
    gstdJettonAddress: string;
}
export declare class MobileNodeManager {
    private sessions;
    private config;
    private heartbeatIntervals;
    constructor(config: MobileNodeConfig);
    /**
     * Register Mini App API routes on the gateway Express app
     */
    registerRoutes(app: Express): void;
    /** Sanitize & validate device info received from client */
    private sanitizeDeviceInfo;
    private defaultDeviceResources;
    private activateNode;
    private deactivateNode;
    private pollTask;
    private notifyBackend;
    private validateInitData;
    private getHourlyRate;
    private getTierEmoji;
    private formatUptime;
    private getNextRewardTime;
    /**
     * Generate the Telegram Mini App HTML
     * Runs entirely inside Telegram WebView on user's smartphone.
     * Collects REAL device resources via Web APIs:
     *  - Battery API → battery level + charging state
     *  - navigator.hardwareConcurrency → CPU cores
     *  - navigator.deviceMemory → RAM in GB
     *  - NetworkInformation API → connection type + speed
     *  - performance.memory → JS heap usage
     */
    private getMiniAppHTML;
    /**
     * Get count of active mobile nodes
     */
    getActiveCount(): number;
    /**
     * Cleanup on shutdown
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=miniapp.d.ts.map