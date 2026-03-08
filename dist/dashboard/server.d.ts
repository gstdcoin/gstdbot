/**
 * GSTD Node — Dashboard Server
 * Full local web dashboard for node operators to monitor and manage their node.
 * Runs on the operator's own hardware alongside the gateway.
 */
export interface DashboardConfig {
    host: string;
    port: number;
    enabled: boolean;
}
export declare function logActivity(msg: string, type?: string): void;
export declare function startDashboard(port?: number, host?: string): Promise<void>;
//# sourceMappingURL=server.d.ts.map