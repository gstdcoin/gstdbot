import {describe,it,expect} from 'vitest';
import {workResources,sanitizeWorkResources} from './work-resources.js';
import type {CatalogHardware} from './model-catalog.js';
const GiB=1024**3;
const h:CatalogHardware={total_ram:16*GiB,available_ram:10*GiB,disk_free:20*GiB,cpu_cores:8,gpu_vram:24*GiB,gpu_name:'GPU',local_runtime:true,platform:'linux',arch:'x64'};
describe('task resource budgets',()=>{
 it('reports measured CPU/RAM/disk with OS reserves and no invented free GPU memory',()=>{
  expect(workResources(h,1000,1000)).toEqual({cpu_cores:8,ram_free_mb:8192,storage_free_gb:18,gpu_vram_mb:0});
 });
 it('fails closed for remote, absent, expired or future snapshots',()=>{
  for(const r of [workResources(null,1000,1000),workResources({...h,local_runtime:false},1000,1000),workResources(h,1000,91001),workResources(h,1001,1000)])
   expect(Object.values(r)).toEqual([0,0,0,0]);
 });
 it('bounds malformed measurements without serializing NaN, negative or untrusted fields',()=>{
  expect(sanitizeWorkResources({cpu_cores:Infinity,ram_free_mb:-1,storage_free_gb:'20',gpu_vram_mb:NaN,other:100})).toEqual({cpu_cores:0,ram_free_mb:0,storage_free_gb:0,gpu_vram_mb:0});
  expect(sanitizeWorkResources({cpu_cores:1e9,ram_free_mb:1024.8})).toMatchObject({cpu_cores:4096,ram_free_mb:1024});
  expect(workResources({...h,available_ram:1,disk_free:null},1000,1000)).toMatchObject({ram_free_mb:0,storage_free_gb:0});
 });
});
