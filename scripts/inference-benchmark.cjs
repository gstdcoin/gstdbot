#!/usr/bin/env node
const fs = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const { createParser } = require('eventsource-parser');

const suite = 'gstd-inference-acceptance-v1';
const cases = [
    { id: 'arithmetic', prompt: 'What is 17 + 28? Reply with digits only.', check: text => text === '45' },
    { id: 'extraction', prompt: 'Extract the email address from "Contact Ada at ada@example.org". Reply with only the address.', check: text => text === 'ada@example.org' },
    { id: 'selection', prompt: 'Select the even numbers from [1,2,3,4,5,6]. Reply only with a JSON array of numbers.', check: text => JSON.stringify(JSON.parse(text)) === '[2,4,6]' },
    { id: 'object', prompt: 'Return a JSON object with exactly one key status and string value ok. Output only JSON.', check: text => JSON.stringify(JSON.parse(text)) === '{"status":"ok"}' },
];
const parameters = { stream: true, temperature: 0, max_tokens: 64, timeout_ms: 30_000 };
const maxResponseBytes = 256 * 1024;

function providerConfig(env, prefix) {
    const endpoint = new URL(env[prefix + '_URL']);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:'))
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error(prefix + '_URL must use HTTPS or local HTTP, without credentials, query or fragment');
    }
    const model = env[prefix + '_MODEL']?.trim();
    if (!model || model.toLowerCase() === 'auto') throw new Error(prefix + '_MODEL must identify an exact model');
    const expectedModel = env[prefix + '_REPORTED_MODEL']?.trim() || model;
    if (expectedModel.toLowerCase() === 'auto') throw new Error(prefix + '_REPORTED_MODEL must identify an exact model');
    return { endpoint, model, expectedModel, token: env[prefix + '_KEY'] };
}

async function measure(provider, sample, request = fetch, now = () => performance.now()) {
    const start = now();
    let reader;
    try {
        const response = await request(provider.endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: {
                'content-type': 'application/json',
                accept: 'text/event-stream',
                ...(provider.token ? { authorization: 'Bearer ' + provider.token } : {}),
            },
            body: JSON.stringify({
                model: provider.model,
                messages: [{ role: 'user', content: sample.prompt }],
                stream: parameters.stream,
                temperature: parameters.temperature,
                max_tokens: parameters.max_tokens,
            }),
            signal: AbortSignal.timeout(parameters.timeout_ms),
        });
        reader = response.body?.getReader();
        if (!response.ok) return { failure: 'http_' + response.status };
        if (!reader || response.headers.get('content-type')?.split(';')[0].trim() !== 'text/event-stream') {
            return { failure: 'expected_sse' };
        }

        let seenModel = false;
        let firstToken;
        let output = '';
        let finished = false;
        let done = false;
        let failure;
        const parser = createParser(event => {
            if (event.type !== 'event' || failure) return;
            if (event.data.trim() === '[DONE]') {
                done = true;
                return;
            }
            try {
                const chunk = JSON.parse(event.data);
                if (done || !chunk || typeof chunk !== 'object' || chunk.error
                    || chunk._gstd?.error || chunk._gstd?.tier === 'fallback') {
                    failure = 'stream_error';
                    return;
                }
                if (chunk.model != null) {
                    if (chunk.model !== provider.expectedModel) {
                        failure = 'model_mismatch';
                        return;
                    }
                    seenModel = true;
                }
                const choice = chunk.choices?.[0];
                const token = choice?.delta?.content;
                if (typeof token === 'string' && token.length > 0) {
                    if (finished) {
                        failure = 'stream_error';
                        return;
                    }
                    firstToken ??= now() - start;
                    output += token;
                }
                if (choice?.finish_reason != null) {
                    if (finished || choice.finish_reason !== 'stop') failure = 'incomplete_generation';
                    finished = true;
                }
            } catch {
                failure = 'stream_error';
            }
        });

        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0;
        while (!done && !failure) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > maxResponseBytes) return { failure: 'response_too_large' };
            parser.feed(decoder.decode(part.value, { stream: true }));
        }
        if (failure) return { failure };
        if (!done || !finished || firstToken === undefined) return { failure: 'incomplete_stream' };
        if (!seenModel) return { failure: 'model_unverified' };
        let correct = false;
        try { correct = sample.check(output.trim()); } catch { /* Invalid structured output. */ }
        return correct ? { ttft_ms: firstToken } : { failure: 'answer_failed' };
    } catch (error) {
        return { failure: error.name === 'TimeoutError' ? 'timeout' : 'transport_error' };
    } finally {
        void reader?.cancel().catch(() => {});
    }
}

async function run(env) {
    const modelRevision = env.BENCH_MODEL_REVISION?.trim();
    if (!modelRevision) throw new Error('Set BENCH_MODEL_REVISION to the common model artifact revision and quantization');
    const rounds = Number(env.BENCH_ROUNDS || '10');
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 50) throw new Error('BENCH_ROUNDS must be 1–50');
    const providers = { gstd: providerConfig(env, 'GSTD_BENCH'), vast: providerConfig(env, 'VAST_BENCH') };
    const startedAt = new Date().toISOString();
    const samples = { gstd: [], vast: [] };
    for (let round = 0; round < rounds; round++) {
        for (let index = 0; index < cases.length; index++) {
            const sample = cases[index];
            const order = (round + index) % 2 === 0 ? ['gstd', 'vast'] : ['vast', 'gstd'];
            for (const name of order) {
                samples[name].push({ round: round + 1, case: sample.id, ...await measure(providers[name], sample) });
            }
        }
    }
    return {
        suite, model_revision: modelRevision, parameters, rounds,
        started_at: startedAt, finished_at: new Date().toISOString(),
        models: Object.fromEntries(Object.entries(providers).map(([name, provider]) =>
            [name, { requested: provider.model, reported: provider.expectedModel }],
        )),
        samples,
        metrics: Object.fromEntries(Object.entries(samples).map(([name, statuses]) => [name, summarize(statuses)])),
    };
}

function summarize(samples, totalCostUsd = null) {
    const times = samples.map(sample => sample.ttft_ms).filter(time => Number.isFinite(time) && time >= 0)
        .sort((left, right) => left - right);
    const successes = times.length;
    const p95 = successes ? times[Math.ceil(successes * 0.95) - 1] : null;
    return {
        attempts: samples.length,
        successes,
        success_rate: successes / samples.length,
        p95_ttft_ms: p95 === null ? null : Number(p95.toFixed(2)),
        total_cost_usd: totalCostUsd,
        cost_per_success_usd: totalCostUsd === null || !successes ? null : totalCostUsd / successes,
    };
}

function usd(value) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value || '') || !Number.isFinite(Number(value))) {
        throw new Error('Provide both measured total costs in USD as nonnegative decimal amounts');
    }
    return Number(value);
}

async function main() {
    const [command, file, gstdCost, vastCost] = process.argv.slice(2);
    if (command === 'measure' && process.argv.length === 3) {
        console.log(JSON.stringify(await run(process.env), null, 2));
    } else if (command === 'cost' && process.argv.length === 6) {
        const report = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
        const { gstd, vast } = report.samples ?? {};
        if (report.suite !== suite || !Array.isArray(gstd) || !Array.isArray(vast) || !gstd.length || gstd.length !== vast.length) {
            throw new Error('Expected a paired report from this benchmark suite');
        }
        report.metrics = {
            gstd: summarize(gstd, usd(gstdCost)),
            vast: summarize(vast, usd(vastCost)),
        };
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.error('Usage: node scripts/inference-benchmark.cjs measure | cost REPORT.json GSTD_TOTAL_USD VAST_TOTAL_USD');
        process.exitCode = command === '--help' ? 0 : 1;
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { measure, summarize };
