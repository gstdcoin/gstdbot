import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/recovery-rehearsal.cjs');
it('restores identity offline without leaking secret file contents or modifying originals',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gstd-restore-fixture-'));
 try{
  const raw=JSON.stringify({nodeId:'fixture-identity',privateFixture:'do-not-print-this'});
  writeFileSync(join(dir,'config.json'),raw);
  writeFileSync(join(dir,'wallet_seed.enc'),'private-ciphertext-fixture');
  const result=spawnSync(process.execPath,[script,dir],{encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ok:true,identity_preserved:true,network_started:false,live_state_modified:false});
  expect(result.stdout+result.stderr).not.toContain('do-not-print-this');
  expect(result.stdout+result.stderr).not.toContain('private-ciphertext-fixture');
  expect(readFileSync(join(dir,'config.json'),'utf8')).toBe(raw);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('fails closed on corrupt identity state without printing parser contents',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gstd-restore-fixture-'));
 try{
  writeFileSync(join(dir,'config.json'),'{private-broken-fixture');
  const result=spawnSync(process.execPath,[script,dir],{encoding:'utf8'});
  expect(result.status).toBe(1);
  expect(result.stdout+result.stderr).not.toContain('private-broken-fixture');
  expect(readFileSync(join(dir,'config.json'),'utf8')).toBe('{private-broken-fixture');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it.skipIf(process.platform==='win32')('refuses symlinked saved secrets',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gstd-restore-fixture-'));
 try{
  writeFileSync(join(dir,'config.json'),JSON.stringify({nodeId:'fixture'}));
  writeFileSync(join(dir,'target'),'secret-fixture');
  symlinkSync(join(dir,'target'),join(dir,'wallet_seed.enc'));
  const result=spawnSync(process.execPath,[script,dir],{encoding:'utf8'});
  expect(result.status).toBe(1);
  expect(readFileSync(join(dir,'target'),'utf8')).toBe('secret-fixture');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
