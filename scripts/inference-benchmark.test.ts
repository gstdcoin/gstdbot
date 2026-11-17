import { test } from 'vitest';
import assert from 'node:assert/strict';
const { measure, summarize } = require('./inference-benchmark.cjs');

const endpoint = new URL('https://benchmark.example/v1/chat/completions');
const provider = { endpoint, model: 'request-id', expectedModel: 'served-id', token: 'fixture' };
const sample = { prompt: 'Reply with 45.', check: (text: string) => text === '45' };
const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
const content = (text: string, model = 'served-id') => frame({ model, choices: [{ delta: { content: text } }] });
const finish = frame({ model: 'served-id', choices: [{ delta: {}, finish_reason: 'stop' }] });
const done = 'data: [DONE]\r\n\r\n';

function response(parts: string[]) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            for (const part of parts) controller.enqueue(encoder.encode(part));
            controller.close();
        },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

test('TTFT starts at the first content delta across split frames', async () => {
    const role = frame({ model: 'served-id', choices: [{ delta: { role: 'assistant' } }] });
    const first = content('4');
    let clock = 100;
    const result = await measure(provider, sample, async (url: URL, options: RequestInit) => {
        assert.equal(url, endpoint);
        assert.equal(options.redirect, 'error');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer fixture');
        assert.equal(typeof options.body, 'string');
        assert.deepEqual(JSON.parse(String(options.body)), {
            model: 'request-id',
            messages: [{ role: 'user', content: 'Reply with 45.' }],
            stream: true,
            temperature: 0,
            max_tokens: 64,
        });
        return response([role, first.slice(0, 25), first.slice(25), content('5'), finish, done]);
    }, () => { const reading = clock; clock += 17; return reading; });
    assert.deepEqual(result, { ttft_ms: 17 });
});

test('rejects incomplete, truncated, wrong-model, fallback and incorrect responses', async () => {
    const failures: Array<[string[], string]> = [
        [[content('45'), finish], 'incomplete_stream'],
        [[content('45'), done], 'incomplete_stream'],
        [[content('45'), frame({ choices: [{ finish_reason: 'length' }] }), done], 'incomplete_generation'],
        [[content('45', 'different'), finish, done], 'model_mismatch'],
        [[content('45'), frame({ _gstd: { tier: 'fallback' } }), finish, done], 'stream_error'],
        [[content('46'), finish, done], 'answer_failed'],
        [[frame({ choices: [{ delta: { content: '45' } }] }), frame({ choices: [{ finish_reason: 'stop' }] }), done], 'model_unverified'],
    ];
    for (const [parts, failure] of failures) {
        assert.deepEqual(await measure(provider, sample, async () => response(parts)), { failure });
    }
});

test('includes failed attempts in the denominator and all charges in cost', () => {
    const samples: Array<{ ttft_ms: number } | { failure: string }> = Array.from(
        { length: 20 }, (_, index) => ({ ttft_ms: index + 1 }),
    );
    samples.push({ failure: 'timeout' }, { failure: 'answer_failed' });
    assert.deepEqual(summarize(samples, 0.82), {
        attempts: 22, successes: 20, success_rate: 20 / 22, p95_ttft_ms: 19,
        total_cost_usd: 0.82, cost_per_success_usd: 0.82 / 20,
    });
    assert.equal(summarize([{ failure: 'timeout' }], 0.1).cost_per_success_usd, null);
    assert.equal(summarize([{ ttft_ms: 10 }]).cost_per_success_usd, null);
});
