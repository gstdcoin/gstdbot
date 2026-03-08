"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const router_js_1 = require("../gateway/router.js");
const marketplace_js_1 = require("../skills/marketplace.js");
class Agent {
    router;
    skillsDir;
    config;
    soulPrompt;
    history = [];
    memories = [];
    constructor(config) {
        this.config = config;
        this.router = new router_js_1.NeuralRouter(config.ollamaUrl, true);
        this.skillsDir = config.skillsDir || path_1.default.join(process.cwd(), 'skills');
        // Load soul
        this.soulPrompt = this.loadSoul();
    }
    /**
     * Load SOUL.md — the agent's identity and behaviour guidelines
     */
    loadSoul() {
        const defaultSoul = `You are GSTD — a sovereign decentralized AI assistant.
You run on the GSTD Swarm, a planetary brain of distributed nodes.

Core principles:
1. PRIVACY: Never send user data to corporate servers
2. SOVEREIGNTY: Prefer sovereign models over commercial APIs
3. HONESTY: Be transparent about your capabilities and limitations
4. HELPFULNESS: Be concise, direct, and genuinely useful
5. SAFETY: Refuse harmful requests, protect user interests

You respond in the user's language. You are multilingual.

Available skills:
${(0, marketplace_js_1.listInstalled)().map((s) => `- ${s.name}: ${s.description}`).join('\n')}

When a user's request matches a skill, activate it automatically.`;
        // Try to load custom SOUL.md
        const customPaths = [
            this.config.soulPath,
            path_1.default.join(process.cwd(), 'SOUL.md'),
            path_1.default.join(process.env.HOME || '~', '.gstdbot', 'workspace', 'SOUL.md'),
        ].filter(Boolean);
        for (const soulPath of customPaths) {
            if (fs_1.default.existsSync(soulPath)) {
                try {
                    const content = fs_1.default.readFileSync(soulPath, 'utf-8');
                    console.log(`[Agent] Loaded soul from: ${soulPath}`);
                    return content + '\n\n' + defaultSoul.split('Available skills:')[1];
                }
                catch { /* fallback */ }
            }
        }
        return defaultSoul;
    }
    /**
     * Chat with the agent
     */
    async chat(message, model) {
        // Build context
        const messages = [
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
    buildSystemPrompt(currentMessage) {
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
    detectSkill(message) {
        const lower = message.toLowerCase();
        const skillPatterns = {
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
                const installed = (0, marketplace_js_1.listInstalled)();
                if (installed.some((s) => s.name === skillId))
                    return skillId;
            }
        }
        return null;
    }
    /**
     * Extract and store key facts as memories
     */
    extractMemories(userMsg, assistantMsg) {
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
    reset() {
        this.history = [];
    }
    /**
     * Get skills marketplace
     */
    getSkills() {
        return { list: () => (0, marketplace_js_1.listInstalled)() };
    }
    /**
     * Get conversation history
     */
    getHistory() {
        return [...this.history];
    }
}
exports.Agent = Agent;
//# sourceMappingURL=agent.js.map