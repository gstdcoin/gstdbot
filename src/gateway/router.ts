/**
 * Neural Router — Sovereign-First Model Selection
 *
 * Tier hierarchy:
 *  L1  Cache          — instant, no API call
 *  L2  Go Backend     — internal SmartRouter (tries Ollama → Phantom Nodes)
 *  L3  Groq           — best free tier: llama-3.3-70b, deepseek-r1, qwen etc.
 *  L4  OpenRouter     — best models: claude-3.5-haiku, gemini-flash, mistral
 *  L5  Fallback msg   — tell user to retry
 */

export type RouteTier = 'cache' | 'swarm' | 'groq' | 'openrouter' | 'commercial';

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

// Best Groq models — fast, free tier, best quality
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',   // Best general — 70B, very fast
    'deepseek-r1-distill-llama-70b', // Best reasoning
    'qwen-qwq-32b',              // Best math/logic
    'llama-3.1-70b-versatile',   // Reliable fallback
];

// OpenRouter free/cheap models — backup
const OR_MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free',
    'mistralai/mistral-7b-instruct:free',
];

// Simple LRU cache
class ResponseCache {
    private cache = new Map<string, { content: string; model: string; ts: number }>();
    private maxSize = 500;
    private ttlMs = 300_000; // 5 min

    get(key: string) {
        const e = this.cache.get(key);
        if (!e) return null;
        if (Date.now() - e.ts > this.ttlMs) { this.cache.delete(key); return null; }
        return { content: e.content, model: e.model };
    }

    set(key: string, content: string, model: string) {
        if (this.cache.size >= this.maxSize) {
            const first = this.cache.keys().next().value;
            if (first) this.cache.delete(first);
        }
        this.cache.set(key, { content, model, ts: Date.now() });
    }

    makeKey(messages: ChatMessage[]) {
        const last = messages.filter(m => m.role === 'user').pop();
        return (last?.content?.trim().toLowerCase().slice(0, 200)) || '';
    }
}

export class NeuralRouter {
    private swarmUrl: string;
    private groqKey: string;
    private openrouterKey: string;
    private cache = new ResponseCache();

    constructor(swarmUrl: string, _cocoonEnabled: boolean) {
        this.swarmUrl = swarmUrl;
        this.groqKey = process.env.GROQ_API_KEY || '';
        this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
    }

    async route(requestedModel: string, messages: ChatMessage[]): Promise<RouteResult> {
        const start = Date.now();

        // ─── L1: Cache ─────────────────────────────────────────────
        const key = this.cache.makeKey(messages);
        const cached = this.cache.get(key);
        if (cached) {
            return {
                content: cached.content, model: cached.model, tier: 'cache',
                latencyMs: Date.now() - start, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
        }

        // Map model names
        const gatewayModel = this.mapModel(requestedModel);

        // ─── L2: Go Backend (SmartRouter → Ollama → Phantom Nodes) ─
        try {
            const result = await this.callBackend(gatewayModel, messages);
            this.cache.set(key, result.content, result.model);
            return { ...result, tier: 'swarm', latencyMs: Date.now() - start };
        } catch (err: any) {
            console.warn('[Router] Backend unavailable:', err?.message?.substring(0, 80));
        }

        // ─── L3: Groq (best free: llama-3.3-70b, deepseek-r1, qwen) ─
        if (this.groqKey) {
            try {
                const result = await this.callGroq(messages);
                this.cache.set(key, result.content, result.model);
                return { ...result, tier: 'groq', latencyMs: Date.now() - start };
            } catch (err: any) {
                console.warn('[Router] Groq failed:', err?.message?.substring(0, 80));
            }
        }

        // ─── L4: OpenRouter (claude-haiku, gemini-flash, mistral) ──
        if (this.openrouterKey) {
            try {
                const result = await this.callOpenRouter(messages);
                this.cache.set(key, result.content, result.model);
                return { ...result, tier: 'openrouter', latencyMs: Date.now() - start };
            } catch (err: any) {
                console.warn('[Router] OpenRouter failed:', err?.message?.substring(0, 80));
            }
        }

        // ─── L5: Fallback message ───────────────────────────────────
        return {
            content: '⚡ Sovereign AI is loading. Please send your message again in a moment while the Swarm initialises. 🐝',
            model: 'fallback',
            tier: 'commercial',
            latencyMs: Date.now() - start,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
    }

    /* ── Go Backend ── */
    private async callBackend(model: string, messages: ChatMessage[]): Promise<RouteResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const resp = await fetch(`${this.swarmUrl}/api/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages, stream: false }),
                signal: controller.signal,
            });
            if (!resp.ok) throw new Error(`Backend ${resp.status}`);
            const data: any = await resp.json();
            const content = data.choices?.[0]?.message?.content || '';
            if (!content) throw new Error('Empty backend response');
            return {
                content, model: data.model || model, tier: 'swarm', latencyMs: 0,
                usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0, totalTokens: data.usage?.total_tokens || 0 }
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    /* ── Groq — best free models ── */
    private async callGroq(messages: ChatMessage[]): Promise<RouteResult> {
        let lastErr: any;
        for (const model of GROQ_MODELS) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 20_000);
                try {
                    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.groqKey}`,
                        },
                        body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.7 }),
                        signal: controller.signal,
                    });
                    if (!resp.ok) {
                        const errText = await resp.text().catch(() => '');
                        throw new Error(`Groq ${resp.status}: ${errText.substring(0, 100)}`);
                    }
                    const data: any = await resp.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    if (!content) throw new Error('Empty Groq response');
                    console.log(`[Router] ✅ Groq: ${model} (${data.usage?.total_tokens || 0} tokens)`);
                    return {
                        content, model, tier: 'groq', latencyMs: 0,
                        usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0, totalTokens: data.usage?.total_tokens || 0 }
                    };
                } finally {
                    clearTimeout(timeout);
                }
            } catch (err: any) {
                lastErr = err;
                console.warn(`[Router] Groq ${model} failed:`, err?.message?.substring(0, 60));
            }
        }
        throw lastErr || new Error('All Groq models failed');
    }

    /* ── OpenRouter — quality fallback ── */
    private async callOpenRouter(messages: ChatMessage[]): Promise<RouteResult> {
        let lastErr: any;
        for (const model of OR_MODELS) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 30_000);
                try {
                    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.openrouterKey}`,
                            'HTTP-Referer': 'https://app.gstdtoken.com',
                            'X-Title': 'GSTD Sovereign AI',
                        },
                        body: JSON.stringify({ model, messages, max_tokens: 1024 }),
                        signal: controller.signal,
                    });
                    if (!resp.ok) {
                        const errText = await resp.text().catch(() => '');
                        throw new Error(`OpenRouter ${resp.status}: ${errText.substring(0, 100)}`);
                    }
                    const data: any = await resp.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    if (!content) throw new Error('Empty OpenRouter response');
                    console.log(`[Router] ✅ OpenRouter: ${model}`);
                    return {
                        content, model, tier: 'openrouter', latencyMs: 0,
                        usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0, totalTokens: data.usage?.total_tokens || 0 }
                    };
                } finally {
                    clearTimeout(timeout);
                }
            } catch (err: any) {
                lastErr = err;
                console.warn(`[Router] OpenRouter ${model} failed:`, err?.message?.substring(0, 60));
            }
        }
        throw lastErr || new Error('All OpenRouter models failed');
    }

    private mapModel(model: string): string {
        const map: Record<string, string> = {
            'auto': 'omega-auto',
            'gstd-flash': 'omega-auto',
            'gstd-pro': 'omega-pro',
            'gstd-ultra': 'omega-auto',
            'cocoon-auto': 'omega-auto', // Cocoon disabled — route to backend
        };
        return map[model] || 'omega-auto';
    }

    // ── SmartMix: Unified Model Mixing via Backend ──

    async routeSmartMix(tier: SmartMixTier, messages: ChatMessage[]): Promise<SmartMixResult> {
        const start = Date.now();

        // Try SmartMix endpoint on Go backend
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60_000); // 60s for multi-model
            try {
                const resp = await fetch(`${this.swarmUrl}/api/v1/chat/smartmix`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: `mix-${tier}`,
                        messages,
                        mix_tier: tier,
                        stream: false,
                    }),
                    signal: controller.signal,
                });
                if (!resp.ok) {
                    const errText = await resp.text().catch(() => '');
                    throw new Error(`SmartMix backend ${resp.status}: ${errText.substring(0, 150)}`);
                }
                const data: any = await resp.json();
                const content = data.choices?.[0]?.message?.content || '';
                if (!content) throw new Error('Empty SmartMix response');

                console.log(`[SmartMix] ✅ ${tier} | strategy=${data.smart_mix?.strategy} | models=${data.smart_mix?.models_used?.join(', ')} | ${data.smart_mix?.latency_ms}ms`);

                return {
                    content,
                    tier: data.smart_mix?.tier || tier,
                    strategy: data.smart_mix?.strategy || 'unknown',
                    modelsUsed: data.smart_mix?.models_used || [],
                    latencyMs: Date.now() - start,
                    costGstd: data.smart_mix?.cost_gstd || 0,
                };
            } finally {
                clearTimeout(timeout);
            }
        } catch (err: any) {
            console.warn(`[SmartMix] Backend failed for tier ${tier}:`, err?.message?.substring(0, 100));

            // Fallback: use standard NeuralRouter (always works)
            const result = await this.route('auto', messages);
            return {
                content: result.content,
                tier: 'free',
                strategy: 'fallback-' + result.tier,
                modelsUsed: [result.model],
                latencyMs: Date.now() - start,
                costGstd: 0,
            };
        }
    }
}

// SmartMix types
export type SmartMixTier = 'free' | 'standard' | 'pro' | 'ultra';

export interface SmartMixResult {
    content: string;
    tier: SmartMixTier;
    strategy: string;
    modelsUsed: string[];
    latencyMs: number;
    costGstd: number;
}

export const SMARTMIX_TIERS = {
    free: { name: 'Swarm Free', nameRU: 'Рой Бесплатный', cost: 0, emoji: '🆓' },
    standard: { name: 'Swarm Standard', nameRU: 'Рой Стандарт', cost: 0.01, emoji: '⚡' },
    pro: { name: 'Swarm Pro', nameRU: 'Рой Про', cost: 0.05, emoji: '🔥' },
    ultra: { name: 'Swarm Ultra', nameRU: 'Рой Ультра', cost: 0.15, emoji: '🧠' },
};
