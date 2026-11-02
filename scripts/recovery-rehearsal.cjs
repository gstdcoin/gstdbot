#!/usr/bin/env node
'use strict';
// Offline copy/restore rehearsal. Never launches the copied identity or changes live state.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const source=path.resolve(process.argv[2]||path.join(os.homedir(),'.config','gstdbot'));
const prefix=path.join(os.tmpdir(),'gstd-recovery-');
let temp;
try {
 const sourceState=fs.lstatSync(source);if(!sourceState.isDirectory()||sourceState.isSymbolicLink())throw Error('invalid_source');
 temp=fs.mkdtempSync(prefix);fs.chmodSync(temp,0o700);
 const backup=path.join(temp,'backup'),restored=path.join(temp,'restored');
 fs.mkdirSync(backup,{mode:0o700});fs.mkdirSync(restored,{mode:0o700});
 const names=['config.json','p2p-identity.json','attestor-identity.json','dashboard_pin.hash','wallet.json','wallet_seed.enc'];
 const manifest=[];
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 for(const name of names){
  const file=path.join(source,name);
  if(!fs.existsSync(file)){if(name==='config.json')throw Error('missing_config');continue;}
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('unsafe_state_file');
  const copied=path.join(backup,name),target=path.join(restored,name);
  fs.copyFileSync(file,copied,fs.constants.COPYFILE_EXCL);fs.chmodSync(copied,0o600);
  fs.copyFileSync(copied,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);
  if(hash(file)!==hash(copied)||hash(copied)!==hash(target))throw Error('restore_integrity_failed');
  manifest.push(name);
 }
 const original=JSON.parse(fs.readFileSync(path.join(source,'config.json'),'utf8'));
 const recovered=JSON.parse(fs.readFileSync(path.join(restored,'config.json'),'utf8'));
 if(typeof original.nodeId!=='string'||!original.nodeId||original.nodeId!==recovered.nodeId)throw Error('identity_mismatch');
 for(const name of ['p2p-identity.json','attestor-identity.json','wallet.json']){
  if(manifest.includes(name))JSON.parse(fs.readFileSync(path.join(restored,name),'utf8'));
 }
 console.log(JSON.stringify({ok:true,mode:'offline_copy_restore',verified_files:manifest,identity_preserved:true,live_state_modified:false,network_started:false,
 limitations:['Not an encrypted off-machine backup','Does not restore Cloudflare/KV state','No production outage or physical host replacement simulated']}));
} catch {
 console.error('Recovery rehearsal failed. Live configuration was not changed; inspect file permissions and saved configuration locally.');
 process.exitCode=1;
} finally {
 if(temp&&path.resolve(temp).startsWith(path.resolve(prefix))&&path.dirname(temp)===os.tmpdir())fs.rmSync(temp,{recursive:true,force:true});
}
