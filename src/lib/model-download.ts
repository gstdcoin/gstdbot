/** One operator-managed pull per node process; no background or remote jobs. */
export class ModelDownloadGate {
 private active=false;
 acquire():()=>void {
  if(this.active)throw Error('model_download_in_progress');
  this.active=true;let released=false;
  return ()=>{if(!released){released=true;this.active=false;}};
 }
}
export const modelDownloadGate=new ModelDownloadGate();
export function downloadDisconnect(response:{writableEnded:boolean;on(event:'close',fn:()=>void):unknown;off(event:'close',fn:()=>void):unknown}):{signal:AbortSignal;dispose:()=>void}{
 const controller=new AbortController();
 const closed=()=>{if(!response.writableEnded)controller.abort();};
 response.on('close',closed);
 return {signal:controller.signal,dispose:()=>{response.off('close',closed);}};
}

export interface DownloadProgress {status:string;total?:number;completed?:number;digest?:string}
const MAX_LINE=32*1024;
function failure(text:string):Error {
 return Error(/newer version of ollama/i.test(text)?'model_runtime_update_required':'model_download_failed');
}
async function errorText(response:Response):Promise<string>{
 if(!response.body)return '';
 const reader=response.body.getReader();let text='';const decoder=new TextDecoder();
 try{while(text.length<MAX_LINE){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});}return text.slice(0,MAX_LINE);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Parse Ollama NDJSON, including a final line without a newline. Never forward raw errors. */
export async function streamModelDownload(model:string,ollamaUrl:string,signal:AbortSignal,
 progress:(value:DownloadProgress)=>void,request:typeof fetch=fetch):Promise<void>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await request(ollamaUrl+'/api/pull',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:model,stream:true}),
   signal:AbortSignal.any([signal,AbortSignal.timeout(30*60*1000)]),
  });
  if(!response.ok)throw failure(await errorText(response));
  if(!response.body)throw Error('model_download_failed');
  reader=response.body.getReader();const decoder=new TextDecoder();let pending='';
  const line=(text:string):boolean=>{
   if(!text.trim())return false;
   if(text.length>MAX_LINE)throw Error('model_download_failed');
   let data:any;try{data=JSON.parse(text);}catch{throw Error('model_download_failed');}
   if(!data||typeof data!=='object'||Array.isArray(data))throw Error('model_download_failed');
   if(data.error)throw failure(typeof data.error==='string'?data.error:'');
   if(typeof data.status!=='string')throw Error('model_download_failed');
   const safe:DownloadProgress={status:data.status.slice(0,200)};
   for(const name of ['total','completed'] as const)if(Number.isSafeInteger(data[name])&&data[name]>=0)safe[name]=data[name];
   if(typeof data.digest==='string'&&/^sha256:[a-f0-9]{64}$/i.test(data.digest))safe.digest=data.digest;
   progress(safe);return data.status==='success';
  };
  while(true){
   const part=await reader.read();
   pending+=part.done?decoder.decode():decoder.decode(part.value,{stream:true});
   const lines=pending.split('\n');pending=lines.pop()||'';
   for(const item of lines)if(line(item))return;
   if(pending.length>MAX_LINE)throw Error('model_download_failed');
   if(part.done){if(pending.trim()&&line(pending))return;throw Error('model_download_incomplete');}
  }
 }catch(error:any){
  if(signal.aborted)throw Error('model_download_cancelled');
  const code=error?.message;
  throw Error(['model_runtime_update_required','model_download_incomplete','model_download_failed'].includes(code)?code:'model_download_failed');
 }finally{
  if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
}
