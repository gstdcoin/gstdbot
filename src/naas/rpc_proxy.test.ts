import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { request as httpRequest, get as httpGet } from 'http';

vi.mock('../gateway/server.js', () => ({ logActivity: vi.fn() }));

import { GSTDRPCProxy } from './rpc_proxy.js';

const TEST_PORT = 19002;
let proxy: GSTDRPCProxy;

// ─── Server lifecycle ───────────────────────────────────────────────────────

beforeAll(() => new Promise<void>((resolve) => {
    proxy = new GSTDRPCProxy(TEST_PORT);
    proxy.start();
    setTimeout(resolve, 100);
}));

afterAll(() => proxy.stop());
afterEach(() => vi.unstubAllGlobals());

// ─── HTTP helpers (bypass global fetch mock) ────────────────────────────────

function post(
    path: string,
    headers: Record<string, string>,
    body: string,
): Promise<{ status: number; data: string }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { hostname: 'localhost', port: TEST_PORT, path, method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers } },
            (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode!, data }));
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function options(path: string): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { hostname: 'localhost', port: TEST_PORT, path, method: 'OPTIONS' },
            (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode! })); },
        );
        req.on('error', reject);
        req.end();
    });
}

function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
        httpGet({ hostname: 'localhost', port: TEST_PORT, path }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode!, json: JSON.parse(data || '{}') }));
        }).on('error', reject);
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GSTDRPCProxy — health', () => {
    it('GET /health returns 200 with stats', async () => {
        const { status, json } = await get('/health');
        expect(status).toBe(200);
        expect(json.status).toBe('ok');
        expect(typeof json.requests).toBe('number');
        expect(Array.isArray(json.chains)).toBe(true);
        expect((json.chains as string[]).length).toBeGreaterThan(0);
    });
});

describe('GSTDRPCProxy — CORS preflight', () => {
    it('OPTIONS returns 204', async () => {
        const { status } = await options('/rpc/eth');
        expect(status).toBe(204);
    });
});

describe('GSTDRPCProxy — routing / auth', () => {
    it('returns 401 when X-GSTD-Key header is absent', async () => {
        const { status, data } = await post('/rpc/eth', {}, '{"method":"eth_blockNumber","id":1}');
        expect(status).toBe(401);
        expect(JSON.parse(data).error).toMatch(/X-GSTD-Key/);
    });

    it('returns 404 for an unrecognised path', async () => {
        const { status } = await post('/unknown', { 'X-GSTD-Key': 'k' }, '{}');
        expect(status).toBe(404);
    });
});

describe('GSTDRPCProxy — payment gate (fail-closed)', () => {
    it('returns 503 when payment API is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
        const { status, data } = await post(
            '/rpc/eth',
            { 'X-GSTD-Key': 'key1' },
            '{"method":"eth_blockNumber","id":1}',
        );
        expect(status).toBe(503);
        expect(JSON.parse(data).error).toMatch(/temporarily unavailable/i);
    });

    it('returns 402 when balance is insufficient', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ success: false }),
        }));
        const { status, data } = await post(
            '/rpc/eth',
            { 'X-GSTD-Key': 'key2' },
            '{"method":"eth_blockNumber","id":1}',
        );
        expect(status).toBe(402);
        expect(JSON.parse(data).error).toMatch(/balance/i);
    });

    it('returns 402 when payment API returns non-ok status', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, status: 403,
            json: async () => ({}),
        }));
        const { status } = await post(
            '/rpc/eth',
            { 'X-GSTD-Key': 'key3' },
            '{"method":"eth_blockNumber","id":1}',
        );
        expect(status).toBe(402);
    });
});

describe('GSTDRPCProxy — chain forwarding', () => {
    it('forwards to chain and returns its response when payment succeeds', async () => {
        const chainResp = { jsonrpc: '2.0', result: '0x10d4f', id: 1 };
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => chainResp }),
        );
        const { status, data } = await post(
            '/rpc/eth',
            { 'X-GSTD-Key': 'key4' },
            '{"method":"eth_blockNumber","id":1}',
        );
        expect(status).toBe(200);
        expect(JSON.parse(data).result).toBe('0x10d4f');
    });

    it('returns 503 with JSON-RPC error when chain node is unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
            .mockRejectedValueOnce(new Error('ECONNREFUSED chain')),
        );
        const { status, data } = await post(
            '/rpc/eth',
            { 'X-GSTD-Key': 'key5' },
            '{"method":"eth_blockNumber","id":1}',
        );
        expect(status).toBe(503);
        expect(JSON.parse(data).error.code).toBe(-32603);
    });

    it('returns 400 for unsupported chain', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }),
        );
        const { status, data } = await post(
            '/rpc/unknownchain',
            { 'X-GSTD-Key': 'key6' },
            '{"method":"eth_blockNumber","id":1}',
        );
        expect(status).toBe(400);
        expect(JSON.parse(data).error.message).toMatch(/not supported/);
    });
});

describe('GSTDRPCProxy — body validation', () => {
    it('returns 413 when body exceeds 64 KiB', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const bigBody = 'x'.repeat(65537);
        const { status } = await post('/rpc/eth', { 'X-GSTD-Key': 'key7' }, bigBody);
        expect(status).toBe(413);
    });
});

describe('GSTDRPCProxy — getStats', () => {
    it('getStats returns correct structure', () => {
        const stats = proxy.getStats();
        expect(typeof stats.requests).toBe('number');
        expect(typeof stats.gstd_earned).toBe('number');
        expect(Array.isArray(stats.supported_chains)).toBe(true);
    });
});
