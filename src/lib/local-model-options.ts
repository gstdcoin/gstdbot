import {isHuggingFaceAlias} from './huggingface-models.js';
/** Local model selection must not silently turn into an Ollama cloud request. */
export function isCloudModel(model:string):boolean{return !isHuggingFaceAlias(model)&&/cloud/i.test(model);}
export function localModelOptions(model:string):{think?:boolean|string}{
 if(isCloudModel(model))throw Error('cloud_models_disabled');
 if(/^gpt-oss(?::|$)/i.test(model))return {think:'low'};
 if(/^(qwen3(?:[.\-][^:]*)?|gemma4)(?::|$)/i.test(model))return {think:false};
 return {};
}
