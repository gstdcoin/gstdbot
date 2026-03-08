/**
 * Swarm Network Client — Join, contribute, earn GSTD tokens
 *
 * Turns any PC into a node in the GSTD decentralized network.
 * - Auto-detects hardware capabilities (CPU, RAM, GPU)
 * - Registers with the GSTD control plane
 * - Serves AI inference requests via Ollama
 * - Earns GSTD tokens for compute contributions
 * - Reports health metrics to the network
 */
export interface NodeCapabilities {
    cpu: string;
    cpuCores: number;
    ramGB: number;
    platform: string;
    arch: string;
    gpuDetected: boolean;
    ollamaAvailable: boolean;
    models: string[];
    nodeId: string;
    hostname: string;
}
export interface SwarmStatus {
    connected: boolean;
    nodeId: string;
    uptime: number;
    tasksProcessed: number;
    gstdEarned: number;
    currentLoad: number;
    modelsReady: string[];
}
export declare class SwarmClient {
    private nodeId;
    private startTime;
    private controlPlaneUrl;
    private ollamaUrl;
    private tasksProcessed;
    private gstdEarned;
    private heartbeatInterval;
    private connected;
    constructor(controlPlaneUrl?: string, ollamaUrl?: string);
    /**
     * Detect hardware capabilities
     */
    detectCapabilities(): Promise<NodeCapabilities>;
    /**
     * Simple GPU detection
     */
    private detectGPU;
    /**
     * Register this node with the GSTD control plane
     */
    register(walletAddress?: string): Promise<boolean>;
    /**
     * Start heartbeat to the control plane
     */
    startHeartbeat(intervalMs?: number): void;
    /**
     * Stop heartbeat
     */
    stopHeartbeat(): void;
    /**
     * Process a task from the network
     */
    processTask(task: {
        model: string;
        messages: any[];
    }): Promise<string>;
    /**
     * Get current swarm status
     */
    getStatus(): SwarmStatus;
}
//# sourceMappingURL=client.d.ts.map