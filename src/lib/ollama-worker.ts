import { setTimeout as delay } from 'node:timers/promises';

type OllamaTaskResult = { done?: unknown; model?: unknown; message?: { content?: unknown } };
const transientStatuses = new Set([502, 503, 504]);

export async function runOllamaTask(url: string, body: string): Promise<OllamaTaskResult> {
    const signal = AbortSignal.timeout(90_000);
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal,
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                if (!transientStatuses.has(response.status)) throw new Error('ollama_request_rejected');
            } else {
                const result = await response.json() as OllamaTaskResult | null;
                if (result?.done !== true) throw new Error('ollama_incomplete_result');
                return result;
            }
        } catch (error) {
            if (signal.aborted) throw new Error('ollama_timeout');
            if (!(error instanceof TypeError)) throw error;
        }
        if (attempt === 1) throw new Error('ollama_unavailable');
        try {
            await delay(500, undefined, { signal });
        } catch {
            throw new Error('ollama_timeout');
        }
    }
}
