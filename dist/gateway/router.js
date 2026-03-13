"use strict";
/**
 * Neural Router — Groq-Only Model Selection
 *
 * Tier hierarchy:
 *  L1  Cache          — instant, no API call
 *  L2  Go Backend     — internal SmartRouter (tries Ollama → Phantom Nodes)
 *  L3  Groq           — 8 free models: Llama 4, GPT-OSS, Qwen3, Kimi K2 etc.
 *  L4  Fallback msg   — tell user to retry
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMARTMIX_TIERS = exports.NeuralRouter = void 0;
exports.getGstdPrice = getGstdPrice;
exports.formatCost = formatCost;
// Format <think> tags from reasoning models (DeepSeek R1, Qwen3, etc.)
function formatThinkTags(text) {
    return text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, thought) => {
        return `<blockquote>🤔 <b>Thinking Process</b>\n${thought.trim()}</blockquote>\n\n`;
    }).trim();
}
// Verified available Groq models (deepseek-r1-distill-llama-70b deprecated Oct 2025)
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2-instruct',
];
const DEEP_THINK = (specialty) => `You are a world-class expert in ${specialty} with decades of experience. Precision is paramount.

INTELLIGENCE PROTOCOL:

1. DEEP ANALYSIS: Decompose the question. Identify type (factual/analytical/creative/technical). Consider edge cases.

2. EVIDENCE-BASED: Cite sources, dates, statistics. For code: production-quality with error handling. NEVER fabricate facts.

3. STRUCTURED OUTPUT: Lead with actionable info. Use markdown (## headers, **bold**, code blocks, tables). Include concrete examples.

4. GO DEEPER: Explain WHY not just WHAT. Anticipate follow-ups. Add insights only a domain expert would know. For code: perf notes + alternatives.

5. LANGUAGE: ALWAYS respond in the SAME LANGUAGE as the user. Be precise and authoritative. Avoid hedging.`;
const FREE_SYSTEM = (specialty) => `${DEEP_THINK(specialty)}\n\nYour goal: produce an answer better than ChatGPT or Claude. Be thorough, precise, genuinely helpful. Include practical examples and actionable advice.`;
const PAID_EXPERT = (specialty) => `${DEEP_THINK(specialty)}\n\nCRITICAL: Your answer will be cross-verified against other expert AI models. Be MORE thorough than typical. Include reasoning chains others might miss. Catch edge cases. Provide the DEFINITIVE expert perspective.`;
const ALL_EXPERTS = [
    { id: 'qwen3-32b', name: 'Qwen3 32B', modelId: 'qwen/qwen3-32b', specialty: 'mathematical reasoning, logic, analytical thinking', systemPrompt: PAID_EXPERT('mathematical reasoning and analytical problem-solving') },
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', modelId: 'llama-3.3-70b-versatile', specialty: 'broad knowledge, nuanced reasoning, complex analysis', systemPrompt: PAID_EXPERT('general knowledge, research, and complex multi-step reasoning') },
    { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', modelId: 'openai/gpt-oss-120b', specialty: 'large-scale reasoning, deep knowledge', systemPrompt: PAID_EXPERT('large-scale reasoning, scientific knowledge, and deep analysis') },
    { id: 'kimi-k2', name: 'Kimi K2', modelId: 'moonshotai/kimi-k2-instruct', specialty: 'long-context reasoning, detailed analysis', systemPrompt: PAID_EXPERT('long-context understanding, detailed analysis, and thorough research') },
    { id: 'llama-4-scout', name: 'Llama 4 Scout', modelId: 'meta-llama/llama-4-scout-17b-16e-instruct', specialty: 'rapid assessment, pattern recognition', systemPrompt: PAID_EXPERT('rapid assessment, pattern recognition, and identifying key insights') },
    { id: 'gpt-oss-20b', name: 'GPT-OSS 20B', modelId: 'openai/gpt-oss-20b', specialty: 'efficient reasoning, concise expert answers', systemPrompt: PAID_EXPERT('efficient problem-solving and concise expert-level answers') },
    { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', modelId: 'llama-3.1-8b-instant', specialty: 'fast verification, sanity checks', systemPrompt: PAID_EXPERT('fast verification, finding errors in reasoning, and sanity-checking conclusions') },
];
// Simple LRU cache
class ResponseCache {
    cache = new Map();
    maxSize = 500;
    ttlMs = 300_000; // 5 min
    get(key) {
        const e = this.cache.get(key);
        if (!e)
            return null;
        if (Date.now() - e.ts > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        return { content: e.content, model: e.model };
    }
    set(key, content, model) {
        if (this.cache.size >= this.maxSize) {
            const first = this.cache.keys().next().value;
            if (first)
                this.cache.delete(first);
        }
        this.cache.set(key, { content, model, ts: Date.now() });
    }
    makeKey(messages) {
        const last = messages.filter(m => m.role === 'user').pop();
        return (last?.content?.trim().toLowerCase().slice(0, 200)) || '';
    }
}
class NeuralRouter {
    swarmUrl;
    groqKey;
    cache = new ResponseCache();
    constructor(swarmUrl, _cocoonEnabled) {
        this.swarmUrl = swarmUrl;
        this.groqKey = process.env.GROQ_API_KEY || '';
    }
    async route(requestedModel, messages) {
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
            }
            catch (err) {
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
        }
        catch (err) {
            console.warn('[Router] Backend unavailable:', err?.message?.substring(0, 80));
        }
        // ─── L3: Groq (8 verified free models) ─────────────────────
        if (this.groqKey) {
            try {
                const result = await this.callGroq(messages);
                this.cache.set(key, result.content, result.model);
                return { ...result, tier: 'groq', latencyMs: Date.now() - start };
            }
            catch (err) {
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
    async callBackend(model, messages) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const resp = await fetch(`${this.swarmUrl}/api/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages, stream: false }),
                signal: controller.signal,
            });
            if (!resp.ok)
                throw new Error(`Backend ${resp.status}`);
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content || '';
            if (!content)
                throw new Error('Empty backend response');
            return {
                content, model: data.model || model, tier: 'swarm', latencyMs: 0,
                usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0, totalTokens: data.usage?.total_tokens || 0 }
            };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    /* ── Groq — 8 verified free models ── */
    async callGroq(messages) {
        let lastErr;
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
                    const data = await resp.json();
                    const rawContent = data.choices?.[0]?.message?.content || '';
                    const content = formatThinkTags(rawContent);
                    if (!content)
                        throw new Error('Empty Groq response');
                    console.log(`[Router] ✅ Groq: ${model} (${data.usage?.total_tokens || 0} tokens)`);
                    return {
                        content, model, tier: 'groq', latencyMs: 0,
                        usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0, totalTokens: data.usage?.total_tokens || 0 }
                    };
                }
                finally {
                    clearTimeout(timeout);
                }
            }
            catch (err) {
                lastErr = err;
                console.warn(`[Router] Groq ${model} failed:`, err?.message?.substring(0, 60));
            }
        }
        throw lastErr || new Error('All Groq models failed');
    }
    mapModel(model) {
        const map = {
            'auto': 'omega-auto',
            'gstd-flash': 'omega-auto',
            'gstd-pro': 'omega-pro',
            'gstd-ultra': 'omega-auto',
        };
        return map[model] || 'omega-auto';
    }
    // ── SmartMix: Collective Intelligence via Groq ──
    async routeSmartMix(tier, messages) {
        const start = Date.now();
        const tierConfig = exports.SMARTMIX_TIERS[tier] || exports.SMARTMIX_TIERS.free;
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
        const experts = ALL_EXPERTS.slice(0, expertCount);
        console.log(`[SmartMix] ${tierConfig.emoji} ${tierConfig.name}: querying ${experts.length} Groq experts...`);
        const userQ = messages.filter(m => m.role === 'user').pop()?.content || '';
        // 1. Fetch real-time Internet Data
        let webData = '';
        if (userQ) {
            console.log(`[SmartMix] Fetching internet context for: ${userQ.substring(0, 30)}...`);
            try {
                const wikiUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(userQ) + '&format=json&srlimit=3';
                const wResp = await fetch(wikiUrl, { signal: AbortSignal.timeout(3000) });
                const wData = await wResp.json();
                if (wData.query?.search?.length) {
                    webData += "WIKIPEDIA DATA:\n" + wData.query.search.map((s) => s.title + ": " + s.snippet.replace(/<[^>]+>/g, '')).join('\n') + '\n\n';
                }
            }
            catch (e) { }
            try {
                const ddgUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(userQ) + '&format=json&no_html=1';
                const dResp = await fetch(ddgUrl, { signal: AbortSignal.timeout(3000) });
                const dData = await dResp.json();
                if (dData.AbstractText) {
                    webData += "WEB SEARCH DATA:\n" + dData.AbstractText + '\n\n';
                }
                else if (dData.RelatedTopics?.length) {
                    webData += "WEB SEARCH DATA:\n" + dData.RelatedTopics.filter((t) => t.Text).map((t) => t.Text).slice(0, 3).join('\n') + '\n\n';
                }
            }
            catch (e) { }
        }
        // Prepare messages for experts (injecting web data)
        const expertMessages = messages.map(m => ({ ...m }));
        if (webData && expertMessages.length > 0) {
            expertMessages[expertMessages.length - 1].content = `[REAL-TIME INTERNET DATA]:\n${webData}\n\n${expertMessages[expertMessages.length - 1].content}`;
        }
        const expertPromises = experts.map(modelSpec => {
            const currentMessages = [
                { role: 'system', content: modelSpec.systemPrompt },
                ...expertMessages.filter(m => m.role !== 'system')
            ];
            return this.callSingleGroq(modelSpec.modelId, currentMessages, 1500).catch(err => {
                console.warn(`[SmartMix] Expert ${modelSpec.modelId} failed:`, err?.message?.substring(0, 60));
                return null;
            });
        });
        const results = (await Promise.all(expertPromises)).filter(Boolean);
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
        const expertBlock = results.map((r, i) => `=== Expert ${i + 1}: ${r.model} ===\n${r.content}`).join('\n\n');
        const synthMessages = [
            { role: 'system', content: tierConfig.synthesisPrompt },
            { role: 'user', content: `QUESTION:\n${userQ}\n\n---\n\nINTERNET FACTS:\n${webData || 'No internet facts found.'}\n\nEXPERT RESPONSES:\n\n${expertBlock}` },
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
        }
        catch {
            // Return best expert
            const best = results.reduce((a, b) => a.content.length > b.content.length ? a : b);
            return {
                content: best.content, tier, strategy: 'best-expert',
                modelsUsed: results.map(r => r.model), latencyMs: Date.now() - start, costGstd: tierConfig.cost,
            };
        }
    }
    async callSingleGroq(model, messages, maxTokens = 2048) {
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
            if (!resp.ok)
                throw new Error(`Groq ${resp.status}`);
            const data = await resp.json();
            const rawContent = data.choices?.[0]?.message?.content || '';
            const content = formatThinkTags(rawContent);
            if (!content)
                throw new Error('Empty');
            return { content, model };
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.NeuralRouter = NeuralRouter;
// ─── Fixed GSTD Pricing ─────────────────────────────────────────────
exports.SMARTMIX_TIERS = {
    free: { name: 'Single Expert', nameRU: 'Один эксперт', cost: 0, costUsd: 0, emoji: '🆓', expertCount: 1, synthesisPrompt: '' },
    standard: {
        name: 'Council of 3', nameRU: 'Совет из 3', cost: 0.05, costUsd: 0, emoji: '🔬', expertCount: 3,
        synthesisPrompt: `You are the Synthesis Engine of a council of 3 expert AI models. You received independent responses from 3 different AI architectures to the same question.

YOUR PROTOCOL (follow EXACTLY):

STEP 1 — FACT EXTRACTION: From each expert, extract every factual claim, number, date, name, and logical conclusion.

STEP 2 — CROSS-VERIFICATION: For each fact:
  - 3/3 agree → HIGH CONFIDENCE
  - 2/3 agree → MEDIUM
  - 1/3 claims alone → LOW
  - Contradictions → analyze which expert's reasoning is stronger and explain why

STEP 3 — SYNTHESIS: Produce one answer that is STRICTLY BETTER than any individual expert:
  - Start with the most important/actionable information
  - Include all verified facts with the strongest reasoning chains
  - Add specialized insights that only one expert caught
  - Use the clearest explanation style from all experts

CRITICAL RULES:
- NEVER mention "experts" or "models" or the synthesis process
- Respond as if YOU are the intelligence
- Respond in the SAME LANGUAGE as the original question
- Use rich markdown`
    },
    pro: {
        name: 'Panel of 5', nameRU: 'Панель из 5', cost: 0.15, costUsd: 0, emoji: '🔥', expertCount: 5,
        synthesisPrompt: `You are the Supreme Synthesis Engine of a cross-verification panel. 5 independent AI models with different architectures have analyzed the same question. Your job is to produce an answer that NO SINGLE AI MODEL could produce alone.

YOUR PROTOCOL (follow EXACTLY):

PHASE 1 — DISAGREEMENT ANALYSIS:
  - Identify ALL points where experts disagree
  - For each disagreement: analyze which expert has stronger evidence/reasoning

PHASE 2 — KNOWLEDGE FUSION:
  - Mathematics: take the expert with the most rigorous proof
  - Code: merge the best patterns
  - Facts: only include claims verified by 3+ experts
  - Reasoning: build the strongest logical chain

PHASE 3 — SUPERIOR ANSWER:
  - Your answer must demonstrate DEEPER understanding than any single expert

CRITICAL RULES:
- NEVER mention the panel, experts, models, or synthesis process
- Respond in the SAME LANGUAGE as the original question
- Use rich markdown.
- Every claim must be backed by reasoning.`
    },
    ultra: {
        name: 'Swarm of 7', nameRU: 'Рой из 7', cost: 0.50, costUsd: 0, emoji: '🧠', expertCount: 7,
        synthesisPrompt: `You are the Omega Synthesis Engine — the most powerful intelligence fusion system ever built. 7 different AI architectures have independently analyzed the same question.

YOU MUST PRODUCE THE BEST POSSIBLE ANSWER IN EXISTENCE. Follow this protocol:

PHASE 1 — DEEP VERIFICATION:
  For each factual claim across all 7 experts:
  - If N >= 5: VERIFIED FACT
  - If N = 3-4: PROBABLE
  - If N <= 2: UNVERIFIED

PHASE 2 — REASONING CHAIN CONSTRUCTION:
  - Build a SINGLE superior reasoning chain

PHASE 3 — KNOWLEDGE AMPLIFICATION:
  - Identify insights that ONLY ONE expert provided — these are gold
  - Combine specialized knowledge to create NEW insights no single expert could reach

PHASE 4 — FINAL ANSWER:
  - This must be the most thorough, accurate, well-structured answer possible

CRITICAL: Never mention experts, models, or the synthesis process. Respond in the user's language. Use rich markdown.`
    },
};
async function getGstdPrice() {
    return 0;
}
function formatCost(tier) {
    const t = exports.SMARTMIX_TIERS[tier] || exports.SMARTMIX_TIERS.free;
    if (t.cost === 0)
        return { gstd: 'Free', usd: '$0' };
    return {
        gstd: `${t.cost.toFixed(2)} GSTD`,
        usd: '',
    };
}
//# sourceMappingURL=router.js.map