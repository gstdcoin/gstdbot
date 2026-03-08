/**
 * GSTD Agent — The core AI runtime
 *
 * This is the brain of the bot. It:
 * - Loads the SOUL.md configuration
 * - Manages conversation context with memory
 * - Routes through the Neural Router
 * - Activates skills based on user intent
 * - Maintains conversation history
 */
import { RouteResult } from '../gateway/router.js';
import { type Skill } from '../skills/marketplace.js';
export interface AgentConfig {
    model: string;
    soulPath?: string;
    skillsDir?: string;
    ollamaUrl: string;
    memoryEnabled: boolean;
    maxContextMessages: number;
}
export declare class Agent {
    private router;
    private skillsDir;
    private config;
    private soulPrompt;
    private history;
    private memories;
    constructor(config: AgentConfig);
    /**
     * Load SOUL.md — the agent's identity and behaviour guidelines
     */
    private loadSoul;
    /**
     * Chat with the agent
     */
    chat(message: string, model?: string): Promise<RouteResult>;
    /**
     * Build system prompt with active skills and memories
     */
    private buildSystemPrompt;
    /**
     * Detect which skill to activate based on user message
     */
    private detectSkill;
    /**
     * Extract and store key facts as memories
     */
    private extractMemories;
    /**
     * Reset conversation
     */
    reset(): void;
    /**
     * Get skills marketplace
     */
    getSkills(): {
        list: () => Skill[];
    };
    /**
     * Get conversation history
     */
    getHistory(): {
        role: "system" | "user" | "assistant";
        content: string;
    }[];
}
//# sourceMappingURL=agent.d.ts.map