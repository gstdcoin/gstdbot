import {it,expect} from 'vitest';
import {reviewHfImport} from './hf-import.js';
it('prepares an exact filename without external access or a download',()=>{
 expect(reviewHfImport('owner/repo','model-Q4_K_M.gguf')).toEqual({repository:'owner/repo',review_input:'https://huggingface.co/owner/repo/blob/main/model-Q4_K_M.gguf'});
 expect(reviewHfImport('owner/repo',undefined).review_input).toBe('owner/repo');
});
it('rejects ambiguous URLs, traversal, shards, projector files and injected values',()=>{
 for(const [repo,file] of [['https://huggingface.co/owner/repo','m.gguf'],['../repo','m.gguf'],['owner/repo','../m.gguf'],['owner/repo','m%2f.gguf'],['owner/repo','m-00001-of-00002.gguf'],['owner/repo','mmproj.gguf'],['owner/repo',null],['owner/repo','m.gguf?token=secret']])expect(()=>reviewHfImport(repo,file)).toThrow();
});
