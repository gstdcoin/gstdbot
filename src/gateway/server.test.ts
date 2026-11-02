import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import type { Express } from 'express';
import { OmegaGateway } from './server.js';

const BOT_TOKEN = 'test-internal-bot-token';
const LINKED_WALLET = `EQ${'A'.repeat(46)}`;

let gatewayServer: Server | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let previousBotToken: string | undefined;
let previousConfigDir: string | undefined;
let previousSetupToken: string | undefined;

function postJson(
    port: number,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
    path = '/api/v1/free-api/key',
    method = 'POST',
) {
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
        const request = httpRequest({
            hostname: '127.0.0.1',
            port,
            path,
            method,
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
        request.end(method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body));
    });
}

describe('gateway free API key authorization', () => {
    beforeEach(async () => {
        previousConfigDir=process.env.GSTD_CONFIG_DIR;
        previousSetupToken=process.env.GSTD_DASHBOARD_SETUP_TOKEN;
        process.env.GSTD_CONFIG_DIR=mkdtempSync(join(tmpdir(),'gstd-gateway-auth-'));
        process.env.GSTD_DASHBOARD_SETUP_TOKEN='test-setup-token-that-is-longer-than-thirty-two';
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
        if(previousConfigDir===undefined)delete process.env.GSTD_CONFIG_DIR;else process.env.GSTD_CONFIG_DIR=previousConfigDir;
        if(previousSetupToken===undefined)delete process.env.GSTD_DASHBOARD_SETUP_TOKEN;else process.env.GSTD_DASHBOARD_SETUP_TOKEN=previousSetupToken;
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

    it.each(['/api/node/status','/api/node/usage/recent','/api/node/events','/api/update'])('does not treat a loopback/tunnel request as operator authorization: %s',async path=>{
        const address=gatewayServer!.address();
        if(!address || typeof address==='string')throw Error('No server');
        const response=await postJson(address.port,{}, {},path);
        expect(response.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(['/api/bridge/send','/api/telegram/webhook','/api/system/reset','/api/wallet/export'])('retires unsafe host/financial services before running their handler: %s',async path=>{
        const address=gatewayServer!.address();
        if(!address || typeof address==='string')throw Error('No server');
        const response=await postJson(address.port,{}, {},path);
        expect(response.status).toBe(410);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('sets a salted operator PIN and permits login/control only with a valid session',async()=>{
        const address=gatewayServer!.address();
        if(!address || typeof address==='string')throw Error('No server');
        const setup=await postJson(address.port,{setupToken:process.env.GSTD_DASHBOARD_SETUP_TOKEN,pin:'12345678'}, {},'/api/auth/setup');
        expect(setup.status).toBe(200);
        const login=await postJson(address.port,{pin:'12345678'}, {},'/api/auth/login');
        expect(login.status).toBe(200);
        expect(login.body.token).toEqual(expect.any(String));
        const change=await postJson(address.port,{current_pin:'12345678',new_pin:'87654321'},
            {Authorization:'Bearer '+login.body.token},'/api/auth/change-pin');
        expect(change.status).toBe(200);
        expect((await postJson(address.port,{pin:'87654321'}, {},'/api/auth/login')).status).toBe(200);
    });
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
    it('protects operator measurements, payout setup and model downloads before any side effect', async () => {
        const address = gatewayServer!.address() as {port:number};
        for (const path of ['/api/ollama/catalog','/api/ollama/catalog/refresh','/api/node/reward-wallet','/api/node/operator','/api/node/payout-address','/api/ollama/models/pull','/api/check-update','/api/update']) {
            const result = await postJson(address.port, {address: LINKED_WALLET,model:'llama3.2:3b'}, {}, path);
            expect(result.status).toBe(401);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('validates payout address after operator authentication', async () => {
        const address = gatewayServer!.address() as {port:number};
        const login = await postJson(address.port, {pin:'83572914',setupToken:process.env.GSTD_DASHBOARD_SETUP_TOKEN}, {}, '/api/auth/setup');
        expect(login.status).toBe(200);
        const result = await postJson(address.port, {address:'not-a-ton-wallet'}, {Authorization:'Bearer '+login.body.token}, '/api/node/payout-address');
        expect(result.status).toBe(400);
        expect(result.body.error).toBe('invalid_ton_address');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows local operator measurements and distinguishes empty Ollama from an unavailable service', async () => {
        const address = gatewayServer!.address() as {port:number};
        const login = await postJson(address.port, {pin:'83572914',setupToken:process.env.GSTD_DASHBOARD_SETUP_TOKEN}, {}, '/api/auth/setup');
        const headers = {Authorization:'Bearer '+login.body.token};
        const overview = await postJson(address.port, {}, headers, '/api/node/operator', 'GET');
        expect(overview.status).toBe(200);
        expect(overview.body).toMatchObject({compute:{active:0,capacity:1},requests:0,payout_address:null,platform:{registered:false}});
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({models:[]})));
        const empty = await postJson(address.port, {}, headers, '/api/ollama/models', 'GET');
        expect(empty.body).toMatchObject({ollama_available:true,installed:[],running:[]});
        fetchMock.mockRejectedValue(new Error('Ollama offline'));
        const down = await postJson(address.port, {}, headers, '/api/ollama/models', 'GET');
        expect(down.body).toMatchObject({ollama_available:false,installed:[]});
    });
    it('keeps model download progress intact when an upstream JSON record spans chunks', async () => {
        const address = gatewayServer!.address() as {port:number};
        const login = await postJson(address.port, {pin:'83572914',setupToken:process.env.GSTD_DASHBOARD_SETUP_TOKEN}, {}, '/api/auth/setup');
        const encoder = new TextEncoder();
        fetchMock.mockImplementation(async (url:string) => {
            if(String(url).endsWith('/api/pull'))return new Response(new ReadableStream({
                start(controller){for(const part of ['{"status":"pulling","tot','al":100,"completed":50}\n{"status":"suc','cess"}\n'])controller.enqueue(encoder.encode(part));controller.close();}
            }));
            return new Response(JSON.stringify({models:[]}));
        });
        const text = await new Promise<string>((resolve,reject)=>{
            const req=httpRequest({hostname:'127.0.0.1',port:address.port,path:'/api/ollama/models/pull',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.body.token}},res=>{
                let body='';res.on('data',chunk=>body+=chunk.toString());res.on('end',()=>resolve(body));
            });req.on('error',reject);req.end(JSON.stringify({model:'qwen2.5:0.5b'}));
        });
        expect(text).toContain('"completed":50');
        expect(text).toContain('"status":"success"');
    });

    it('offers an authenticated hardware-labelled catalog without polling an internet service', async () => {
        const address = gatewayServer!.address() as {port:number};
        const login = await postJson(address.port, {pin:'83572914',setupToken:process.env.GSTD_DASHBOARD_SETUP_TOKEN}, {}, '/api/auth/setup');
        const result=await postJson(address.port, {}, {Authorization:'Bearer '+login.body.token}, '/api/ollama/catalog','GET');
        expect(result.status).toBe(200);
        const body=result.body as any;
        expect(body.models.length).toBeGreaterThanOrEqual(10);
        expect(body.models.find((m:any)=>m.id==='qwen3.5:0.8b').compatibility.runtime_validation).toBe('required');
        expect(body.hardware.cpu_cores).toBeGreaterThan(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('protects model deletion with operator auth and live Ollama state, preserving exact HF names', async () => {
        const address=gatewayServer!.address() as {port:number};
        const path='/api/ollama/models/'+encodeURIComponent('hf.co/example/model-GGUF:file.gguf');
        expect((await postJson(address.port,{}, {},path,'DELETE')).status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
        const login=await postJson(address.port,{pin:'83572914',setupToken:process.env.GSTD_DASHBOARD_SETUP_TOKEN},{},'/api/auth/setup');
        const headers={Authorization:'Bearer '+login.body.token};
        fetchMock.mockResolvedValue(new Response(JSON.stringify({models:[{name:'hf.co/example/model-GGUF:file.gguf'}]})));
        const loaded=await postJson(address.port,{},headers,path,'DELETE');
        expect(loaded.status).toBe(409);
        expect(loaded.body.error).toBe('model_loaded');
        expect(fetchMock.mock.calls.some(([,o]:any)=>o?.method==='DELETE')).toBe(false);
        fetchMock.mockClear();
        fetchMock.mockRejectedValue(new Error('offline private upstream detail'));
        const offline=await postJson(address.port,{},headers,path,'DELETE');
        expect(offline.status).toBe(503);
        expect(JSON.stringify(offline.body)).not.toContain('private upstream');
        fetchMock.mockClear();
        fetchMock.mockImplementation(async(url:string,options:any)=>{
            if(String(url).endsWith('/api/delete')){
                expect(JSON.parse(options.body)).toEqual({name:'hf.co/example/model-GGUF:file.gguf'});
                return new Response(null,{status:200});
            }
            return new Response(JSON.stringify({models:[]}));
        });
        const deleted=await postJson(address.port,{},headers,path,'DELETE');
        expect(deleted.status).toBe(200);
        expect(deleted.body.removed).toBe('hf.co/example/model-GGUF:file.gguf');
        expect(fetchMock.mock.calls.filter(([,o]:any)=>o?.method==='DELETE')).toHaveLength(1);
    });

});
