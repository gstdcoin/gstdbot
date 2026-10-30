import {readFileSync,writeFileSync,mkdirSync,statfsSync} from 'fs';
import {homedir,cpus,totalmem,freemem,platform,arch} from 'os';
import {join} from 'path';
import {discoverAccelerators,acceleratorSummary,type AcceleratorDevice,type MemoryModel} from './hardware-discovery.js';
const GiB=1024**3;
export interface CatalogModel {id:string;title:string;category:string;legacy:boolean;download_bytes:number;verified_at:string;source:string}
export interface CatalogHardware {total_ram:number;available_ram:number;disk_free:number|null;cpu_cores:number;gpu_vram:number;gpu_name:string|null;local_runtime:boolean;platform:string;arch:string;gpu_devices?:AcceleratorDevice[];memory_model?:MemoryModel;gpu_evidence?:string;gpu_runtime_verified?:boolean}
export function catalogHardware():CatalogHardware{
 let available=freemem(),disk:number|null=null;
 if(platform()==='linux')try{const m=readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+) kB/m);if(m)available=Number(m[1])*1024;}catch{}
 try{const s=statfsSync(process.env.OLLAMA_MODELS||homedir());disk=Number(s.bavail)*Number(s.bsize);}catch{}
 const accelerators=acceleratorSummary(discoverAccelerators({platform:platform(),arch:arch(),cpu_name:cpus()[0]?.model}));
 let local=false;try{local=['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.OLLAMA_URL||'http://127.0.0.1:11434').hostname);}catch{}
 return {total_ram:totalmem(),available_ram:available,disk_free:disk,cpu_cores:cpus().length,...accelerators,local_runtime:local,platform:platform(),arch:arch()};
}
export function compatibility(model:CatalogModel,h:CatalogHardware){
 // Conservative planning estimate for bounded text context, not the advertised maximum context.
 const required=Math.ceil(model.download_bytes*1.25+0.75*GiB);
 const reserve=Math.max(0.75*GiB,Math.min(2*GiB,h.total_ram*0.15));
 const budget=Math.max(0,h.total_ram-reserve);
 const diskNeeded=Math.ceil(model.download_bytes*1.2);
 // Unified memory is already counted in system RAM; it is not an extra VRAM pool.
 const dedicatedVram=h.memory_model==='unified'?0:h.gpu_vram;
 let status:'fits'|'tight'|'insufficient'|'unknown'='fits',reason='resources_estimate';
 if(!h.local_runtime){status='unknown';reason='remote_runtime';}
 else if(h.disk_free!==null&&h.disk_free<diskNeeded){status='insufficient';reason='disk';}
 else if(required>budget && !(dedicatedVram>=required && h.total_ram>=4*GiB)){status='insufficient';reason='memory';}
 else if((dedicatedVram>=required?2*GiB:required)>h.available_ram-reserve){status='tight';reason='close_models';}
 return {status,reason,estimated_ram_bytes:required,disk_needed_bytes:diskNeeded,
  acceleration:dedicatedVram>=required?'gpu_candidate':'cpu_or_partial_gpu',
  runtime_validation:'required',context_note:'Estimate for short text context; larger contexts need more memory.'};
}
const fallback=()=>JSON.parse(readFileSync(join(__dirname,'../../data/model-catalog.json'),'utf8')) as CatalogModel[];
let cache:CatalogModel[]|null=null,refreshing:Promise<CatalogModel[]>|null=null,lastRefresh=0;
const cacheFile=()=>join(process.env.GSTD_CONFIG_DIR||join(homedir(),'.config/gstdbot'),'model-catalog-cache.json');
export function modelCatalog():CatalogModel[]{
 if(!cache){try{cache=JSON.parse(readFileSync(cacheFile(),'utf8'));}catch{cache=fallback();}}
 return cache!;
}
export async function refreshModelCatalog():Promise<CatalogModel[]>{
 if(refreshing)return refreshing;
 if(Date.now()-lastRefresh<6*3600_000)return modelCatalog();
 refreshing=(async()=>{
  const list=[...modelCatalog()],results:CatalogModel[]=[];
  // Fixed official origin + reviewed local-only IDs. Never fetch a caller-provided URL.
  for(let offset=0;offset<list.length;offset+=3)results.push(...await Promise.all(list.slice(offset,offset+3).map(async model=>{
   try{
    const [family,tag]=model.id.split(':');
    const r=await fetch('https://registry.ollama.ai/v2/library/'+encodeURIComponent(family)+'/manifests/'+encodeURIComponent(tag),{signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('registry_unavailable');
    const data:any=await r.json();
    const bytes=(data.layers||[]).reduce((n:number,l:any)=>n+Number(l.size||0),Number(data.config?.size||0));
    if(!Number.isSafeInteger(bytes)||bytes<1)throw Error('invalid_manifest');
    return {...model,download_bytes:bytes,verified_at:new Date().toISOString()};
   }catch{return model;}
  })));
  cache=results;lastRefresh=Date.now();
  try{mkdirSync(join(cacheFile(),'..'),{recursive:true});writeFileSync(cacheFile(),JSON.stringify(results),{mode:0o600});}catch{}
  return results;
 })();
 try{return await refreshing;}finally{refreshing=null;}
}
