import { performance } from 'node:perf_hooks';
import { isCloudModel, localModelOptions } from './local-model-options.js';

const maxResponseBytes = 256 * 1024;
const samplePrompt = 'What is 17 + 28? Reply with digits only.';

export function localSelfTestEndpoint(value: string): URL | null {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)
            || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
        return new URL('/api/chat', url);
    } catch {
        return null;
    }
}

function modelId(value: string): string {
    return value.split('/').at(-1)?.includes(':') ? value : value + ':latest';
}

async function readResult(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('self_test_runtime_failed');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > maxResponseBytes) throw new Error('self_test_runtime_failed');
            chunks.push(part.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
        void reader.cancel().catch(() => {});
    }
}

export async function runHostSelfTest(endpoint: URL, model: string, request = fetch) {
    const tags = await request(new URL('/api/tags', endpoint), {
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
    });
    if (!tags.ok) {
        void tags.body?.cancel().catch(() => {});
        throw new Error('self_test_runtime_failed');
    }
    const installed = (await readResult(tags))?.models;
    if (!Array.isArray(installed)) throw new Error('self_test_runtime_failed');
    if (!installed.some(entry => entry?.name === model)) return null;

    const start = performance.now();
    const response = await request(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: samplePrompt }],
            ...localModelOptions(model),
            stream: false,
            options: { num_predict: 32, temperature: 0 },
        }),
        signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error('self_test_runtime_failed');
    }
    const result = await readResult(response);
    if (typeof result?.model !== 'string' || isCloudModel(result.model)
        || modelId(result.model) !== modelId(model) || result.done !== true || result.error) {
        throw new Error('self_test_runtime_failed');
    }
    const tokens = result.eval_count;
    const duration = result.eval_duration;
    const throughput = Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 32
        && Number.isSafeInteger(duration) && duration > 0 ? tokens * 1e9 / duration : null;
    return {
        model: result.model as string,
        passed: result.done_reason !== 'length' && typeof result.message?.content === 'string'
            && result.message.content.trim() === '45',
        wall_ms: Math.round(performance.now() - start),
        output_tokens_per_second: throughput === null ? null : Math.round(throughput * 10) / 10,
    };
}
