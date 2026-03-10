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

import fs from 'fs';
import path from 'path';
import { NeuralRouter, RouteResult } from '../gateway/router.js';
import { listInstalled, type Skill } from '../skills/marketplace.js';

export interface AgentConfig {
    model: string;
    soulPath?: string;
    skillsDir?: string;
    ollamaUrl: string;
    memoryEnabled: boolean;
    maxContextMessages: number;
}

interface Memory {
    key: string;
    value: string;
    timestamp: number;
}

export class Agent {
    private router: NeuralRouter;
    private skillsDir: string;
    private config: AgentConfig;
    private soulPrompt: string;
    private history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    private memories: Memory[] = [];

    constructor(config: AgentConfig) {
        this.config = config;
        this.router = new NeuralRouter(config.ollamaUrl, true);
        this.skillsDir = config.skillsDir || path.join(process.cwd(), 'skills');

        // Load soul
        this.soulPrompt = this.loadSoul();
    }

    /**
     * Load SOUL.md — the agent's identity and behaviour guidelines
     */
    private loadSoul(): string {
        const defaultSoul = `You are GSTD Sovereign AI — a decentralized intelligence engine running on the GSTD Swarm.

INTELLIGENCE PROTOCOL:
1. DEEP ANALYSIS: Decompose questions into sub-problems. Consider edge cases and nuances.
2. EVIDENCE-BASED: Cite sources and evidence for factual claims. Never fabricate.
3. STRUCTURED OUTPUT: Use markdown — ## headers, **bold**, code blocks with language tags, tables.
4. GO DEEPER: Explain WHY not just WHAT. Anticipate follow-up questions.
5. LANGUAGE: ALWAYS respond in the same language as the user. Be precise and authoritative.

Core principles:
1. PRIVACY: Never send user data to corporate servers
2. SOVEREIGNTY: Prefer sovereign models over commercial APIs
3. HONESTY: Be transparent about capabilities — if uncertain, say so
4. QUALITY: Produce answers better than ChatGPT or Claude
5. SAFETY: Refuse harmful requests, protect user interests

You are multilingual and respond in the user's language.

Available skills:
${listInstalled().map((s: Skill) => `- ${s.name}: ${s.description}`).join('\n')}

When a user's request matches a skill, activate it automatically.`;

        // Try to load custom SOUL.md
        const customPaths = [
            this.config.soulPath,
            path.join(process.cwd(), 'SOUL.md'),
            path.join(process.env.HOME || '~', '.gstdbot', 'workspace', 'SOUL.md'),
        ].filter(Boolean) as string[];

        for (const soulPath of customPaths) {
            if (fs.existsSync(soulPath)) {
                try {
                    const content = fs.readFileSync(soulPath, 'utf-8');
                    console.log(`[Agent] Loaded soul from: ${soulPath}`);
                    return content + '\n\n' + defaultSoul.split('Available skills:')[1];
                } catch { /* fallback */ }
            }
        }

        return defaultSoul;
    }

    /**
     * Chat with the agent
     */
    async chat(message: string, model?: string): Promise<RouteResult> {
        // Build context
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: this.buildSystemPrompt(message) },
            ...this.history.slice(-this.config.maxContextMessages),
            { role: 'user', content: message },
        ];

        // Route through Neural Router
        const result = await this.router.route(model || this.config.model, messages);

        // Update history
        this.history.push({ role: 'user', content: message });
        this.history.push({ role: 'assistant', content: result.content });

        // Trim history
        if (this.history.length > this.config.maxContextMessages * 2) {
            this.history = this.history.slice(-this.config.maxContextMessages);
        }

        // Extract and store memories
        if (this.config.memoryEnabled) {
            this.extractMemories(message, result.content);
        }

        return result;
    }

    /**
     * Build system prompt with active skills and memories
     */
    private buildSystemPrompt(currentMessage: string): string {
        let prompt = this.soulPrompt;

        // Add relevant skill prompts
        const activeSkill = this.detectSkill(currentMessage);
        if (activeSkill) {
            prompt += `\n\n--- ACTIVE SKILL: ${activeSkill} ---`;
        }

        // Add relevant memories
        if (this.memories.length > 0) {
            const relevantMemories = this.memories.slice(-5);
            prompt += '\n\n--- CONTEXT MEMORY ---\n';
            prompt += relevantMemories.map(m => `• ${m.key}: ${m.value}`).join('\n');
        }

        return prompt;
    }

    /**
     * Detect which skill to activate based on user message
     */
    private detectSkill(message: string): string | null {
        const lower = message.toLowerCase();

        const skillPatterns: Record<string, RegExp> = {
            'code-gen': /\b(code|function|class|program|script|debug|implement|algorithm|refactor|typescript|python|javascript|rust|golang)\b/,
            'web-research': /\b(research|search|find|article|paper|source|reference|news|latest|discover)\b/,
            'defi-monitor': /\b(defi|liquidity|pool|yield|farming|apy|swap|dex|token price|whale|impermanent)\b/,
            'content-writer': /\b(write|article|blog|content|copy|text|seo|headline|newsletter)\b/,
            'token-analyzer': /\b(token|contract|holder|distribution|smart money|on.?chain|whale track|analyze.*token)\b/,
            'planetary-signals': /\b(signal|threat|earthquake|weather|climate|disaster|global|planetary|warning)\b/,
            'image-gen': /\b(image|picture|illustration|drawing|generate.*image|create.*img|visual)\b/,
        };

        for (const [skillId, pattern] of Object.entries(skillPatterns)) {
            if (pattern.test(lower)) {
                const installed = listInstalled();
                if (installed.some((s: Skill) => s.name === skillId)) return skillId;
            }
        }

        return null;
    }

    /**
     * Extract and store key facts as memories
     */
    private extractMemories(userMsg: string, assistantMsg: string): void {
        // Simple fact extraction
        const factPatterns = [
            /my name is (\w+)/i,
            /i (work|live|am) (?:at|in|from) (.+)/i,
            /remember that (.+)/i,
            /i prefer (.+)/i,
            /my (?:wallet|address) is (\S+)/i,
        ];

        for (const pattern of factPatterns) {
            const match = userMsg.match(pattern);
            if (match) {
                this.memories.push({
                    key: pattern.source.substring(0, 30),
                    value: match[0],
                    timestamp: Date.now(),
                });
            }
        }

        // Keep memories bounded
        if (this.memories.length > 50) {
            this.memories = this.memories.slice(-30);
        }
    }

    /**
     * Reset conversation
     */
    reset(): void {
        this.history = [];
    }

    /**
     * Get skills marketplace
     */
    getSkills(): { list: () => Skill[] } {
        return { list: () => listInstalled() };
    }

    /**
     * Get conversation history
     */
    getHistory() {
        return [...this.history];
    }
}
