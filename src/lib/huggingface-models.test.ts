import {it,expect,vi} from 'vitest';
import {HuggingFaceCatalog,HuggingFaceLookupError,parseHuggingFaceRepository,parseHuggingFaceInput,isHuggingFaceAlias} from './huggingface-models.js';
const repo='example/model-GGUF';
const data=(id=repo)=>({id,private:false,gated:false,siblings:[
 {rfilename:'model-Q4_K_M.gguf',size:1024**3},
 {rfilename:'model-Q8_0.gguf',size:2*1024**3},
 {rfilename:'model-00001-of-00002.gguf',size:1024},
 {rfilename:'mmproj-model.gguf',size:100},
 {rfilename:'model-unknown.gguf'},
 {rfilename:'nested/model.gguf',size:100},
 {rfilename:'config.json',size:100},
 {rfilename:'model-badsize.gguf',size:-1},
]});
const response=(body:any,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers});
it('accepts only repository IDs and exact official repository links',()=>{
 for(const input of [repo,'https://huggingface.co/'+repo,'https://hf.co/'+repo+'/'])expect(parseHuggingFaceRepository(input)).toBe(repo);
 for(const input of ['http://hf.co/'+repo,'https://evil.test/'+repo,'https://hf.co@evil.test/'+repo,
  'https://hf.co/'+repo+'?token=secret','https://hf.co/'+repo+'/tree/pinned-commit','https://hf.co/a/../b/c',
  '../repo','org/../repo','https://hf.co:443/'+repo,'org/repo#fragment','org/repo?x=1','org/%2e%2e',42,'x'.repeat(300)]){
  expect(()=>parseHuggingFaceRepository(input)).toThrow('hf_invalid_repository');
 }
 expect(isHuggingFaceAlias('hf.co/'+repo+':model-Q4_K_M.gguf')).toBe(true);
 expect(isHuggingFaceAlias('hf.co/'+repo+':../model.gguf')).toBe(false);
 expect(isHuggingFaceAlias('hf.co/'+repo+':model.gguf\n')).toBe(false);
});
it('makes one fixed bounded metadata GET, filters unsupported files and caches for six hours',async()=>{
 let now=1_000_000;const request=vi.fn(async()=>response(data()));const catalog=new HuggingFaceCatalog(request as any,()=>now);
 const first=await catalog.lookup(repo);
 expect(first.models.map(m=>m.filename)).toEqual(['model-Q4_K_M.gguf','model-Q8_0.gguf']);
 expect(first.models[0]).toMatchObject({id:'hf.co/'+repo+':model-Q4_K_M.gguf',download_bytes:1024**3,category:'huggingface'});
 expect(request).toHaveBeenCalledTimes(1);
 const [url,options]=request.mock.calls[0] as any;
 expect(url).toBe('https://huggingface.co/api/models/example/model-GGUF?blobs=true');
 expect(options).toMatchObject({redirect:'error',headers:{Accept:'application/json'}});
 expect(Object.keys(options.headers)).toEqual(['Accept']);expect(options.signal).toBeInstanceOf(AbortSignal);
 now+=5*3600_000;expect((await catalog.lookup('https://hf.co/'+repo)).cached).toBe(true);expect(request).toHaveBeenCalledTimes(1);
 expect(catalog.cachedModel(first.models[0].id)).toBeDefined();
 now+=3600_001;expect(catalog.cachedModel(first.models[0].id)).toBeUndefined();
 await catalog.lookup(repo);expect(request).toHaveBeenCalledTimes(2);
});
it('deduplicates concurrent same-repo requests and blocks uncached fan-out',async()=>{
 let complete!:(response:Response)=>void;
 const request=vi.fn(()=>new Promise<Response>(resolve=>complete=resolve));const catalog=new HuggingFaceCatalog(request as any,()=>1000);
 const first=catalog.lookup(repo),second=catalog.lookup(repo);
 await expect(catalog.lookup('other/model')).rejects.toMatchObject({code:'hf_lookup_cooldown'});
 complete(response(data()));expect((await first).repository).toBe(repo);await second;
 expect(request).toHaveBeenCalledTimes(1);
});
it('respects global cooldown and Retry-After without disabling cached repositories',async()=>{
 let now=1_000_000;const request=vi.fn(async()=>response(data()));const catalog=new HuggingFaceCatalog(request as any,()=>now);
 await catalog.lookup(repo);await expect(catalog.lookup('other/model')).rejects.toMatchObject({code:'hf_lookup_cooldown',retryAfterSeconds:30});
 now+=30001;request.mockImplementationOnce(async()=>response({},429,{'Retry-After':'120'}));
 await expect(catalog.lookup('other/model')).rejects.toMatchObject({code:'hf_rate_limited',retryAfterSeconds:120});
 expect((await catalog.lookup(repo)).cached).toBe(true);
 now+=119000;await expect(catalog.lookup('third/model')).rejects.toMatchObject({code:'hf_lookup_cooldown'});
 expect(request).toHaveBeenCalledTimes(2);
});
it('accepts HTTP-date Retry-After and bounds malformed rate-limit responses',async()=>{
 const now=Date.parse('2030-01-01T00:00:00Z');
 for(const [header,seconds] of [[new Date(now+90000).toUTCString(),90],['bad-header',30],['-1',30]] as const){
  const catalog=new HuggingFaceCatalog((async()=>response({},429,{'Retry-After':header})) as any,()=>now);
  await expect(catalog.lookup(repo)).rejects.toMatchObject({code:'hf_rate_limited',retryAfterSeconds:seconds});
 }
});
it('rejects private/gated and mismatched repository metadata',async()=>{
 for(const body of [{...data(),private:true},{...data(),gated:'manual'},{...data(),gated:true},{...data(),private:undefined},{...data(),id:'other/repo'}]){
  const catalog=new HuggingFaceCatalog((async()=>response(body)) as any);
  await expect(catalog.lookup(repo)).rejects.toBeInstanceOf(HuggingFaceLookupError);
  expect(catalog.cachedModel('hf.co/'+repo+':model-Q4_K_M.gguf')).toBeUndefined();
 }
});
it('enforces streamed and declared response limits without downloading any weights',async()=>{
 for(const r of [new Response('x'.repeat(2*1024*1024+1)),new Response('{}',{headers:{'content-length':String(2*1024*1024+1)}})]){
  const request=vi.fn(async()=>r);const catalog=new HuggingFaceCatalog(request as any);
  await expect(catalog.lookup(repo)).rejects.toMatchObject({code:'hf_response_too_large'});expect(request).toHaveBeenCalledTimes(1);
 }
});
it('caps repository cache size and evicts least recently used metadata',async()=>{
 let now=1_000_000;const request=vi.fn(async(url:string)=>{const id=url.split('/api/models/')[1].split('?')[0];return response(data(id));});
 const catalog=new HuggingFaceCatalog(request as any,()=>now);
 for(let i=0;i<16;i++){await catalog.lookup('owner/repo'+i);now+=30001;}
 await catalog.lookup('owner/repo0');await catalog.lookup('owner/repo16');
 expect(catalog.cachedModel('hf.co/owner/repo0:model-Q4_K_M.gguf')).toBeDefined();
 expect(catalog.cachedModel('hf.co/owner/repo1:model-Q4_K_M.gguf')).toBeUndefined();
});
it('maps upstream failures to bounded safe errors and never follows redirects',async()=>{
 for(const [status,code] of [[401,'hf_access_restricted'],[403,'hf_access_restricted'],[404,'hf_repository_not_found'],[500,'hf_repository_unavailable'],[302,'hf_repository_unavailable']] as const){
  const catalog=new HuggingFaceCatalog((async()=>response({},status)) as any);
  await expect(catalog.lookup(repo)).rejects.toMatchObject({code});
 }
 const catalog=new HuggingFaceCatalog((async()=>{throw Error('secret bearer value');}) as any);
 await expect(catalog.lookup(repo)).rejects.toThrow('hf_repository_unavailable');
});

it('requires reviewed exact files for every HF prefix while preserving ordinary custom Ollama names',async()=>{
 const catalog=new HuggingFaceCatalog((async()=>response(data())) as any);
 await catalog.lookup(repo);
 expect(catalog.reviewPull('hf.co/'+repo+':model-Q4_K_M.gguf').model?.download_bytes).toBe(1024**3);
 for(const alias of ['hf.co/'+repo,'hf.co/'+repo+':Q4_K_M','huggingface.co/'+repo+':model-Q4_K_M.gguf','hf.co/'+repo+':missing.gguf'])
  expect(catalog.reviewPull(alias)).toEqual({applies:true,model:undefined});
 expect(catalog.reviewPull('local-custom:7b')).toEqual({applies:false});
 expect(catalog.reviewPull('my-org/custom-model:tag')).toEqual({applies:false});
});

it('accepts default-branch model/file links without silently dropping an explicit file or revision',()=>{
 expect(parseHuggingFaceInput('https://huggingface.co/'+repo+'/tree/main')).toEqual({repository:repo});
 for(const path of ['/blob/main/model-Q4_K_M.gguf','/resolve/main/model-Q4_K_M.gguf?download=true'])
  expect(parseHuggingFaceInput('https://huggingface.co/'+repo+path)).toEqual({repository:repo,preferred_filename:'model-Q4_K_M.gguf'});
 for(const path of ['/blob/revision/model.gguf','/resolve/main/nested/model.gguf','/blob/main/model.gguf?token=secret',
   '/resolve/main/model.gguf?download=true&token=secret','/blob/main/model.gguf#fragment','/blob/main/../model.gguf'])
  expect(()=>parseHuggingFaceInput('https://hf.co/'+repo+path)).toThrow('hf_invalid_repository');
});
it('keeps preferred-file choices per request while sharing only repository metadata',async()=>{
 const request=vi.fn(async()=>response(data()));const catalog=new HuggingFaceCatalog(request as any);
 expect((await catalog.lookup('https://hf.co/'+repo+'/blob/main/model-Q8_0.gguf')).preferred_filename).toBe('model-Q8_0.gguf');
 expect((await catalog.lookup(repo)).preferred_filename).toBeUndefined();
 expect((await catalog.lookup('https://hf.co/'+repo+'/resolve/main/model-Q4_K_M.gguf')).preferred_filename).toBe('model-Q4_K_M.gguf');
 await expect(catalog.lookup('https://hf.co/'+repo+'/blob/main/mmproj-model.gguf')).rejects.toThrow('hf_file_unavailable');
 await expect(catalog.lookup('https://hf.co/'+repo+'/blob/main/missing.gguf')).rejects.toThrow('hf_file_unavailable');
 expect(request).toHaveBeenCalledTimes(1);
});
it('exposes bounded declared metadata and rejects auxiliary files without branding download counts as quality',async()=>{
 const input={...data(),cardData:{license:'apache-2.0'},downloads:123,lastModified:'2026-10-30T01:02:03Z'};
 input.siblings.push({rfilename:'vision-projector.gguf',size:1024},{rfilename:'imatrix.gguf',size:1024});
 const catalog=new HuggingFaceCatalog((async()=>response(input)) as any);
 const result=await catalog.lookup(repo);
 expect(result).toMatchObject({license:'apache-2.0',license_url:'https://huggingface.co/'+repo,repository_url:'https://huggingface.co/'+repo,downloads:123,last_modified:'2026-10-30T01:02:03.000Z'});
 expect(result.models.map(m=>m.quantization)).toEqual(['Q4_K_M','Q8_0']);
 expect(result.models).toHaveLength(2);
 const invalid=new HuggingFaceCatalog((async()=>response({...data(),cardData:{license:'<script>'},downloads:-1,lastModified:'not a time'})) as any);
 const bad=await invalid.lookup(repo);expect(bad.license).toBeUndefined();expect(bad.downloads).toBeUndefined();expect(bad.last_modified).toBeUndefined();
});
it('negative-caches restricted/not-found repositories without spending another API call',async()=>{
 let now=1_000_000;const request=vi.fn(async()=>response({},404));const catalog=new HuggingFaceCatalog(request as any,()=>now);
 await expect(catalog.lookup(repo)).rejects.toThrow('hf_repository_not_found');
 now+=31000;await expect(catalog.lookup(repo)).rejects.toMatchObject({code:'hf_repository_not_found',retryAfterSeconds:269});
 expect(request).toHaveBeenCalledTimes(1);
 now+=270000;request.mockImplementationOnce(async()=>response(data()));
 expect((await catalog.lookup(repo)).repository).toBe(repo);expect(request).toHaveBeenCalledTimes(2);
});
