import {type CatalogModel} from './model-catalog.js';
const TTL=6*3600_000,COOLDOWN=30_000,MAX_BYTES=2*1024*1024,MAX_REPOSITORIES=16;
const PART='[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,94}[A-Za-z0-9])?';
const REPOSITORY=new RegExp('^('+PART+')/('+PART+')$');
const ALIAS=new RegExp('^hf\\.co/('+PART+')/('+PART+'):([A-Za-z0-9][A-Za-z0-9_.-]*\\.gguf)$','i');
export interface HuggingFaceModel extends CatalogModel {filename:string;repository:string}
export interface HuggingFaceRepository {repository:string;models:HuggingFaceModel[];checked_at:string;cached:boolean;estimate_only:true}
export class HuggingFaceLookupError extends Error {
 constructor(public code:string,public retryAfterSeconds?:number){super(code);}
}
export function parseHuggingFaceRepository(input:unknown):string {
 if(typeof input!=='string'||input.length>256)throw new HuggingFaceLookupError('hf_invalid_repository');
 let repo=input.trim();
 if(repo.startsWith('https://')){
  if(!new RegExp('^https://(?:huggingface\\.co|hf\\.co)/'+PART+'/'+PART+'/?$').test(repo))throw new HuggingFaceLookupError('hf_invalid_repository');
  let url:URL;try{url=new URL(repo);}catch{throw new HuggingFaceLookupError('hf_invalid_repository');}
  if(!['huggingface.co','hf.co'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash)
   throw new HuggingFaceLookupError('hf_invalid_repository');
  repo=url.pathname.replace(/^\//,'').replace(/\/$/,'');
 }
 if(!REPOSITORY.test(repo)||repo.split('/').some(part=>part.includes('..')))
  throw new HuggingFaceLookupError('hf_invalid_repository');
 return repo;
}
export function isHuggingFaceAlias(value:string):boolean{return value.length<=160&&ALIAS.test(value);}
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
  const repository=parseHuggingFaceRepository(input),key=repository.toLowerCase(),cached=this.cache.get(key);
  if(cached&&cached.expires>this.now()){
   this.cache.delete(key);this.cache.set(key,cached);return {...cached.value,cached:true};
  }
  if(this.pending?.key===key)return this.pending.promise;
  if(this.pending||this.now()<this.nextRequestAt)
   throw new HuggingFaceLookupError('hf_lookup_cooldown',Math.max(1,Math.ceil((this.nextRequestAt-this.now())/1000)));
  this.nextRequestAt=this.now()+COOLDOWN;
  const promise=this.load(repository,key);this.pending={key,promise};
  try{return await promise;}finally{this.pending=null;}
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
   const canonical=parseHuggingFaceRepository(data.id);
   if(canonical.toLowerCase()!==key||!Array.isArray(data.siblings))throw new HuggingFaceLookupError('hf_repository_unavailable');
   const checked_at=new Date(this.now()).toISOString(),models:HuggingFaceModel[]=[];
   for(const file of data.siblings){
    const filename=file?.rfilename,bytes=file?.size;
    if(typeof filename!=='string'||!Number.isSafeInteger(bytes)||bytes<1||bytes>2*1024**4
     ||!/^\w[A-Za-z0-9_.-]*\.gguf$/i.test(filename)||/mmproj/i.test(filename)||/-\d+-of-\d+\.gguf$/i.test(filename))continue;
    const id='hf.co/'+canonical+':'+filename;if(!isHuggingFaceAlias(id))continue;
    models.push({id,filename,repository:canonical,title:filename,category:'huggingface',legacy:false,download_bytes:bytes,
     verified_at:checked_at,source:'https://huggingface.co/'+canonical});
   }
   models.sort((a,b)=>a.download_bytes-b.download_bytes||a.id.localeCompare(b.id));
   const value:HuggingFaceRepository={repository:canonical,models:models.slice(0,100),checked_at,cached:false,estimate_only:true};
   this.cache.delete(key);this.cache.set(key,{expires:this.now()+TTL,value});
   while(this.cache.size>MAX_REPOSITORIES)this.cache.delete(this.cache.keys().next().value!);
   return value;
  }catch(error){if(error instanceof HuggingFaceLookupError)throw error;throw new HuggingFaceLookupError('hf_repository_unavailable');}
 }
}
export const huggingFaceCatalog=new HuggingFaceCatalog();
