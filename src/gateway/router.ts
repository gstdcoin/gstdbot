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

// Model mappings — use Go backend gateway model names, NOT raw Ollama names
const MODEL_MAP: Record<string, string> = {
    'auto': 'omega-auto',
    'gstd-flash': 'omega-auto',
    'gstd-pro': 'omega-pro',
    'gstd-ultra': 'omega-auto',
    'cocoon-auto': 'cocoon-auto',
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
        // Always use gateway model names — Go backend handles routing internally
        const gatewayModel = MODEL_MAP[requestedModel] || 'omega-auto';

        // ─── L2: Swarm (Go Backend) ─────────────────────────────
        try {
            const result = await this.callSwarm(gatewayModel, messages);
            this.cache.set(cacheKey, result.content, result.model);
            return {
                ...result,
                tier: 'swarm',
                latencyMs: Date.now() - start,
            };
        } catch (err: any) {
            console.warn('[Router] Swarm unavailable, trying fallbacks...', err?.message);
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
     * Call Swarm backend (Go Gateway — OpenAI-compatible)
     */
    private async callSwarm(model: string, messages: ChatMessage[]): Promise<RouteResult> {
        const response = await fetch(`${this.swarmUrl}/api/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                stream: false,
            }),
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            throw new Error(`Backend ${response.status}: ${errBody.substring(0, 100)}`);
        }

        const data: any = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        if (!content) {
            throw new Error('Empty response from backend');
        }

        return {
            content,
            model: data.model || model,
            tier: 'swarm',
            latencyMs: 0,
            usage: {
                promptTokens: data.usage?.prompt_tokens || 0,
                completionTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0,
            },
        };
    }

    /**
     * Route to Cocoon TEE (L3) — uses Go backend cocoon-auto model
     */
    private async routeToCocoon(messages: ChatMessage[], start: number): Promise<RouteResult> {
        try {
            const result = await this.callSwarm('cocoon-auto', messages);
            return { ...result, tier: 'cocoon', latencyMs: Date.now() - start };
        } catch {
            throw new Error('Cocoon TEE unavailable');
        }
    }
}
