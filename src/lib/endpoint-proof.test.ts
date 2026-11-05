import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {keyPairFromSeed,signVerify} from '@ton/crypto';
import {endpointProof} from './endpoint-proof.js';
import {nodeSurface} from '../security/surface.js';
it('binds endpoint, identity, nonce and expiry without signing arbitrary messages',()=>{
 const keyPair=keyPairFromSeed(Buffer.alloc(32,71)),identity={keyPair,pubkeyHex:keyPair.publicKey.toString('hex')};
 const input={url:'https://node.example.com/base',nonce:'a1'.repeat(32),expires_at:String(Date.now()+60000)};
 const proof=endpointProof(identity,'node-fixture',input);
 const hash=(id:string,url:string)=>createHash('sha256').update(JSON.stringify(['gstd:endpoint:v1',id,url,input.nonce,Number(input.expires_at)])).digest();
 expect(signVerify(hash('node-fixture',input.url),Buffer.from(proof.signature,'hex'),keyPair.publicKey)).toBe(true);
 expect(signVerify(hash('attacker',input.url),Buffer.from(proof.signature,'hex'),keyPair.publicKey)).toBe(false);
 expect(signVerify(hash('node-fixture','https://other.example.com'),Buffer.from(proof.signature,'hex'),keyPair.publicKey)).toBe(false);
 expect(()=>endpointProof(identity,'node-fixture',{...input,expires_at:String(Date.now()-1)})).toThrow();
 expect(()=>endpointProof(identity,'node-fixture',{...input,url:'https://node.example.com/?credential=bad'})).toThrow();
 expect(nodeSurface('/.well-known/gstd-node')).toBe('public');
});
