import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/demand-tracker.js', () => ({ demandTracker: { record: vi.fn() } }));
import { NeuralRouter } from './router.js';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const response = (body: unknown, status=200) => new Response(JSON.stringify(body), {status});
describe('NeuralRouter canonical task queue', () => {
  it('submits the current payload contract and reads the accepted public result', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/network/stats')) return response({ active_workers: 1 });
      if (url.endsWith('/tasks/submit')) return response({ task_id: 'task/1' });
      if (url.includes('/tasks/result?')) return response({ready:true,result:'real answer',node_id:'worker'});
      throw Error('Unexpected endpoint: '+url);
    });
    vi.stubGlobal('fetch',request);
    const router = new NeuralRouter('',false);
    const messages = [{role:'user' as const,content:'hello'}];
    const pending = router.route('llama3.2:3b', messages, undefined, {maxTokens:12,temperature:0,privacy:'network'});
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toMatchObject({content:'real answer',nodeId:'worker',tier:'gstd'});
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
      type:'inference',payload:{model:'llama3.2:3b',prompt:JSON.stringify(messages),max_tokens:12,temperature:0,telegram_id:0},
    });
    expect(request.mock.calls[3][0]).toContain('/tasks/result?task_id=task%2F1');
  });
  it('does not reuse an answer across different conversation context or models', async () => {
    const request = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/network/stats') ? response({active_workers:0}) : response({
        model:'llama3.2:3b',message:{content:'computed answer'},
      }));
    vi.stubGlobal('fetch',request);
    const router = new NeuralRouter('',false);
    const first = [{role:'system' as const,content:'context one'},{role:'user' as const,content:'same question'}];
    const second = [{role:'system' as const,content:'context two'},{role:'user' as const,content:'same question'}];
    await router.route('llama3.2:3b',first,undefined,{cache:true});
    expect((await router.route('llama3.2:3b',first,undefined,{cache:true})).tier).toBe('cache');
    expect((await router.route('llama3.2:3b',second,undefined,{cache:true})).tier).toBe('gstd');
    await expect(router.route('other:model',second,undefined,{cache:true})).rejects.toThrow('requested_model_unavailable');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('preserves the requested generation limits on local fallback', async () => {
    const request = vi.fn().mockResolvedValueOnce(response({
      message:{content:'short answer'},
    }));
    vi.stubGlobal('fetch',request);
    await new NeuralRouter('',false).route('llama3.2:3b',[{role:'user',content:'hello'}],undefined,{maxTokens:9,temperature:0});
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({options:{num_ctx:2048,num_predict:9,temperature:0},keep_alive:-1});
  });
});

it('fails explicitly when the requested model cannot run instead of returning a success placeholder', async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({error:'not found'},404)));
 await expect(new NeuralRouter('',false).route('missing:model',[{role:'user',content:'hello'}]))
  .rejects.toMatchObject({message:'requested_model_unavailable',status:503});
});


it.each(['unknown-model', 'openai/gpt-oss-20b', 'qwen/qwen3-32b'])(
 'does not substitute an explicit model ID %s', async(model)=>{
 const request = vi.fn().mockResolvedValue(response({error:'not found'},404));
 vi.stubGlobal('fetch',request);
 await expect(new NeuralRouter('',false).route(model,[{role:'user',content:'hello'}]))
  .rejects.toMatchObject({message:'requested_model_unavailable',status:503});
 expect(JSON.parse(request.mock.calls[0][1].body).model).toBe(model);
});

it('accepts Ollama latest-tag expansion without replacing the requested model', async()=>{
 vi.stubEnv('GSTD_INFERENCE_DEVICE','cpu');
 const request = vi.fn().mockResolvedValue(response({model:'custom:latest',message:{content:'answer'}}));
 vi.stubGlobal('fetch',request);
 await expect(new NeuralRouter('',false).route('custom',[{role:'user',content:'hello'}]))
  .resolves.toMatchObject({model:'custom:latest',content:'answer'});
 expect(JSON.parse(request.mock.calls[0][1].body).model).toBe('custom');
 expect(JSON.parse(request.mock.calls[0][1].body).options).toMatchObject({num_gpu:0});
});
