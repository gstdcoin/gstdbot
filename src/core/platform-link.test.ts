import {keyPairFromSeed,signVerify} from '@ton/crypto';
import {createHash} from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { PlatformLink } from './platform-link.js';

function makePL(): PlatformLink {
    return new PlatformLink({
        platformUrl:   'http://localhost:9999',
        nodeId:        'test-node-id',
        walletAddress: 'EQtest',
        version:       '0.0.0',
    });
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('PlatformLink._processCommands gate', () => {
    it('does not emit when sig field is missing', () => {
        const pl = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));

        (pl as any)._processCommands([{ type: 'restart', timestamp: Date.now() }]);

        expect(received).toHaveLength(0);
    });

    it('does not emit when timestamp is stale (>60 s old)', () => {
        const pl = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));

        (pl as any)._processCommands([
            { type: 'restart', timestamp: Date.now() - 70_000, sig: 'anysig' },
        ]);

        expect(received).toHaveLength(0);
    });

    it('does not emit when verifyFn returns false', () => {
        const pl      = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));
        const alwaysFail = () => false;

        (pl as any)._processCommands(
            [{ type: 'restart', timestamp: Date.now(), sig: 'badsig' }],
            alwaysFail,
        );

        expect(received).toHaveLength(0);
    });

    it('emits the command exactly once when verifyFn returns true', () => {
        const pl      = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));
        const alwaysPass = () => true;

        const cmd = { type: 'restart', timestamp: Date.now(), sig: 'validsig' };
        (pl as any)._processCommands([cmd], alwaysPass);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(cmd);
    });

    it('passes only valid commands from a mixed batch', () => {
        const pl      = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));
        const selective = (cmd: { sig?: string }) => cmd.sig === 'good';
        const ts = Date.now();

        (pl as any)._processCommands([
            { type: 'a', timestamp: ts, sig: 'good' },
            { type: 'b', timestamp: ts, sig: 'bad'  },
            { type: 'c', timestamp: ts              },   // no sig — dropped before verifyFn
        ], selective);

        expect(received).toHaveLength(1);
        expect((received[0] as any).type).toBe('a');
    });
});

describe('PlatformLink registration retries', () => {
    it('retries transient registration failures before the heartbeat interval', async () => {
        vi.useFakeTimers();
        const pl = makePL();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await (pl as any).register();
        expect((pl as any).registered).toBe(false);

        await vi.advanceTimersByTimeAsync(1000);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect((pl as any).registered).toBe(true);
        await pl.stop();
    });
});

describe('PlatformLink task delivery', () => {
    it('uses authenticated GET without a body when legacy Worker polling is configured', async () => {
        vi.stubEnv('GSTD_TASK_POLL_METHOD', 'GET');
        const pl = makePL();
        (pl as any).registered = true;
        (pl as any).nodeId = 'node /?&';
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task: null }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await (pl as any).pollAndProcess();
        const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://localhost:9999/api/v1/tasks/poll?node_id=node%20%2F%3F%26');
        expect(options.method).toBe('GET');
        expect(options.body).toBeUndefined();
        expect(new Headers(options.headers).get('x-wallet-address')).toBe('EQtest');
    });

    it('waits for an in-flight task poll before stopping', async () => {
        const pl = makePL();
        (pl as any).registered = true;
        let resolvePoll!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolvePoll = resolve; })));

        const poll = (pl as any).runTaskPoll();
        await Promise.resolve();
        let stopped = false;
        const stop = pl.stop().then(() => { stopped = true; });
        await Promise.resolve();
        expect(stopped).toBe(false);

        resolvePoll(new Response(JSON.stringify({ task: null }), { status: 200 }));
        await Promise.all([poll, stop]);
        expect(stopped).toBe(true);
    });

    it('uses the authenticated POST poll contract and submits successful results', async () => {
        const pl = makePL();
        (pl as any).registered = true;
        pl.setCapabilitiesProvider(() => ({
            models: ['llama3.2:1b'],
            channels: [],
            apps: 0,
            memory: false,
            openclaw: false,
            dln: false,
            maxConcurrentTasks: 1,
        }));

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                task: {
                    task_id: 'task-1',
                    type: 'inference',
                    payload: { model: 'llama3.2:1b', prompt: 'hello', max_tokens: 12, temperature: 0 },
                },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                model: 'llama3.2:1b', message: { content: 'hello back' },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await (pl as any).pollAndProcess();

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(pl.getStatus().worker).toMatchObject({ resultsSubmitted: 1, lastErrorPhase: null, busy: false });
        expect(pl.getStatus().worker.lastResultSubmitted).not.toBeNull();
        const [pollUrl, pollOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(pollUrl).toBe('http://localhost:9999/api/v1/tasks/poll');
        expect(pollOptions.method).toBe('POST');
        expect(new Headers(pollOptions.headers).get('x-wallet-address')).toBe('EQtest');
        expect(JSON.parse(String(pollOptions.body))).toMatchObject({
            node_id: 'test-node-id',
            capabilities: ['inference', 'llama3.2:1b'],
        });

        const [, inferenceOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(JSON.parse(String(inferenceOptions.body))).toMatchObject({
            model: 'llama3.2:1b', keep_alive: -1, options: {num_ctx: 2048, num_predict: 12, temperature: 0},
            messages: [{ role: 'user', content: 'hello' }],
        });
        const [completionUrl, completionOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
        expect(completionUrl).toBe('http://localhost:9999/api/v1/tasks/complete');
        expect(new Headers(completionOptions.headers).get('x-wallet-address')).toBe('EQtest');
        expect(JSON.parse(String(completionOptions.body))).toEqual({
            task_id: 'task-1',
            node_id: 'test-node-id',
            result: 'hello back',
            model: 'llama3.2:1b',
            latency_ms: expect.any(Number),
        });
    });

    it('does not submit an empty inference result as a completed task', async () => {
        const pl = makePL();
        (pl as any).registered = true;
        const taskError = vi.fn();
        pl.on('task:error', taskError);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                task: { task_id: 'task-2', payload: { prompt: 'hello' } },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                model: 'llama3.2:3b', message: { content: '' },
            }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await (pl as any).pollAndProcess();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(taskError).toHaveBeenCalledOnce();
    });
});

describe('PlatformLink request budget', () => {
    it('polls idle work once per 30 seconds and wakes immediately for a real chat', async () => {
        vi.useFakeTimers();
        const pl = makePL();
        (pl as any).registered = true;
        const request = vi.fn(async () => new Response(JSON.stringify({task:null})));
        vi.stubGlobal('fetch', request);
        pl.startTaskLoop();
        await vi.advanceTimersByTimeAsync(29_000);
        expect(request).not.toHaveBeenCalled();
        await pl.wakeTaskLoop();
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(29_000);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(request).toHaveBeenCalledTimes(2);
        await pl.stop();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('honors Retry-After and does not let chat wakeups bypass a quota backoff', async () => {
        vi.useFakeTimers();
        const pl = makePL();
        (pl as any).registered = true;
        const request = vi.fn()
            .mockResolvedValueOnce(new Response('', {status:429, headers:{'retry-after':'120'}}))
            .mockImplementation(async () => new Response(JSON.stringify({task:null})));
        vi.stubGlobal('fetch', request);
        pl.startTaskLoop();
        await pl.wakeTaskLoop();
        await pl.wakeTaskLoop();
        await vi.advanceTimersByTimeAsync(119_000);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(request).toHaveBeenCalledTimes(2);
        await pl.stop();
    });
});

describe('PlatformLink local compute failure', () => {
    it('keeps quota backoff separate from a failed model so a new chat can wake the worker', async () => {
        vi.useFakeTimers();
        const pl = makePL();
        (pl as any).registered = true;
        const request = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({task:{task_id:'failed-task',payload:{prompt:'hello'}}})))
            .mockResolvedValueOnce(new Response('model failed',{status:500}))
            .mockResolvedValueOnce(new Response(JSON.stringify({task:null})));
        vi.stubGlobal('fetch',request);
        pl.startTaskLoop();
        await pl.wakeTaskLoop();
        expect((pl as any).taskBackoffUntil).toBe(0);
        await pl.wakeTaskLoop();
        expect(request).toHaveBeenCalledTimes(3);
        await pl.stop();
    });
});

describe('PlatformLink reward wallet commands',()=>{
 it('signs the exact canonical payout command and keeps the node authentication wallet unchanged',async()=>{
  const pl=makePL(),key=keyPairFromSeed(Buffer.alloc(32,95)),address='0:'+'66'.repeat(32);
  pl.setIdentity({keyPair:key,pubkeyHex:key.publicKey.toString('hex')});
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({payout:{address,revision:1}})));
  vi.stubGlobal('fetch',fetcher);
  await pl.bindRewardWallet(address,0);
  const [url,options]=fetcher.mock.calls[0] as any;
  expect(url).toBe('http://localhost:9999/api/v1/nodes/payout-wallet');
  const body=JSON.parse(options.body);
  const digest=createHash('sha256').update(JSON.stringify(['gstd:payout:v1','test-node-id',address,0,body.timestamp])).digest();
  expect(signVerify(digest,Buffer.from(body.signature,'hex'),key.publicKey)).toBe(true);
  expect(pl.getStatus().walletAddress).toBe('EQtest');
 });
});

describe('modern model advertisement',()=>{
 it('advertises every installed local model without labelling a static allowlist as loaded VRAM',async()=>{
  const pl=makePL();(pl as any).registered=true;
  pl.setCapabilitiesProvider(()=>({models:['qwen3.5:0.8b'],channels:[],apps:0,memory:false,openclaw:false,dln:false,maxConcurrentTasks:1}));
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({peers_online:1})));vi.stubGlobal('fetch',fetcher);
  await (pl as any).runHeartbeat();
  const body=JSON.parse((fetcher.mock.calls[0] as any)[1].body);
  expect(body.capabilities).toEqual(['qwen3.5:0.8b']);
  expect(body.models_loaded).toBeUndefined();
 });
});


describe('PlatformLink tunnel recovery', () => {
    it('announces a changed URL once without increasing steady-state requests', async () => {
        vi.useFakeTimers();
        const pl = makePL();
        let url = 'https://old.trycloudflare.com';
        vi.spyOn(pl as any, 'readTunnelUrl').mockImplementation(() => url);
        vi.spyOn(pl as any, 'register').mockResolvedValue(true);
        const heartbeat = vi.spyOn(pl as any, 'runHeartbeat').mockResolvedValue(undefined);
        await pl.start(120000);
        await vi.advanceTimersByTimeAsync(10000);
        expect(heartbeat).not.toHaveBeenCalled();
        url = 'https://new.trycloudflare.com';
        await vi.advanceTimersByTimeAsync(5000);
        expect(heartbeat).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10000);
        expect(heartbeat).toHaveBeenCalledTimes(1);
        await pl.stop();
        url = 'https://after-stop.trycloudflare.com';
        await vi.advanceTimersByTimeAsync(120000);
        expect(heartbeat).toHaveBeenCalledTimes(1);
    });
});


describe('PlatformLink exact-model worker results', () => {
    it.each(['other:large', undefined])('does not submit a mismatched or unidentified model (%s)', async returnedModel => {
        const pl = makePL(); (pl as any).registered = true;
        const request = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ task: { task_id: 'fixture-exact', payload: { model: 'wanted:small', prompt: 'fixture' } } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ model: returnedModel, message: { content: 'not an accepted exact answer' } })));
        vi.stubGlobal('fetch', request);
        await (pl as any).pollAndProcess();
        expect(request).toHaveBeenCalledTimes(2);
        expect(pl.getStatus().worker).toMatchObject({ resultsSubmitted: 0, lastErrorPhase: 'inference' });
        expect(pl.getStatus().worker.lastResultSubmitted).toBeNull();
        expect(pl.getStatus().worker.lastPoll).not.toBeNull();
    });
    it('accepts the default latest tag for the same untagged model', async () => {
        const pl = makePL(); (pl as any).registered = true;
        const request = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ task: { task_id: 'fixture-latest', payload: { model: 'wanted', prompt: 'fixture' } } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ model: 'wanted:latest', message: { content: 'accepted exact answer' } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
        vi.stubGlobal('fetch', request);
        await (pl as any).pollAndProcess();
        expect(request).toHaveBeenCalledTimes(3);
        expect(pl.getStatus().worker.resultsSubmitted).toBe(1);
        expect(JSON.parse(String((request.mock.calls[2] as any)[1].body)).model).toBe('wanted:latest');
    });
});


it('reports a missing public route honestly without exposing URL credentials', () => {
    const pl = makePL(); vi.spyOn(pl as any, 'readTunnelUrl').mockReturnValue('');
    vi.stubEnv('GSTD_PUBLIC_URL', 'https://operator:private@node.example');
    expect(pl.getStatus().publicUrl).toBeNull();
    vi.stubEnv('GSTD_PUBLIC_URL', 'https://localhost');
    expect(pl.getStatus().publicUrl).toBeNull();
    vi.stubEnv('GSTD_PUBLIC_URL', 'https://node.example/');
    expect(pl.getStatus().publicUrl).toBe('https://node.example');
});


describe('PlatformLink configured task default', () => {
    it.each(['auto', undefined])('resolves %s to the configured model and reports the concrete response model', async requestedModel => {
        vi.stubEnv('GSTD_DEFAULT_MODEL', 'qwen2.5:0.5b');
        const pl = makePL(); (pl as any).registered = true;
        const request = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ task: { task_id: 'fixture-configured-default', payload: { model: requestedModel, prompt: 'fixture' } } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ model: 'qwen2.5:0.5b', message: { content: 'configured answer' } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
        vi.stubGlobal('fetch', request);
        await (pl as any).pollAndProcess();
        expect(request).toHaveBeenCalledTimes(3);
        expect(JSON.parse(String((request.mock.calls[1] as any)[1].body)).model).toBe('qwen2.5:0.5b');
        expect(JSON.parse(String((request.mock.calls[2] as any)[1].body))).toMatchObject({model:'qwen2.5:0.5b',result:'configured answer'});
        expect(pl.getStatus().worker.resultsSubmitted).toBe(1);
    });
});


describe('PlatformLink heartbeat failure diagnostics', () => {
    it('reports bounded safe failure codes and clears them after recovery', async () => {
        const link = makePL();
        (link as any).registered = true;
        const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetcher = vi.fn().mockResolvedValue({ok:false,status:503,text:async ()=>'private upstream details'});
        vi.stubGlobal('fetch', fetcher);
        try {
            await (link as any).sendHeartbeat();
            await (link as any).sendHeartbeat();
            expect(link.getStatus().lastHeartbeatError).toBe('http_503');
            expect(log).toHaveBeenCalledTimes(1);
            expect(log.mock.calls.flat().join(' ')).not.toContain('private');
            fetcher.mockResolvedValue({ok:true,json:async()=>({})});
            await (link as any).sendHeartbeat();
            expect(link.getStatus().lastHeartbeatError).toBeNull();
            expect(link.getStatus().lastHeartbeat).not.toBeNull();
        } finally {
            log.mockRestore();
            await link.stop();
        }
    });
});
