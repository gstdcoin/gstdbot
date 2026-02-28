/**
 * Neural Router — Sovereign-First Model Selection
 * 
 * Routes requests through 4 tiers:
 * L1 Cache → L2 Swarm (Ollama) → L3 Cocoon TEE → L4 Commercial
 */

export type RouteTier = 'cache' | 'swarm' | 'cocoon' | 'commercial';

export interface RouteResult {
    content: string;
    model: string;
    tier: RouteTier;
    latencyMs: number;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Model mappings
const MODEL_MAP: Record<string, string> = {
    'auto': 'auto',
    'gstd-flash': 'qwen2.5-coder:7b',
    'gstd-pro': 'llama3.1:8b',
    'gstd-ultra': 'deepseek-r1:14b',
    'cocoon-auto': 'cocoon',
};

// Simple LRU cache for response caching
class ResponseCache {
    private cache = new Map<string, { content: string; model: string; ts: number }>();
    private maxSize = 500;
    private ttlMs = 300_000; // 5 minutes

    get(key: string): { content: string; model: string } | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        return { content: entry.content, model: entry.model };
    }

    set(key: string, content: string, model: string): void {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(key, { content, model, ts: Date.now() });
    }

    makeKey(messages: ChatMessage[]): string {
        const last = messages.filter(m => m.role === 'user').pop();
        return last?.content?.trim().toLowerCase().slice(0, 200) || '';
    }
}

export class NeuralRouter {
    private swarmUrl: string;
    private cocoonEnabled: boolean;
    private cache = new ResponseCache();

    constructor(swarmUrl: string, cocoonEnabled: boolean) {
        this.swarmUrl = swarmUrl;
        this.cocoonEnabled = cocoonEnabled;
    }

    async route(requestedModel: string, messages: ChatMessage[]): Promise<RouteResult> {
        const start = Date.now();

        // ─── L1: Cache ───────────────────────────────────────────
        const cacheKey = this.cache.makeKey(messages);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return {
                content: cached.content,
                model: cached.model,
                tier: 'cache',
                latencyMs: Date.now() - start,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            };
        }

        // ─── Determine target model ─────────────────────────────
        let ollamaModel: string;

        if (requestedModel === 'auto') {
            ollamaModel = this.classifyIntent(messages);
        } else if (requestedModel === 'cocoon-auto') {
            // Route to Cocoon TEE
            return this.routeToCocoon(messages, start);
        } else {
            ollamaModel = MODEL_MAP[requestedModel] || 'llama3.1:8b';
        }

        // ─── L2: Swarm (Ollama) ──────────────────────────────────
        try {
            const result = await this.callOllama(ollamaModel, messages);
            this.cache.set(cacheKey, result.content, result.model);
            return {
                ...result,
                tier: 'swarm',
                latencyMs: Date.now() - start,
            };
        } catch (err) {
            console.warn('[Router] Swarm unavailable, trying fallbacks...');
        }

        // ─── L3: Cocoon TEE ──────────────────────────────────────
        if (this.cocoonEnabled) {
            try {
                return await this.routeToCocoon(messages, start);
            } catch (err) {
                console.warn('[Router] Cocoon unavailable, falling back to commercial...');
            }
        }

        // ─── L4: Commercial fallback ─────────────────────────────
        return {
            content: 'All sovereign models are currently busy. Please try again in a moment. The Swarm is growing! 🐝',
            model: 'fallback',
            tier: 'commercial',
            latencyMs: Date.now() - start,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
    }

    /**
     * Classify user intent to select the best sovereign model
     */
    private classifyIntent(messages: ChatMessage[]): string {
        const lastUser = messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() || '';

        // Code patterns
        const codePattern = /\b(code|function|class|import|export|debug|typescript|python|javascript|rust|golang|api|endpoint|regex|refactor|implement|algorithm|compile|syntax|build|deploy|docker|git|npm|pip)\b/;
        if (codePattern.test(lastUser)) return 'qwen2.5-coder:7b';

        // Reasoning patterns
        const reasonPattern = /\b(explain|analyze|compare|why|how does|prove|reason|logic|math|calculate|evaluate|philosophical|paradox|dilemma|trade.?off|pros.?cons)\b/;
        if (reasonPattern.test(lastUser)) return 'deepseek-r1:14b';

        // Default: general
        return 'llama3.1:8b';
    }

    /**
     * Call Ollama (Swarm L2)
     */
    private async callOllama(model: string, messages: ChatMessage[]): Promise<RouteResult> {
        const response = await fetch(`${this.swarmUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                stream: false,
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
        }

        const data: any = await response.json();
        const content = data.message?.content || '';

        return {
            content,
            model,
            tier: 'swarm',
            latencyMs: 0,
            usage: {
                promptTokens: data.prompt_eval_count || 0,
                completionTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            },
        };
    }

    /**
     * Route to Cocoon TEE (L3)
     */
    private async routeToCocoon(messages: ChatMessage[], start: number): Promise<RouteResult> {
        // TODO: Implement actual Cocoon TEE bridge
        // For now, try Ollama with a larger model as proxy
        try {
            const result = await this.callOllama('deepseek-r1:14b', messages);
            return { ...result, tier: 'cocoon', latencyMs: Date.now() - start };
        } catch {
            throw new Error('Cocoon TEE unavailable');
        }
    }
}
