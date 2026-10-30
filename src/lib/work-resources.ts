import type {CatalogHardware} from './model-catalog.js';
export interface WorkResources {cpu_cores:number;ram_free_mb:number;storage_free_gb:number;gpu_vram_mb:number}
const zero=():WorkResources=>({cpu_cores:0,ram_free_mb:0,storage_free_gb:0,gpu_vram_mb:0});
/** A short-lived planning budget, not a reservation or a benchmark. GPU allocations are not free VRAM. */
export function workResources(h:CatalogHardware|null,measuredAt:number,now=Date.now()):WorkResources {
 if(!h?.local_runtime||!Number.isFinite(measuredAt)||now<measuredAt||now-measuredAt>90_000)return zero();
 const reserve=Math.max(0.75*1024**3,Math.min(2*1024**3,h.total_ram*0.15));
 return sanitizeWorkResources({cpu_cores:h.cpu_cores,ram_free_mb:Math.floor(Math.max(0,h.available_ram-reserve)/1024**2),
  storage_free_gb:h.disk_free===null?0:Math.floor(Math.max(0,h.disk_free-2*1024**3)/1024**3),gpu_vram_mb:0});
}
export function sanitizeWorkResources(value:unknown):WorkResources {
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const bound=(key:string,max:number)=>typeof raw[key]==='number'&&Number.isFinite(raw[key])&&Number(raw[key])>=0?Math.min(max,Math.floor(Number(raw[key]))):0;
 return {cpu_cores:bound('cpu_cores',4096),ram_free_mb:bound('ram_free_mb',16777216),storage_free_gb:bound('storage_free_gb',16777216),gpu_vram_mb:bound('gpu_vram_mb',2097152)};
}
