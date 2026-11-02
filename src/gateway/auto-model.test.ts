import {it,expect,vi,afterEach} from 'vitest';
import {NeuralRouter} from './router.js';
vi.mock('../lib/demand-tracker.js',()=>({demandTracker:{record:vi.fn()}}));
afterEach(()=>vi.unstubAllGlobals());
const reply=(body:any)=>new Response(JSON.stringify(body));
it('auto uses an installed local model when the historical default was removed, caching only local inventory',async()=>{
 let names=[{name:'large:7b',size:8e9},{name:'qwen2.5:0.5b',size:4e8}];
 const fetcher=vi.fn(async(url:any,options:any)=>{
  if(String(url).endsWith('/api/tags'))return reply({models:names});
  const body=JSON.parse(options.body);return reply({model:body.model,message:{content:'OK'}});
 });vi.stubGlobal('fetch',fetcher);
 const router=new NeuralRouter('',false);
 const result=await router.route('auto',[{role:'user',content:'test'}]);
 expect(result.model).toBe('qwen2.5:0.5b');
 await router.route('auto',[{role:'user',content:'different request'}]);
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/api/tags'))).toHaveLength(1);
 names=[{name:'replacement:1b',size:6e8}];router.invalidateAutoModel();
 expect((await router.route('auto',[{role:'user',content:'after deletion'}])).model).toBe('replacement:1b');
 expect(fetcher.mock.calls.every(([url])=>String(url).startsWith('http://127.0.0.1:11434/'))).toBe(true);
});
it('prefers the installed configured/default model and never selects a cloud entry',async()=>{
 const fetcher=vi.fn(async(url:any,options:any)=>String(url).endsWith('/api/tags')?
  reply({models:[{name:'large:cloud',size:1},{name:'llama3.2:3b',size:2e9},{name:'tiny:1b',size:4e8}]}):
  reply({model:JSON.parse(options.body).model,message:{content:'OK'}}));
 vi.stubGlobal('fetch',fetcher);
 expect((await new NeuralRouter('',false).route('auto',[{role:'user',content:'test'}])).model).toBe('llama3.2:3b');
});
it('fails locally if no usable model exists without sending the prompt to another service',async()=>{
 const fetcher=vi.fn(async(_url:string)=>reply({models:[]}));vi.stubGlobal('fetch',fetcher);
 await expect(new NeuralRouter('',false).route('auto',[{role:'user',content:'private'}])).rejects.toThrow('requested_model_unavailable');
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).not.toContain('gstdtoken.com');
});
