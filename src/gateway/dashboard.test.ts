import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {modelCatalog,compatibility,type CatalogHardware} from '../lib/model-catalog.js';
class Element {
 private storedValue='';select=false;
 get value(){return this.storedValue;}
 set value(value:string){this.storedValue=this.select&&!this.children.some(item=>item.value===value)?'':value;}
 textContent='';disabled=false;checked=false;dataset:Record<string,string>={};children:any[]=[];
 onchange:any;onclick:any;oninput:any;
 classes=new Set<string>();
 classList={add:(x:string)=>this.classes.add(x),remove:(x:string)=>this.classes.delete(x),toggle:(x:string,on:boolean)=>on?this.classes.add(x):this.classes.delete(x)};
 replaceChildren(...items:any[]){this.children=items;if(this.select)this.storedValue=items[0]?.value||'';}append(...items:any[]){this.children.push(...items);}add(item:any){this.children.push(item);}
 attributes:Record<string,string>={};removeAttribute(){}setAttribute(key:string,value:string){this.attributes[key]=value}
}
function storage(initial:Record<string,string>){const m=new Map(Object.entries(initial));return{getItem:(k:string)=>m.get(k)||null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>m.delete(k)}}
it('renders the actual catalog and keeps personal-wallet linking visible on an existing node',async()=>{
 const html=readFileSync('web/dashboard.html','utf8'),elements=new Map<string,Element>();
 for(const m of html.matchAll(/id="([^"]+)"/g)){const e=new Element();e.select=m[1]==='model';elements.set(m[1],e);}
 const labels=[...html.matchAll(/data-i="([^"]+)"/g)].map(m=>{const e=new Element();e.dataset.i=m[1];return e;});
 const h:CatalogHardware={total_ram:8*1024**3,available_ram:6*1024**3,disk_free:20*1024**3,cpu_cores:4,gpu_vram:0,gpu_name:null,local_runtime:true,platform:'linux',arch:'arm64'};
 const catalog={hardware:h,network:{models:[{model_id:'remote:large',nodes_count:1,price_gstd:0.1}]},models:modelCatalog().map(m=>({...m,compatibility:compatibility(m,h)}))};
 const hfModels=[1,30].map((size,index)=>{const model={id:'hf.co/example/model-GGUF:model-'+(index?'Q8_0':'Q4_K_M')+'.gguf',filename:'model-'+(index?'Q8_0':'Q4_K_M')+'.gguf',repository:'example/model-GGUF',title:'HF fixture',category:'huggingface',legacy:false,download_bytes:size*1024**3,verified_at:'2030-01-01T00:00:00Z',source:'https://huggingface.co/example/model-GGUF'};return {...model,compatibility:compatibility(model,h)};});
 let hfLookups=0;let hfPreferred:string|undefined;let hfLookupFails=false;let pullWait=false;let activePullSignal:AbortSignal|undefined;
 const address='0:'+'77'.repeat(32);
 let bound:any=null;let ollamaAvailable=true;let httpsHelper=false;let configuredHttps:any=null;let pulledModel='';const downloadedModels=new Set<string>();
 const fetcher=vi.fn(async(path:string,options:any)=>{
  if(path==='/api/node/huggingface/models'){hfLookups++;expect(JSON.parse(options.body)).toEqual({repository:'example/model-GGUF'});if(hfLookupFails)return{ok:false,status:404,json:async()=>({error:'hf_file_unavailable'})};return{ok:true,status:200,json:async()=>({repository:'example/model-GGUF',repository_url:'https://huggingface.co/example/model-GGUF',license:'apache-2.0',license_url:'https://huggingface.co/example/model-GGUF/blob/main/LICENSE',downloads:42,last_modified:'2030-01-01T00:00:00Z',preferred_filename:hfPreferred,models:hfModels,cached:true,estimate_only:true})};}
  if(path==='/api/node/https/status')return{ok:true,status:200,json:async()=>httpsHelper?{helperInstalled:true,state:'not_configured',verified:false}:{helperInstalled:false,state:'helper_required',setupSupported:true}};
  if(path==='/api/node/https/configure'){configuredHttps=JSON.parse(options.body);return{ok:true,status:202,json:async()=>({helperInstalled:true,state:'verified',verified:true,domain:'node.example.org',expires:'2030-01-01T00:00:00Z'})};}
  if(path==='/api/node/operator')return{ok:true,status:200,json:async()=>({node_id:'fixture-existing',version:'3.7.0',name:'Fixture',uptime:60,cpu:{usage:5,load_1m:.1},ram:{used:1024**3,total:h.total_ram},compute:{active:0,capacity:1},requests:0,platform:{registered:true,publicUrl:null,worker:{enabled:true,lastPoll:new Date().toISOString(),resultsSubmitted:0,busy:false}},payout_address:'0:'+'88'.repeat(32)})};
  if(path==='/api/ollama/models')return{ok:true,status:200,json:async()=>({ollama_available:ollamaAvailable,installed:ollamaAvailable?[{id:'qwen3.5:0.8b',size:100},...[...downloadedModels].map(id=>({id,size:100}))]:[],running:[]})};
  if(path==='/api/ollama/catalog'||path==='/api/ollama/catalog/refresh')return{ok:true,status:200,json:async()=>catalog};
  if(path==='/api/ollama/models/pull'){
   pulledModel=JSON.parse(options.body).model;activePullSignal=options.signal;if(pullWait)return{ok:true,status:200,body:{getReader:()=>({read:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))))})}};downloadedModels.add(pulledModel);let sent=false;
   return{ok:true,status:200,body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:Buffer.from('data: {"status":"success"}\n\n')})})}};
  }
  if(path==='/api/node/reward-wallet'){
   if(options.method==='POST'){bound=JSON.parse(options.body);return{ok:true,status:200,json:async()=>({payout:{address,revision:1}})};}
   return{ok:true,status:200,json:async()=>({payout:null})};
  }
  throw Error('Unexpected UI request '+path);
 });
 const context:any={
  document:{documentElement:{lang:''},hidden:false,title:'',getElementById:(id:string)=>elements.get(id),querySelectorAll:()=>labels,createElement:()=>new Element()},
  navigator:{language:'ru-RU'},localStorage:storage({}),sessionStorage:storage({gstd_operator_session:'fixture-only'}),
  Option:class{constructor(public text:string,public value:string){}},fetch:fetcher,
  setInterval:()=>0,location:{reload(){}},console,TextDecoder,Set,Date,AbortController,
 };
 runInNewContext(html.split('<script>')[1].split('</script>')[0],context);
 await vi.waitFor(()=>expect(elements.get('installChoice')!.children.length).toBeGreaterThan(10));
 expect(elements.get('httpsInstall')!.disabled).toBe(true);
 expect(html).not.toContain('id="httpsBootstrap"');
 expect(elements.get('httpsStatus')!.textContent).toContain('автоматически при установке');
 httpsHelper=true;await elements.get('httpsRefresh')!.onclick();
 expect(elements.get('httpsInstall')!.disabled).toBe(true);
 elements.get('httpsTerms')!.checked=true;elements.get('httpsTerms')!.onchange();
 expect(elements.get('httpsInstall')!.disabled).toBe(true);
 elements.get('httpsExposure')!.checked=true;elements.get('httpsExposure')!.onchange();
 expect(elements.get('httpsInstall')!.disabled).toBe(false);
 elements.get('httpsDomain')!.value='node.example.org';elements.get('httpsEmail')!.value='operator@example.org';
 await elements.get('httpsInstall')!.onclick();
 expect(configuredHttps).toEqual({domain:'node.example.org',email:'operator@example.org',agreeTerms:true,exposePublic:true});
 expect(elements.get('httpsInstall')!.disabled).toBe(true);
 expect(elements.get('httpsLink')!.attributes.href).toBe('https://node.example.org');
 // Refreshing online metadata must preserve an explicitly entered custom model.
 const custom=elements.get('newModel')!;
 custom.value='custom-family:7b';custom.oninput();
 await elements.get('refreshCatalog')!.onclick();
 expect(elements.get('installChoice')!.value).toBe('');
 expect(custom.value).toBe('custom-family:7b');
 expect(elements.get('modelPlan')!.textContent).toContain('неизвестна');
 await elements.get('install')!.onclick();
 expect(pulledModel).toBe('custom-family:7b');
 expect(elements.get('installChoice')!.value).toBe('');
 // Hugging Face metadata is fetched only by its button, never on page load or refresh.
 expect(hfLookups).toBe(0);
 elements.get('model')!.value='remote:large';elements.get('model')!.onchange();
 const beforePulls=fetcher.mock.calls.filter(([path])=>path==='/api/ollama/models/pull').length;
 elements.get('hfRepository')!.value='example/model-GGUF';
 await elements.get('hfCheck')!.onclick();
 expect(hfLookups).toBe(1);
 expect(fetcher.mock.calls.filter(([path])=>path==='/api/ollama/models/pull')).toHaveLength(beforePulls);
 expect(elements.get('hfFile')!.children).toHaveLength(2); // incompatible files hidden by default
 expect(elements.get('hfFile')!.value).toBe(''); // no implicit download selection
 expect(elements.get('hfRecommendation')!.textContent).toContain('Q4_K_M');
 expect(elements.get('hfRepositoryInfo')!.textContent).toContain('apache-2.0');
 expect(elements.get('hfSourceLink')!.attributes.href).toBe('https://huggingface.co/example/model-GGUF');
 elements.get('hfRecommend')!.onclick();
 expect(elements.get('newModel')!.value).toBe(hfModels[0].id);
 elements.get('hfFitOnly')!.checked=false;elements.get('hfFitOnly')!.onchange();
 expect(elements.get('hfFile')!.children).toHaveLength(3);
 elements.get('hfFile')!.value=hfModels[0].id;elements.get('hfFile')!.onchange();
 elements.get('hfFile')!.value='';elements.get('hfFile')!.onchange();
 expect(elements.get('newModel')!.value).toBe('');
 expect(elements.get('install')!.disabled).toBe(true);
 expect(elements.get('model')!.value).toBe('remote:large');
 elements.get('hfFile')!.value=hfModels[1].id;elements.get('hfFile')!.onchange();
 expect(elements.get('install')!.disabled).toBe(true);
 elements.get('hfFile')!.value=hfModels[0].id;elements.get('hfFile')!.onchange();
 expect(elements.get('install')!.disabled).toBe(false);
 expect(elements.get('modelPlan')!.textContent).toContain('Hugging Face');
 expect(elements.get('modelPlan')!.textContent).not.toContain('Современная');
 await elements.get('refreshCatalog')!.onclick();
 elements.get('language')!.value='en';elements.get('language')!.onchange();
 expect(elements.get('hfFile')!.value).toBe(hfModels[0].id);
 expect(elements.get('newModel')!.value).toBe(hfModels[0].id);
 expect(elements.get('model')!.value).toBe('remote:large');
 expect(hfLookups).toBe(1);
 elements.get('language')!.value='ru';elements.get('language')!.onchange();
 await elements.get('install')!.onclick();
 expect(pulledModel).toBe(hfModels[0].id);
 expect(elements.get('install')!.disabled).toBe(true);
 // Installing does not change the current conversation or send an inference request.
 expect(elements.get('model')!.value).toBe('remote:large');
 expect(elements.get('testInstalled')!.disabled).toBe(false);
 const beforeInference=fetcher.mock.calls.filter(([path])=>path==='/v1/chat/completions').length;
 elements.get('testInstalled')!.onclick();
 expect(elements.get('model')!.value).toBe(hfModels[0].id);
 expect(elements.get('privacy')!.value).toBe('local');
 expect(fetcher.mock.calls.filter(([path])=>path==='/v1/chat/completions')).toHaveLength(beforeInference);
 // An explicit file link may select an incompatible file, but never downloads it or replaces it.
 hfPreferred=hfModels[1].filename;
 await elements.get('hfCheck')!.onclick();
 expect(elements.get('hfFile')!.value).toBe(hfModels[1].id);
 expect(elements.get('install')!.disabled).toBe(true);
 hfLookupFails=true;await elements.get('hfCheck')!.onclick();
 expect(elements.get('hfFile')!.value).toBe('');
 expect(elements.get('newModel')!.value).toBe('');
 expect(elements.get('install')!.disabled).toBe(true);
 expect(elements.get('hfStatus')!.textContent).toContain('Другой файл не выбран');
 hfLookupFails=false;hfPreferred=undefined;
 // A periodic catalogue render must not re-enable a live download; cancellation does no delete.
 custom.value='cancel-fixture:small';custom.oninput();pullWait=true;activePullSignal=undefined;
 const waitingDownload=elements.get('install')!.onclick();
 await vi.waitFor(()=>expect(activePullSignal).toBeDefined());
 await elements.get('refreshCatalog')!.onclick();
 expect(elements.get('install')!.disabled).toBe(true);
 elements.get('cancelDownload')!.onclick();await waitingDownload;
 expect(activePullSignal!.aborted).toBe(true);
 expect(elements.get('downloadInfo')!.textContent).toContain('Скачивание остановлено');
 expect(elements.get('cancelDownload')!.disabled).toBe(true);
 expect(elements.get('install')!.disabled).toBe(false);
 expect(fetcher.mock.calls.some(([path])=>path.includes('delete'))).toBe(false);
 pullWait=false;

 const choice=elements.get('installChoice')!;
 choice.value='qwen3.5:27b';choice.onchange();expect(elements.get('install')!.disabled).toBe(true);
 choice.value='qwen3.5:2b';choice.onchange();expect(elements.get('install')!.disabled).toBe(false);
 await elements.get('install')!.onclick();
 expect(pulledModel).toBe('qwen3.5:2b');
 expect(elements.get('install')!.disabled).toBe(true);
 expect(elements.get('readinessSteps')!.children).toHaveLength(5);
 expect(elements.get('nextAction')!.textContent).toContain('кошелёк');
 expect(elements.get('walletForm')!.classes.has('hidden')).toBe(false);
 expect(elements.get('paymentsLink')!.attributes.href).toBe('https://app.gstdtoken.com/ru/payments?from=node');
 expect(elements.get('balanceLink')!.attributes.href).not.toContain(address);
 expect(elements.get('payout')!.textContent).toContain('ещё не привязан');
 elements.get('walletAddress')!.value=address;elements.get('walletConsent')!.checked=true;
 elements.get('walletConsent')!.onchange();await elements.get('bind')!.onclick();
 expect(bound).toEqual({address,revision:0});
 expect(elements.get('payout')!.textContent).toBe(address);
 expect(elements.get('nextAction')!.textContent).toContain('Технически готова к фоновой работе');
 expect(elements.get('identityWallet')!.textContent).toContain('88'.repeat(32));
 expect(labels.every(e=>e.textContent!==e.dataset.i)).toBe(true);
 elements.get('model')!.value='remote:large';elements.get('model')!.onchange();
 expect(elements.get('networkPrice')!.textContent).toContain('0.1 GSTD');
 elements.get('question')!.value='test';elements.get('privacy')!.value='local';
 await elements.get('send')!.onclick();expect(elements.get('notice')!.textContent).toContain('Разрешить другие ноды');
 elements.get('privacy')!.value='network';await elements.get('send')!.onclick();
 expect(elements.get('notice')!.textContent).toContain('резервирования GSTD');
 expect(fetcher.mock.calls.some(([path])=>path==='/v1/chat/completions')).toBe(false);
 elements.get('language')!.value='en';elements.get('language')!.onchange();
 await vi.waitFor(()=>expect(elements.get('model')!.value).toBe('remote:large'));
 expect(elements.get('platformChat')!.attributes.href).toBe('https://app.gstdtoken.com/chat?model=remote%3Alarge');
 expect(elements.get('nextAction')!.textContent).toContain('Technically ready for background work');
 expect(elements.get('networkLink')!.attributes.href).toBe('https://app.gstdtoken.com/nodes');
 // A missing local runtime must not erase a previously loaded remote choice.
 ollamaAvailable=false;await elements.get('modelsRefresh')!.onclick();
 expect(elements.get('model')!.value).toBe('remote:large');
 expect(elements.get('nextAction')!.textContent).toContain('Start Ollama');
 expect(elements.get('workerSummary')!.textContent).toContain('Results submitted: 0');
 expect(elements.get('directRoute')!.textContent).toContain('outbound funded campaign queue needs no public address');
});
