import { describe, expect, it, vi } from 'vitest';
import { localSelfTestEndpoint, runHostSelfTest } from './host-self-test.js';

const endpoint = new URL('http://127.0.0.1:11434/api/chat');
const model = 'qwen3.5:0.8b';
const response = {
    model, done: true, done_reason: 'stop',
    message: { content: '45' }, eval_count: 4, eval_duration: 500_000_000,
};

function fixture(value: unknown) {
    return vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ models: [{ name: model }] }))
        .mockResolvedValueOnce(Response.json(value));
}

describe('host self-test', () => {
    it('uses only a loopback runtime and refuses credentials and redirects', async () => {
        expect(localSelfTestEndpoint(endpoint.origin)).toEqual(endpoint);
        expect(localSelfTestEndpoint('http://[::1]:11434')?.pathname).toBe('/api/chat');
        for (const url of ['https://example.com', 'http://localhost.example.com', 'http://u:p@localhost', 'http://localhost?x=1']) {
            expect(localSelfTestEndpoint(url)).toBeNull();
        }
        const request = fixture(response);
        expect(await runHostSelfTest(endpoint, model, request)).toMatchObject({
            model, passed: true, output_tokens_per_second: 8,
        });
        expect(request.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
        const settings = JSON.parse(String(request.mock.calls[1][1]?.body));
        expect(settings).toMatchObject({ model, think: false, stream: false, options: { num_predict: 32, temperature: 0 } });
    });

    it('never generates with a model missing from the current installed list', async () => {
        const request = fixture(response);
        await expect(runHostSelfTest(endpoint, 'different:latest', request)).resolves.toBeNull();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('rejects substituted models and incomplete results, and exposes failed acceptance honestly', async () => {
        await expect(runHostSelfTest(endpoint, model, fixture({ ...response, model: 'different:latest' })))
            .rejects.toThrow('self_test_runtime_failed');
        await expect(runHostSelfTest(endpoint, model, fixture({ ...response, done: false })))
            .rejects.toThrow('self_test_runtime_failed');
        expect(await runHostSelfTest(endpoint, model, fixture({
            ...response, message: { content: '46' }, eval_duration: 0,
        }))).toMatchObject({ passed: false, output_tokens_per_second: null });
    });
});
