import {type CatalogModel} from './model-catalog.js';
const TTL=6*3600_000,COOLDOWN=30_000,MAX_BYTES=2*1024*1024,MAX_REPOSITORIES=16,NEGATIVE_TTL=5*60_000;
const PART='[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,94}[A-Za-z0-9])?';
const REPOSITORY=new RegExp('^('+PART+')/('+PART+')$');
const ALIAS=new RegExp('^hf\\.co/('+PART+')/('+PART+'):([A-Za-z0-9][A-Za-z0-9_.-]*\\.gguf)$','i');
export interface HuggingFaceModel extends CatalogModel {filename:string;repository:string;quantization?:string}
export interface HuggingFaceRepository {repository:string;models:HuggingFaceModel[];checked_at:string;cached:boolean;estimate_only:true;
 repository_url:string;license?:string;license_url?:string;downloads?:number;last_modified?:string;preferred_filename?:string}
export interface HuggingFaceInput {repository:string;preferred_filename?:string}
export class HuggingFaceLookupError extends Error {
 constructor(public code:string,public retryAfterSeconds?:number){super(code);}
}
export function parseHuggingFaceInput(input:unknown):HuggingFaceInput {
 if(typeof input!=='string'||input.length>512)throw new HuggingFaceLookupError('hf_invalid_repository');
 const value=input.trim();let repository=value,preferred_filename:string|undefined;
 if(value.startsWith('https://')){
  // Check the raw authority/path before URL normalisation can hide ports or dot segments.
  const match=/^https:\/\/(?:huggingface\.co|hf\.co)\/([^?#]+)(\?download=true)?$/.exec(value);
  if(!match||match[1].includes('%'))throw new HuggingFaceLookupError('hf_invalid_repository');
  const segments=match[1].replace(/\/$/,'').split('/');
  repository=segments.slice(0,2).join('/');
  if(segments.length===2){if(match[2])throw new HuggingFaceLookupError('hf_invalid_repository');}
  else if(segments.length===4&&segments[2]==='tree'&&segments[3]==='main'&&!match[2]){ /* default branch only */ }
  else if(segments.length===5&&['blob','resolve'].includes(segments[2])&&segments[3]==='main'){
   preferred_filename=segments[4];
   if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.gguf$/i.test(preferred_filename)||preferred_filename.includes('..')
     ||(match[2]&&segments[2]!=='resolve'))throw new HuggingFaceLookupError('hf_invalid_repository');
  }else throw new HuggingFaceLookupError('hf_invalid_repository');
 }
 if(!REPOSITORY.test(repository)||repository.split('/').some(part=>part.includes('..')))
  throw new HuggingFaceLookupError('hf_invalid_repository');
 return {repository,...(preferred_filename?{preferred_filename}:{})};
}
export function parseHuggingFaceRepository(input:unknown):string {return parseHuggingFaceInput(input).repository;}
function withPreferred(value:HuggingFaceRepository,input:HuggingFaceInput):HuggingFaceRepository{
 if(input.preferred_filename&&!value.models.some(model=>model.filename===input.preferred_filename))
  throw new HuggingFaceLookupError('hf_file_unavailable');
 return {...value,...(input.preferred_filename?{preferred_filename:input.preferred_filename}:{})};
}
export function isHuggingFaceAlias(value:string):boolean{return value.length<=160&&value===value.trim()&&ALIAS.test(value);}
async function readBoundedJson(response:Response):Promise<any>{
 const advertised=Number(response.headers.get('content-length'));
 if(advertised>MAX_BYTES){await response.body?.cancel();throw new HuggingFaceLookupError('hf_response_too_large');}
 if(!response.body)throw new HuggingFaceLookupError('hf_repository_unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{
  while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;
   if(bytes>MAX_BYTES){await reader.cancel();throw new HuggingFaceLookupError('hf_response_too_large');}chunks.push(next.value);}
  const text=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){text.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(text));
 }finally{reader.releaseLock();}
}
/** Opt-in single-repository metadata only. Never searches, downloads weights or reads credentials. */
export class HuggingFaceCatalog {
 private cache=new Map<string,{expires:number;value:HuggingFaceRepository}>();
 private pending:{key:string;promise:Promise<HuggingFaceRepository>}|null=null;
 private failures=new Map<string,{expires:number;code:string}>();
 private nextRequestAt=0;
 constructor(private request:typeof fetch=fetch,private now:()=>number=Date.now){}
 cachedModel(alias:string):HuggingFaceModel|undefined{
  if(!isHuggingFaceAlias(alias))return;
  for(const entry of this.cache.values())if(entry.expires>this.now()){
   const model=entry.value.models.find(m=>m.id===alias);if(model)return model;
  }
 }
 reviewPull(alias:string):{applies:boolean;model?:HuggingFaceModel}{
  const applies=/^(?:hf\.co|huggingface\.co)\//i.test(alias);
  return applies?{applies:true,model:this.cachedModel(alias)}:{applies:false};
 }
 async lookup(input:unknown):Promise<HuggingFaceRepository>{
  const parsed=parseHuggingFaceInput(input),repository=parsed.repository,key=repository.toLowerCase(),cached=this.cache.get(key);
  if(cached&&cached.expires>this.now()){
   this.cache.delete(key);this.cache.set(key,cached);return withPreferred({...cached.value,cached:true},parsed);
  }
  const failed=this.failures.get(key);
  if(failed&&failed.expires>this.now())throw new HuggingFaceLookupError(failed.code,Math.max(1,Math.ceil((failed.expires-this.now())/1000)));
  if(failed)this.failures.delete(key);
  if(this.pending?.key===key)return withPreferred(await this.pending.promise,parsed);
  if(this.pending||this.now()<this.nextRequestAt)
   throw new HuggingFaceLookupError('hf_lookup_cooldown',Math.max(1,Math.ceil((this.nextRequestAt-this.now())/1000)));
  this.nextRequestAt=this.now()+COOLDOWN;
  const promise=this.load(repository,key);this.pending={key,promise};
  try{return withPreferred(await promise,parsed);}finally{this.pending=null;}
 }
 private async load(repository:string,key:string):Promise<HuggingFaceRepository>{
  try{
   const url='https://huggingface.co/api/models/'+repository.split('/').map(encodeURIComponent).join('/')+'?blobs=true';
   const response=await this.request(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{Accept:'application/json'}});
   if(!response.ok)await response.body?.cancel();
   if(response.status===429){
    const retry=response.headers.get('retry-after')||'',seconds=Number(retry);
    const requested=retry.trim()!==''&&Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-this.now();
    const delay=Number.isFinite(requested)?Math.min(24*3600_000,Math.max(COOLDOWN,requested)):COOLDOWN;
    this.nextRequestAt=this.now()+delay;throw new HuggingFaceLookupError('hf_rate_limited',Math.ceil(delay/1000));
   }
   if(response.status===401||response.status===403)throw new HuggingFaceLookupError('hf_access_restricted');
   if(response.status===404)throw new HuggingFaceLookupError('hf_repository_not_found');
   if(!response.ok)throw new HuggingFaceLookupError('hf_repository_unavailable');
   const data=await readBoundedJson(response);
   if(data?.private!==false||data?.gated!==false)throw new HuggingFaceLookupError('hf_access_restricted');
   if(typeof data.id!=='string'||data.id!==data.id.trim()||!REPOSITORY.test(data.id)||data.id.includes('..'))throw new HuggingFaceLookupError('hf_repository_unavailable');
   const canonical=data.id;
   if(canonical.toLowerCase()!==key||!Array.isArray(data.siblings))throw new HuggingFaceLookupError('hf_repository_unavailable');
   const checked_at=new Date(this.now()).toISOString(),models:HuggingFaceModel[]=[];
   for(const file of data.siblings){
    const filename=file?.rfilename,bytes=file?.size;
    if(typeof filename!=='string'||!Number.isSafeInteger(bytes)||bytes<1||bytes>2*1024**4
     ||!/^\w[A-Za-z0-9_.-]*\.gguf$/i.test(filename)||/mmproj|projector/i.test(filename)
     ||/^(?:imatrix|importance[-_]?matrix)(?:[-_.]|$)/i.test(filename)||/-\d+-of-\d+\.gguf$/i.test(filename))continue;
    const id='hf.co/'+canonical+':'+filename;if(!isHuggingFaceAlias(id))continue;
    const quantization=filename.match(/(?:^|[-_.])((?:IQ[1-4]|Q[2-8])(?:_[A-Z0-9]+){1,2}|BF16|F16|F32)(?=[-_.]|$)/i)?.[1]?.toUpperCase();
    models.push({id,filename,repository:canonical,...(quantization?{quantization}:{}),title:filename,category:'huggingface',legacy:false,download_bytes:bytes,
     verified_at:checked_at,source:'https://huggingface.co/'+canonical});
   }
   models.sort((a,b)=>a.download_bytes-b.download_bytes||a.id.localeCompare(b.id));
   const repository_url='https://huggingface.co/'+canonical;
   const license=typeof data.cardData?.license==='string'&&/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/.test(data.cardData.license)?data.cardData.license:undefined;
   const downloads=Number.isSafeInteger(data.downloads)&&data.downloads>=0?data.downloads:undefined;
   const modified=typeof data.lastModified==='string'&&data.lastModified.length<=40?Date.parse(data.lastModified):NaN;
   const value:HuggingFaceRepository={repository:canonical,repository_url,models:models.slice(0,100),checked_at,cached:false,estimate_only:true,
    ...(license?{license,license_url:repository_url}:{}),...(downloads!==undefined?{downloads}:{}),
    ...(Number.isFinite(modified)?{last_modified:new Date(modified).toISOString()}: {})};
   this.failures.delete(key);
   this.cache.delete(key);this.cache.set(key,{expires:this.now()+TTL,value});
   while(this.cache.size>MAX_REPOSITORIES)this.cache.delete(this.cache.keys().next().value!);
   return value;
  }catch(error){
   const safe=error instanceof HuggingFaceLookupError?error:new HuggingFaceLookupError('hf_repository_unavailable');
   const delay=safe.code==='hf_rate_limited'?Math.max(COOLDOWN,this.nextRequestAt-this.now()):
    ['hf_repository_not_found','hf_access_restricted','hf_response_too_large'].includes(safe.code)?NEGATIVE_TTL:COOLDOWN;
   this.failures.delete(key);this.failures.set(key,{expires:this.now()+delay,code:safe.code});
   while(this.failures.size>MAX_REPOSITORIES)this.failures.delete(this.failures.keys().next().value!);
   throw safe;
  }
 }
}
export const huggingFaceCatalog=new HuggingFaceCatalog();
