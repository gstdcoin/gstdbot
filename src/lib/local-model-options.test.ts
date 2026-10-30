import {it,expect} from 'vitest';
import {localModelOptions,isCloudModel} from './local-model-options.js';
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
