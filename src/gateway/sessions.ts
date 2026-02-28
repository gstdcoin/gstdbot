/**
 * Session Manager — manages chat sessions across channels
 */

import { v4 as uuid } from 'uuid';

export interface Session {
    id: string;
    clientId: string;
    model: string;
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    systemPrompt: string;
    createdAt: number;
    lastActivity: number;
}

export class SessionManager {
    private sessions = new Map<string, Session>();

    private readonly DEFAULT_SYSTEM_PROMPT = `You are GSTD — a sovereign decentralized AI assistant powered by the GSTD Swarm.
You run on a planetary brain of distributed nodes, not corporate servers.
You are helpful, concise, and direct. Respond in the user's language.
You have access to skills: web research, code generation, DeFi monitoring, and more.
Be transparent about your capabilities and limitations.`;

    create(clientId: string): Session {
        const session: Session = {
            id: uuid(),
            clientId,
            model: 'auto',
            history: [],
            systemPrompt: this.DEFAULT_SYSTEM_PROMPT,
            createdAt: Date.now(),
            lastActivity: Date.now(),
        };
        this.sessions.set(session.id, session);
        return session;
    }

    get(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId);
    }

    close(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    count(): number {
        return this.sessions.size;
    }

    /**
     * Prune old sessions (older than ttlMs)
     */
    prune(ttlMs = 3600_000): number {
        const now = Date.now();
        let pruned = 0;
        for (const [id, session] of this.sessions) {
            if (now - session.lastActivity > ttlMs) {
                this.sessions.delete(id);
                pruned++;
            }
        }
        return pruned;
    }
}
