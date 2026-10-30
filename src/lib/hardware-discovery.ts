import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
export type MemoryModel='system'|'discrete'|'unified';
export interface AcceleratorDevice {name:string;vendor:'nvidia'|'amd'|'apple'|'intel';memory_bytes:number;source:'nvidia-smi'|'rocm-smi'|'sysfs'|'platform';memory_model:'discrete'|'unified'|'unknown'}
const MAX_MEMORY=2*1024**4;
// Intentionally remove terminal control characters from external device labels.
// eslint-disable-next-line no-control-regex
const label=(value:unknown)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120):'';
function memory(value:unknown,scale=1):number {const n=typeof value==='number'||typeof value==='string'?Number(value)*scale:NaN;return Number.isSafeInteger(n)&&n>0&&n<=MAX_MEMORY?n:0;}
function shared(name:string):boolean{return /\bGB10\b|Ryzen AI|Radeon.*(?:8060S|8050S|8040S|890M|880M|780M|760M|\(TM\) Graphics)/i.test(name);}
export function parseNvidiaDevices(text:string):AcceleratorDevice[]{
 if(text.length>128*1024)return [];
 return text.split('\n').slice(0,64).flatMap(line=>{const parts=line.split(','),bytes=memory(parts.pop()?.trim(),1024**2),name=label(parts.join(','));
  return name&&bytes?[{name,vendor:'nvidia' as const,memory_bytes:bytes,source:'nvidia-smi' as const,memory_model:shared(name)?'unified' as const:'discrete' as const}]:[];});
}
export function parseRocmDevices(text:string):AcceleratorDevice[]{
 if(text.length>128*1024)return [];
 try {const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))return [];
  return Object.entries(data).slice(0,64).flatMap(([key,value])=>{
   if(!/^card\d+$/.test(key)||!value||typeof value!=='object'||Array.isArray(value))return [];
   const row=value as Record<string,unknown>,bytes=memory(row['VRAM Total Memory (B)']),name=label(row['Card Series'])||label(row['Card Model'])||'AMD GPU ('+key+')';
   return bytes?[{name,vendor:'amd' as const,memory_bytes:bytes,source:'rocm-smi' as const,memory_model:shared(name)?'unified' as const:'discrete' as const}]:[];
  });
 }catch{return [];}
}
export interface HardwareProbe {
 run:(program:string,args:string[])=>string;
 read:(path:string)=>string;
 list:(path:string)=>string[];
}
const native:HardwareProbe={
 run:(program,args)=>execFileSync(program,args,{encoding:'utf8',timeout:2000,maxBuffer:128*1024,stdio:['ignore','pipe','ignore']}),
 read:path=>readFileSync(path,'utf8'),list:path=>readdirSync(path),
};
/** Device presence is a candidate, never proof of driver/runtime offload or free VRAM. */
export function discoverAccelerators(os:{platform:string;arch:string;cpu_name?:string},probe:HardwareProbe=native):AcceleratorDevice[]{
 if(os.platform==='darwin'&&os.arch==='arm64')return [{name:label(os.cpu_name)||'Apple Silicon',vendor:'apple',memory_bytes:0,source:'platform',memory_model:'unified'}];
 const devices:AcceleratorDevice[]=[];
 try{devices.push(...parseNvidiaDevices(probe.run('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits'])));}catch{}
 if(os.platform==='linux'||os.platform==='win32')try{devices.push(...parseRocmDevices(probe.run('rocm-smi',['--showproductname','--showmeminfo','vram','--json'])));}catch{}
 // A kernel device remains visible when optional vendor tools are absent. No driver is installed.
 if(os.platform==='linux')try{
  for(const card of probe.list('/sys/class/drm').filter(x=>/^card\d+$/.test(x)).slice(0,32)){
   const base='/sys/class/drm/'+card+'/device/';let vendor='';try{vendor=probe.read(base+'vendor').trim().toLowerCase();}catch{continue;}
   if(!['0x1002','0x8086'].includes(vendor))continue;
   const kind=vendor==='0x1002'?'amd' as const:'intel' as const;if(devices.some(d=>d.vendor===kind))continue;let name='',bytes=0;
   try{name=label(probe.read(base+'product_name'));}catch{}
   try{bytes=memory(probe.read(base+'mem_info_vram_total').trim());}catch{}
   // Without a vendor report we cannot distinguish dedicated memory from an APU carve-out.
   devices.push({name:name||(kind==='amd'?'AMD':'Intel')+' GPU ('+card+')',vendor:kind,memory_bytes:bytes,source:'sysfs',memory_model:shared(name)?'unified':'unknown'});
  }
 }catch{}
 return devices;
}
export function acceleratorSummary(devices:AcceleratorDevice[]){
 const discrete=devices.filter(d=>d.memory_model==='discrete').sort((a,b)=>b.memory_bytes-a.memory_bytes)[0];
 const primary=discrete||devices[0];
 return {gpu_vram:discrete?.memory_bytes||0,gpu_name:primary?.name||null,
  gpu_devices:devices,memory_model:(discrete?'discrete':devices.some(d=>d.memory_model==='unified')?'unified':'system') as MemoryModel,
  gpu_evidence:primary?.source||'none',gpu_runtime_verified:false};
}
/** /api/ps reports current model allocation, not total or free accelerator capacity. */
export function runtimeOffloadEvidence(value:unknown):{verified:boolean;processor:'gpu'|'cpu'|'unknown';max_model_gpu_bytes:number;models:Array<{model:string;gpu_bytes:number}>}{
 const raw=(value&&typeof value==='object'&&!Array.isArray(value))?(value as any).models:null;
 const models:Array<{model:string;gpu_bytes:number}>=[];
 if(Array.isArray(raw))for(const row of raw.slice(0,64)){
  const name=typeof row?.name==='string'?row.name:row?.model;
  // Intentionally reject control characters in external runtime model names.
  // eslint-disable-next-line no-control-regex
  if(typeof name!=='string'||!name||name.length>160||/[\u0000-\u001f\u007f]/.test(name)||!Number.isSafeInteger(row.size_vram)||row.size_vram<0||row.size_vram>MAX_MEMORY)continue;
  models.push({model:name,gpu_bytes:row.size_vram});
 }
 const maximum=models.reduce((n,m)=>Math.max(n,m.gpu_bytes),0);
 return {verified:models.length>0,processor:models.length?(maximum>0?'gpu':'cpu'):'unknown',max_model_gpu_bytes:maximum,models};
}
