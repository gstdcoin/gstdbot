import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import type { Express } from 'express';
import { OmegaGateway } from './server.js';

const BOT_TOKEN = 'test-internal-bot-token';
const LINKED_WALLET = `EQ${'A'.repeat(46)}`;

let gatewayServer: Server | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let previousBotToken: string | undefined;

function postJson(
    port: number,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
    path = '/api/v1/free-api/key',
) {
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
        const request = httpRequest({
            hostname: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
        }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
                try {
                    resolve({
                        status: response.statusCode || 0,
                        body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('error', reject);
        request.end(JSON.stringify(body));
    });
}

describe('gateway free API key authorization', () => {
    beforeEach(async () => {
        previousBotToken = process.env.TELEGRAM_BOT_TOKEN;
        process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const gateway = new OmegaGateway({
            apiPort: 0,
            swarmUrl: 'https://platform.example',
            cocoonEnabled: false,
            sovereigntyMode: 'full',
        });
        const app = Reflect.get(gateway, 'app') as Express;
        gatewayServer = app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve, reject) => {
            gatewayServer?.once('listening', resolve);
            gatewayServer?.once('error', reject);
        });
    });

    afterEach(async () => {
        if (gatewayServer?.listening) {
            await new Promise<void>((resolve, reject) => {
                gatewayServer?.close((error) => error ? reject(error) : resolve());
            });
        }
        gatewayServer = undefined;
        vi.unstubAllGlobals();
        if (previousBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
        else process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
    });

    async function issueKey(body: Record<string, unknown>, token?: string) {
        const address = gatewayServer?.address();
        if (!address || typeof address === 'string') throw new Error('Gateway test server is not listening');
        return postJson(address.port, body, token ? { 'X-Bot-Token': token } : {});
    }

    async function pushTask(body: Record<string, unknown>) {
        const address = gatewayServer?.address();
        if (!address || typeof address === 'string') throw new Error('Gateway test server is not listening');
        return postJson(address.port, body, {}, '/api/v1/tasks/push');
    }

    it('rejects unauthenticated key issuance before resolving a wallet', async () => {
        const response = await issueKey({ telegram_id: '123456', wallet_address: LINKED_WALLET });

        expect(response.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a wallet that differs from the verified Telegram link', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({
            telegram_id: '123456',
            wallet: LINKED_WALLET,
            linked: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const response = await issueKey(
            { telegram_id: '123456', wallet_address: `UQ${'B'.repeat(46)}` },
            BOT_TOKEN,
        );

        expect(response.status).toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: { 'X-Bot-Token': BOT_TOKEN },
        });
    });

    it('issues a key only after verifying the Telegram link and live balance', async () => {
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/telegram/bot/wallet?')) {
                return new Response(JSON.stringify({
                    telegram_id: '123456',
                    wallet: LINKED_WALLET,
                    linked: true,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (url.includes('/balance/public?')) {
                return new Response(JSON.stringify({ balance_gstd: 10_000 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            throw new Error(`Unexpected upstream request: ${url}`);
        });

        const response = await issueKey({ telegram_id: '123456' }, BOT_TOKEN);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ ok: true, wallet: LINKED_WALLET, balance: 10_000 });
        expect(response.body.api_key).toEqual(expect.stringMatching(/^gstd_free_/));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports upstream balance failures instead of treating them as zero balance', async () => {
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/telegram/bot/wallet?')) {
                return new Response(JSON.stringify({ wallet: LINKED_WALLET, linked: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response('Unavailable', { status: 503 });
        });

        const response = await issueKey({ telegram_id: '123456' }, BOT_TOKEN);

        expect(response.status).toBe(502);
        expect(response.body).toMatchObject({
            error: 'Could not verify the Telegram wallet or GSTD balance',
        });
    });

    it('ignores caller-controlled platform URLs when reporting pushed task completion', async () => {
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url === 'http://127.0.0.1:11434/v1/chat/completions') {
                return new Response(JSON.stringify({
                    choices: [{ message: { content: 'task result' } }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (url === 'https://platform.example/api/v1/tasks/complete') {
                return new Response('{}', { status: 200 });
            }
            throw new Error(`Unexpected request target: ${url}`);
        });

        const response = await pushTask({
            task_id: 'task-123',
            prompt: 'finish the task',
            platform_url: 'http://127.0.0.1:2375',
        });
        expect(response.status).toBe(200);

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const targets = fetchMock.mock.calls.map(([target]) => String(target));
        expect(targets).toContain('https://platform.example/api/v1/tasks/complete');
        expect(targets).not.toContain('http://127.0.0.1:2375/api/v1/tasks/complete');
    });
});
