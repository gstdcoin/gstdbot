import {it,expect,vi,afterEach} from 'vitest';
import {localModelOptions,isCloudModel,localRuntimeOptions} from './local-model-options.js';
afterEach(()=>vi.unstubAllEnvs());
it('forces CPU execution while preserving automatic runtime selection',()=>{
 vi.stubEnv('GSTD_INFERENCE_DEVICE','cpu');
 vi.stubEnv('GSTD_OLLAMA_CONTEXT','');
 expect(localRuntimeOptions()).toEqual({num_ctx:1024,num_gpu:0});
 vi.stubEnv('GSTD_INFERENCE_DEVICE','auto');
 expect(localRuntimeOptions()).toEqual({num_ctx:2048});
 vi.stubEnv('GSTD_INFERENCE_DEVICE','unsupported');
 expect(()=>localRuntimeOptions()).toThrow('invalid_inference_device');
});
it('uses supported thinking controls without exposing reasoning as a final answer',()=>{
 expect(localModelOptions('qwen3.5:0.8b')).toEqual({think:false});
 expect(localModelOptions('gemma4:e2b')).toEqual({think:false});
 expect(localModelOptions('gpt-oss:20b')).toEqual({think:'low'});
 expect(localModelOptions('llama3.2:3b')).toEqual({});
});
it('rejects cloud model tags before inference or installation',()=>{
 for(const name of ['gemma4:cloud','gpt-oss:20b-cloud']){expect(isCloudModel(name)).toBe(true);expect(()=>localModelOptions(name)).toThrow('cloud_models_disabled');}
});

it('treats an exact HF GGUF alias as local weights even when its owner name contains cloud',()=>{expect(isCloudModel('hf.co/cloud-owner/model-GGUF:model-Q4_K_M.gguf')).toBe(false);expect(localModelOptions('hf.co/cloud-owner/model-GGUF:model-Q4_K_M.gguf')).toEqual({});});
