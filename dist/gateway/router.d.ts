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
export declare class NeuralRouter {
    private swarmUrl;
    private groqKey;
    private cache;
    constructor(swarmUrl: string, _cocoonEnabled: boolean);
    route(requestedModel: string, messages: ChatMessage[]): Promise<RouteResult>;
    private callBackend;
    private callGroq;
    private mapModel;
    routeSmartMix(tier: SmartMixTier, messages: ChatMessage[]): Promise<SmartMixResult>;
    private callSingleGroq;
}
export type SmartMixTier = 'free' | 'standard' | 'pro' | 'ultra';
export interface SmartMixResult {
    content: string;
    tier: SmartMixTier;
    strategy: string;
    modelsUsed: string[];
    latencyMs: number;
    costGstd: number;
}
export declare const SMARTMIX_TIERS: Record<string, {
    name: string;
    nameRU: string;
    cost: number;
    costUsd: number;
    emoji: string;
    expertCount: number;
}>;
export declare function getGstdPrice(): Promise<number>;
/** Recalculate GSTD costs based on current price. Call periodically. */
export declare function refreshDynamicPricing(): Promise<void>;
/** Get cost display string with both GSTD and USD */
export declare function formatCost(tier: SmartMixTier): {
    gstd: string;
    usd: string;
};
//# sourceMappingURL=router.d.ts.map