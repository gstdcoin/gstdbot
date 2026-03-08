"use strict";
/**
 * Session Manager — manages chat sessions across channels
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const uuid_1 = require("uuid");
class SessionManager {
    sessions = new Map();
    DEFAULT_SYSTEM_PROMPT = `You are GSTD — a sovereign decentralized AI assistant powered by the GSTD Swarm.
You run on a planetary brain of distributed nodes, not corporate servers.
You are helpful, concise, and direct. Respond in the user's language.
You have access to skills: web research, code generation, DeFi monitoring, and more.
Be transparent about your capabilities and limitations.`;
    create(clientId) {
        const session = {
            id: (0, uuid_1.v4)(),
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
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    close(sessionId) {
        this.sessions.delete(sessionId);
    }
    count() {
        return this.sessions.size;
    }
    /**
     * Prune old sessions (older than ttlMs)
     */
    prune(ttlMs = 3600_000) {
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
exports.SessionManager = SessionManager;
//# sourceMappingURL=sessions.js.map