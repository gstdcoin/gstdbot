/**
 * Session Manager — manages chat sessions across channels
 */
export interface Session {
    id: string;
    clientId: string;
    model: string;
    history: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
    systemPrompt: string;
    createdAt: number;
    lastActivity: number;
}
export declare class SessionManager {
    private sessions;
    private readonly DEFAULT_SYSTEM_PROMPT;
    create(clientId: string): Session;
    get(sessionId: string): Session | undefined;
    close(sessionId: string): void;
    count(): number;
    /**
     * Prune old sessions (older than ttlMs)
     */
    prune(ttlMs?: number): number;
}
//# sourceMappingURL=sessions.d.ts.map