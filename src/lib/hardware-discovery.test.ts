import {describe,it,expect,vi} from 'vitest';
import {parseNvidiaDevices,parseRocmDevices,discoverAccelerators,acceleratorSummary,runtimeOffloadEvidence,type HardwareProbe} from './hardware-discovery.js';
import {compatibility,type CatalogHardware} from './model-catalog.js';
const GiB=1024**3;
const empty=():HardwareProbe=>({run:()=>{throw Error('optional tool absent');},read:()=>{throw Error('no kernel file');},list:()=>[]});
const model={id:'test:large',title:'Test',category:'general',legacy:false,download_bytes:7*GiB,verified_at:'2026-10-30',source:'https://example.test'};
const base:CatalogHardware={total_ram:8*GiB,available_ram:7*GiB,disk_free:100*GiB,cpu_cores:8,gpu_vram:0,gpu_name:null,local_runtime:true,platform:'linux',arch:'x64'};
describe('reported accelerator hardware, separate from runtime use',()=>{
 it('uses the largest NVIDIA device instead of summing multi-GPU memory',()=>{
  const devices=parseNvidiaDevices('NVIDIA RTX 3060, 12288\nNVIDIA RTX 3090, 24576\ninvalid, NaN\n');
  expect(devices).toHaveLength(2);
  expect(acceleratorSummary(devices)).toMatchObject({gpu_name:'NVIDIA RTX 3090',gpu_vram:24*GiB,gpu_evidence:'nvidia-smi',gpu_runtime_verified:false,memory_model:'discrete'});
  expect(compatibility(model,{...base,...acceleratorSummary(devices)}).status).toBe('fits');
 });
 it('parses AMD VRAM byte counters without treating the driver report as active offload',()=>{
  const devices=parseRocmDevices(JSON.stringify({card0:{'Card Series':'Radeon RX 7900 XTX','VRAM Total Memory (B)':String(24*GiB)},card1:{'Card Series':'Radeon RX 7800 XT','VRAM Total Memory (B)':String(16*GiB)}}));
  expect(acceleratorSummary(devices)).toMatchObject({gpu_name:'Radeon RX 7900 XTX',gpu_vram:24*GiB,gpu_runtime_verified:false});
  expect(parseRocmDevices('{broken')).toEqual([]);
  expect(parseRocmDevices(JSON.stringify({card0:{'VRAM Total Memory (B)':'-1'}}))).toEqual([]);
 });
 it('recognizes Apple unified RAM without inventing an extra GPU memory pool or running tools',()=>{
  const probe=empty();probe.run=vi.fn();
  const summary=acceleratorSummary(discoverAccelerators({platform:'darwin',arch:'arm64',cpu_name:'Apple M4'},probe));
  expect(summary).toMatchObject({gpu_name:'Apple M4',gpu_vram:0,memory_model:'unified',gpu_evidence:'platform',gpu_runtime_verified:false});
  expect(probe.run).not.toHaveBeenCalled();
  expect(compatibility(model,{...base,...summary})).toMatchObject({status:'insufficient',reason:'memory'});
 });
 it('does not double count GB10 or reported Ryzen AI shared memory as extra VRAM',()=>{
  for(const devices of [parseNvidiaDevices('NVIDIA GB10, 131072'),parseRocmDevices(JSON.stringify({card0:{'Card Series':'AMD Ryzen AI Max+ 395','VRAM Total Memory (B)':String(128*GiB)}}))]){
   expect(acceleratorSummary(devices)).toMatchObject({gpu_vram:0,memory_model:'unified'});
  }
  expect(compatibility(model,{...base,gpu_vram:128*GiB,memory_model:'unified'})).toMatchObject({status:'insufficient',reason:'memory'});
 });
 it('preserves a dedicated GPU on systems that also expose an integrated shared device',()=>{
  const summary=acceleratorSummary([...parseNvidiaDevices('NVIDIA RTX 3090, 24576'),...parseRocmDevices(JSON.stringify({card0:{'Card Series':'AMD Ryzen AI Max+ 395','VRAM Total Memory (B)':String(128*GiB)}}))]);
  expect(summary).toMatchObject({gpu_vram:24*GiB,memory_model:'discrete'});
 });
 it('falls back to read-only kernel presence when vendor tools are absent, with unknown memory kind',()=>{
  const probe=empty();probe.list=()=>['card0','card0-DP-1','card1','../../bad'];
  probe.read=path=>path.endsWith('vendor')?(path.includes('card0')?'0x1002':'0x8086'):path.endsWith('mem_info_vram_total')?String(8*GiB):'';
  const devices=discoverAccelerators({platform:'linux',arch:'x64'},probe);
  expect(devices.map(d=>d.vendor)).toEqual(['amd','intel']);
  expect(acceleratorSummary(devices)).toMatchObject({gpu_vram:0,gpu_evidence:'sysfs',gpu_runtime_verified:false});
 });
 it('leaves CPU-only machines honest and remote runtimes unknown',()=>{
  expect(acceleratorSummary(discoverAccelerators({platform:'linux',arch:'arm64'},empty()))).toMatchObject({gpu_vram:0,gpu_name:null,gpu_evidence:'none'});
  expect(compatibility(model,{...base,gpu_vram:24*GiB,local_runtime:false})).toMatchObject({status:'unknown',reason:'remote_runtime'});
 });
 it('executes only fixed read-only tool arguments',()=>{
  const probe=empty();probe.run=vi.fn(()=>{throw Error('not installed');});
  discoverAccelerators({platform:'linux',arch:'arm64'},probe);
  expect(probe.run).toHaveBeenNthCalledWith(1,'nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits']);
  expect(probe.run).toHaveBeenNthCalledWith(2,'rocm-smi',['--showproductname','--showmeminfo','vram','--json']);
 });
});
describe('Ollama runtime allocation evidence',()=>{
 it('does not turn an empty runtime or malformed allocation into GPU verification',()=>{
  for(const raw of [null,{}, {models:[]},{models:[{name:'test',size_vram:-1}]},{models:[{name:'test',size_vram:'123'}]}])
   expect(runtimeOffloadEvidence(raw)).toMatchObject({verified:false,processor:'unknown',max_model_gpu_bytes:0});
 });
 it('separates CPU execution from measured offload and does not sum model allocations',()=>{
  expect(runtimeOffloadEvidence({models:[{name:'cpu:small',size_vram:0}]})).toMatchObject({verified:true,processor:'cpu',max_model_gpu_bytes:0});
  expect(runtimeOffloadEvidence({models:[{name:'gpu:a',size_vram:4*GiB},{model:'gpu:b',size_vram:6*GiB}]})).toMatchObject({verified:true,processor:'gpu',max_model_gpu_bytes:6*GiB});
 });
});
