import {createHash} from 'node:crypto';
import {signWithIdentity,type AttestorIdentity} from '../p2p/identity.js';
export function endpointProof(identity:AttestorIdentity,nodeId:string,input:Record<string,unknown>){
 const {url,nonce,expires_at}=input;
 if(typeof url!=='string'||url.length>2048||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||typeof expires_at!=='string'||!/^\d{13}$/.test(expires_at))throw Error('invalid_endpoint_challenge');
 const endpoint=new URL(url);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.port&&endpoint.port!=='443')throw Error('invalid_endpoint_challenge');
 const expires=Number(expires_at);if(expires<Date.now()||expires>Date.now()+90000)throw Error('expired_endpoint_challenge');
 const normalized=(endpoint.origin+endpoint.pathname).replace(/\/+$/,'');
 if(normalized!==url)throw Error('invalid_endpoint_challenge');
 const message=createHash('sha256').update(JSON.stringify(['gstd:endpoint:v1',nodeId,url,nonce,expires])).digest();
 return{node_id:nodeId,url,nonce,expires_at:expires,public_key:identity.pubkeyHex,signature:signWithIdentity(identity,message).toString('hex')};
}
