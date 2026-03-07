/**
 * Neural Router — Groq-Only Model Selection
 *
 * Tier hierarchy:
 *  L1  Cache          — instant, no API call
 *  L2  Go Backend     — internal SmartRouter (tries Ollama → Phantom Nodes)
 *  L3  Groq           — 8 free models: Llama 4, GPT-OSS, Qwen3, Kimi K2 etc.
 *  L4  Fallback msg   — tell user to retry
 */

export type RouteTier = 'cache' | 'swarm' | 'groq' | 'fallback' | 'commercial';

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

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Strip <think> tags from reasoning models (Qwen3, etc.)
function stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Verified available Groq models
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'qwen/qwen3-32b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2-instruct',
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
    private cache = new ResponseCache();

    constructor(swarmUrl: string, _cocoonEnabled: boolean) {
        this.swarmUrl = swarmUrl;
        this.groqKey = process.env.GROQ_API_KEY || '';
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

        // Check if user requested a specific Groq model
        const isSpecificGroqModel = GROQ_MODELS.includes(requestedModel);

        if (isSpecificGroqModel && this.groqKey) {
            // ─── Direct Groq: user picked a specific model ────────────
            try {
                console.log(`[Router] Direct Groq request: ${requestedModel}`);
                const result = await this.callSingleGroq(requestedModel, messages, 2048);
                this.cache.set(key, result.content, result.model);
                return {
                    content: result.content, model: result.model, tier: 'groq',
                    latencyMs: Date.now() - start,
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
                };
            } catch (err: any) {
                console.warn(`[Router] Direct Groq ${requestedModel} failed:`, err?.message?.substring(0, 80));
                // Fall through to standard routing
            }
        }

        // Map model names for backend
        const gatewayModel = this.mapModel(requestedModel);

        // ─── L2: Go Backend (SmartRouter → Ollama → Phantom Nodes) ─
        try {
            const result = await this.callBackend(gatewayModel, messages);
            this.cache.set(key, result.content, result.model);
            return { ...result, tier: 'swarm', latencyMs: Date.now() - start };
        } catch (err: any) {
            console.warn('[Router] Backend unavailable:', err?.message?.substring(0, 80));
        }

        // ─── L3: Groq (8 verified free models) ─────────────────────
        if (this.groqKey) {
            try {
                const result = await this.callGroq(messages);
                this.cache.set(key, result.content, result.model);
                return { ...result, tier: 'groq', latencyMs: Date.now() - start };
            } catch (err: any) {
                console.warn('[Router] Groq failed:', err?.message?.substring(0, 80));
            }
        }

        // ─── L4: Fallback message ───────────────────────────────────
        return {
            content: '⚡ Sovereign AI is loading. Please send your message again in a moment while the Swarm initialises. 🐝',
            model: 'fallback',
            tier: 'fallback',
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

    /* ── Groq — 8 verified free models ── */
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
                        body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.7 }),
                        signal: controller.signal,
                    });
                    if (!resp.ok) {
                        const errText = await resp.text().catch(() => '');
                        throw new Error(`Groq ${resp.status}: ${errText.substring(0, 100)}`);
                    }
                    const data: any = await resp.json();
                    const rawContent = data.choices?.[0]?.message?.content || '';
                    const content = stripThinkTags(rawContent);
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

    private mapModel(model: string): string {
        const map: Record<string, string> = {
            'auto': 'omega-auto',
            'gstd-flash': 'omega-auto',
            'gstd-pro': 'omega-pro',
            'gstd-ultra': 'omega-auto',
        };
        return map[model] || 'omega-auto';
    }

    // ── SmartMix: Collective Intelligence via Groq ──
    async routeSmartMix(tier: SmartMixTier, messages: ChatMessage[]): Promise<SmartMixResult> {
        const start = Date.now();
        const tierConfig = SMARTMIX_TIERS[tier] || SMARTMIX_TIERS.free;
        const expertCount = tierConfig.expertCount;

        if (tier === 'free' || expertCount <= 1) {
            const result = await this.route('auto', messages);
            return {
                content: result.content,
                tier: 'free',
                strategy: 'single-' + result.tier,
                modelsUsed: [result.model],
                latencyMs: Date.now() - start,
                costGstd: 0,
            };
        }

        // Query N Groq experts in parallel
        const experts = GROQ_MODELS.slice(0, expertCount);
        console.log(`[SmartMix] ${tierConfig.emoji} ${tierConfig.name}: querying ${experts.length} Groq experts...`);

        const expertPromises = experts.map(model =>
            this.callSingleGroq(model, messages, 1500).catch(err => {
                console.warn(`[SmartMix] Expert ${model} failed:`, err?.message?.substring(0, 60));
                return null;
            })
        );

        const results = (await Promise.all(expertPromises)).filter(Boolean) as Array<{ content: string; model: string }>;

        if (results.length === 0) {
            // Fallback
            const result = await this.route('auto', messages);
            return {
                content: result.content, tier: 'free', strategy: 'fallback',
                modelsUsed: [result.model], latencyMs: Date.now() - start, costGstd: 0,
            };
        }

        console.log(`[SmartMix] ${results.length}/${experts.length} experts responded`);

        // Synthesize consensus
        const expertBlock = results.map((r, i) =>
            `=== Expert ${i + 1}: ${r.model} ===\n${r.content}`
        ).join('\n\n');

        const userQ = messages.filter(m => m.role === 'user').pop()?.content || '';
        const synthMessages: ChatMessage[] = [
            { role: 'system', content: `You are a Collective Intelligence synthesizer. You have ${results.length} expert AI responses. Find consensus, identify unique insights, detect errors by cross-checking. Produce ONE superior answer. Do NOT mention experts. Use markdown. Respond in the user's language.` },
            { role: 'user', content: `QUESTION:\n${userQ}\n\n---\n\nEXPERT RESPONSES:\n\n${expertBlock}` },
        ];

        try {
            const synth = await this.callSingleGroq('llama-3.3-70b-versatile', synthMessages, 4096);
            return {
                content: synth.content,
                tier,
                strategy: 'consensus',
                modelsUsed: results.map(r => r.model),
                latencyMs: Date.now() - start,
                costGstd: tierConfig.cost,
            };
        } catch {
            // Return best expert
            const best = results.reduce((a, b) => a.content.length > b.content.length ? a : b);
            return {
                content: best.content, tier, strategy: 'best-expert',
                modelsUsed: results.map(r => r.model), latencyMs: Date.now() - start, costGstd: tierConfig.cost,
            };
        }
    }

    private async callSingleGroq(model: string, messages: ChatMessage[], maxTokens: number = 2048): Promise<{ content: string; model: string }> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.groqKey}`,
                },
                body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7 }),
                signal: controller.signal,
            });
            if (!resp.ok) throw new Error(`Groq ${resp.status}`);
            const data: any = await resp.json();
            const rawContent = data.choices?.[0]?.message?.content || '';
            const content = stripThinkTags(rawContent);
            if (!content) throw new Error('Empty');
            return { content, model };
        } finally {
            clearTimeout(timeout);
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

// ─── Dynamic Pricing ─────────────────────────────────────────────
// Fixed USD cost per query — GSTD amount adjusts with market price.
// End user always pays the same USD regardless of GSTD fluctuations.
export const SMARTMIX_TIERS: Record<string, {
    name: string; nameRU: string;
    cost: number;       // current GSTD cost (updated dynamically)
    costUsd: number;    // fixed USD cost (never changes)
    emoji: string; expertCount: number;
}> = {
    free: { name: 'Single Expert', nameRU: 'Один эксперт', cost: 0, costUsd: 0, emoji: '🆓', expertCount: 1 },
    standard: { name: 'Council of 3', nameRU: 'Совет из 3', cost: 3.4, costUsd: 0.001, emoji: '🔬', expertCount: 3 },
    pro: { name: 'Panel of 5', nameRU: 'Панель из 5', cost: 10.2, costUsd: 0.003, emoji: '🔥', expertCount: 5 },
    ultra: { name: 'Swarm of 7', nameRU: 'Рой из 7', cost: 17.0, costUsd: 0.005, emoji: '🧠', expertCount: 7 },
};

// Cached GSTD price (refreshed every 60s)
let _cachedGstdPrice = 0.0002946482;
let _lastPriceFetch = 0;

export async function getGstdPrice(): Promise<number> {
    if (Date.now() - _lastPriceFetch < 60_000 && _cachedGstdPrice > 0) {
        return _cachedGstdPrice;
    }
    try {
        const resp = await fetch('https://app.gstdtoken.com/api/v1/market/price');
        if (resp.ok) {
            const data: any = await resp.json();
            _cachedGstdPrice = data.gstd_price_usd || _cachedGstdPrice;
            _lastPriceFetch = Date.now();
        }
    } catch { }
    return _cachedGstdPrice;
}

/** Recalculate GSTD costs based on current price. Call periodically. */
export async function refreshDynamicPricing(): Promise<void> {
    const price = await getGstdPrice();
    if (price <= 0) return;
    for (const key of Object.keys(SMARTMIX_TIERS)) {
        const tier = SMARTMIX_TIERS[key];
        if (tier.costUsd > 0) {
            tier.cost = parseFloat((tier.costUsd / price).toFixed(1));
        }
    }
    console.log(`[Pricing] Updated: 1 GSTD = $${price.toFixed(8)} | Council=${SMARTMIX_TIERS.standard.cost} | Panel=${SMARTMIX_TIERS.pro.cost} | Swarm=${SMARTMIX_TIERS.ultra.cost}`);
}

/** Get cost display string with both GSTD and USD */
export function formatCost(tier: SmartMixTier): { gstd: string; usd: string } {
    const t = SMARTMIX_TIERS[tier] || SMARTMIX_TIERS.free;
    if (t.costUsd === 0) return { gstd: 'Free', usd: '$0' };
    return {
        gstd: `${t.cost.toFixed(1)} GSTD`,
        usd: `$${t.costUsd.toFixed(4)}`,
    };
}

// Refresh pricing on module load & every 60s
refreshDynamicPricing();
setInterval(refreshDynamicPricing, 60_000);

