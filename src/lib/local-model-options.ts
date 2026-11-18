import {isHuggingFaceAlias} from './huggingface-models.js';
/** Local model selection must not silently turn into an Ollama cloud request. */
export function isCloudModel(model:string):boolean{return !isHuggingFaceAlias(model)&&/cloud/i.test(model);}
export function localInferenceDevice(): 'auto' | 'cpu' {
 const device=process.env.GSTD_INFERENCE_DEVICE||'auto';
 if(device!=='auto'&&device!=='cpu')throw Error('invalid_inference_device');
 return device;
}
export function localRuntimeOptions(): {num_ctx:number;num_gpu?:number} {
 const cpu=localInferenceDevice()==='cpu';
 const num_ctx=Math.max(512,Math.min(8192,Number(process.env.GSTD_OLLAMA_CONTEXT)||(cpu?1024:2048)));
 return cpu?{num_ctx,num_gpu:0}:{num_ctx};
}
export function localModelOptions(model:string):{think?:boolean|string}{
 if(isCloudModel(model))throw Error('cloud_models_disabled');
 if(/^gpt-oss(?::|$)/i.test(model))return {think:'low'};
 if(/^(qwen3(?:[.\-][^:]*)?|gemma4)(?::|$)/i.test(model))return {think:false};
 return {};
}
