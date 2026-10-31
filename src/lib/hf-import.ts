import {parseHuggingFaceInput,HuggingFaceLookupError} from './huggingface-models.js';
/** Parse an untrusted handoff without contacting the Hub or executing anything. */
export function reviewHfImport(repo:unknown,file:unknown){
 const parsed=parseHuggingFaceInput(repo);
 if(typeof repo!=='string'||repo!==parsed.repository||parsed.preferred_filename)throw new HuggingFaceLookupError('hf_invalid_repository');
 if(file!==undefined&&file!==''){
  if(typeof file!=='string'||file.length>160||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.gguf$/i.test(file)||file.includes('..')||/mmproj|imatrix|[-.]\d{5}-of-\d{5}/i.test(file))throw new HuggingFaceLookupError('hf_invalid_repository');
  parseHuggingFaceInput('https://huggingface.co/'+parsed.repository+'/blob/main/'+file);
 }
 return {repository:parsed.repository,review_input:file?'https://huggingface.co/'+parsed.repository+'/blob/main/'+file:parsed.repository};
}
