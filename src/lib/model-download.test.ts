import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {ModelDownloadGate,streamModelDownload,downloadDisconnect} from './model-download.js';
const encode=new TextEncoder();
const response=(parts:string[],status=200)=>new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encode.encode(part));controller.close();}}),{status});
const requester=(r:Response)=>vi.fn().mockResolvedValue(r) as any;
describe('operator model downloads',()=>{
 it('rejects concurrent pulls and releases only its own lease once',()=>{
  const gate=new ModelDownloadGate(),first=gate.acquire();
  expect(()=>gate.acquire()).toThrow('model_download_in_progress');first();
  const second=gate.acquire();first();expect(()=>gate.acquire()).toThrow('model_download_in_progress');second();
  expect(typeof gate.acquire()).toBe('function');
 });
 it('keeps the exact HF file and parses chunk boundaries plus terminal JSON without newline',async()=>{
  const request=requester(response(['{"status":"pulling","total":100,"comp','leted":50,"private":"never expose"}\n{"status":"success"}']));
  const progress:any[]=[];const model='hf.co/author/Model-GGUF:exact-Q4_K_M.gguf';
  await streamModelDownload(model,'http://127.0.0.1:11434',new AbortController().signal,x=>progress.push(x),request);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({name:model,stream:true});
  expect(progress).toEqual([{status:'pulling',total:100,completed:50},{status:'success'}]);
 });
 it('never turns premature EOF into a successful install',async()=>{
  await expect(streamModelDownload('model','http://local',new AbortController().signal,()=>{},requester(response(['{"status":"pulling"}\n'])))).rejects.toThrow('model_download_incomplete');
 });
 it('rejects malformed and oversized progress rather than hiding stream errors',async()=>{
  for(const part of ['not json\n','{"status":"'+ 'x'.repeat(33000)])
   await expect(streamModelDownload('model','http://local',new AbortController().signal,()=>{},requester(response([part])))).rejects.toThrow('model_download_failed');
 });
 it('maps runtime errors safely without returning arbitrary upstream contents',async()=>{
  await expect(streamModelDownload('model','http://local',new AbortController().signal,()=>{},requester(response(['{"error":"model requires a newer version of Ollama"}'])))).rejects.toThrow('model_runtime_update_required');
  await expect(streamModelDownload('model','http://local',new AbortController().signal,()=>{},requester(response(['secret upstream details'],500)))).rejects.toMatchObject({message:'model_download_failed'});
 });
 it('cancels upstream on active response disconnect, but not on normal completion',async()=>{
  const res=Object.assign(new EventEmitter(),{writableEnded:false});
  const cancellation=downloadDisconnect(res);
  const request=vi.fn(async(_url:string,init:any)=>new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason))));
  const running=streamModelDownload('model','http://local',cancellation.signal,()=>{},request as any);
  res.emit('close');await expect(running).rejects.toThrow('model_download_cancelled');
  cancellation.dispose();expect(res.listenerCount('close')).toBe(0);
  const ended=Object.assign(new EventEmitter(),{writableEnded:true}),finished=downloadDisconnect(ended);
  ended.emit('close');expect(finished.signal.aborted).toBe(false);finished.dispose();
 });
});
