import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { afterEach, expect, it } from 'vitest';
const paths:string[]=[];
afterEach(()=>{for(const path of paths.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'gstd-install-env-'));paths.push(root);
 const envFile=join(root,'.env'),tokenFile=join(root,'setup-token');
 writeFileSync(envFile,'NODE_NAME=\nGSTD_WALLET_ADDRESS=\nGSTD_DASHBOARD_SETUP_TOKEN=\nUNRELATED=value\n');
 return{root,envFile,tokenFile};
}
function run(f:ReturnType<typeof fixture>,extra:Record<string,string>={}){
 execFileSync(process.execPath,['scripts/configure-install-env.cjs'],{env:{...process.env,
  GSTD_SETUP_ENV:f.envFile,GSTD_SETUP_TOKEN_FILE:f.tokenFile,...extra},stdio:'pipe'});
}
it('writes portable values without sed replacement or shell expansion and preserves setup identity',()=>{
 const f=fixture(),name='Mac | R&D #1 $GPU\\device "room"';
 run(f,{GSTD_SETUP_NODE_NAME:name,GSTD_SETUP_WALLET_ADDRESS:'0:'+'11'.repeat(32)});
 const env=parseEnv(readFileSync(f.envFile,'utf8')),token=readFileSync(f.tokenFile,'utf8').trim();
 expect(env.NODE_NAME).toBe(name);expect(env.GSTD_WALLET_ADDRESS).toBe('0:'+'11'.repeat(32));
 expect(env.UNRELATED).toBe('value');expect(token).toMatch(/^[a-f0-9]{64}$/);expect(env.GSTD_DASHBOARD_SETUP_TOKEN).toBe(token);
 run(f,{GSTD_SETUP_NODE_NAME:"owner's Mac"});
 expect(parseEnv(readFileSync(f.envFile,'utf8')).NODE_NAME).toBe("owner's Mac");
 expect(readFileSync(f.tokenFile,'utf8').trim()).toBe(token);
 expect(statSync(f.envFile).mode&0o777).toBe(0o600);expect(statSync(f.tokenFile).mode&0o777).toBe(0o600);
});
it('rejects line injection before modifying env or creating an initial credential',()=>{
 const f=fixture(),before=readFileSync(f.envFile,'utf8');
 expect(()=>run(f,{GSTD_SETUP_NODE_NAME:'node\nMALICIOUS=value'})).toThrow();
 expect(readFileSync(f.envFile,'utf8')).toBe(before);expect(existsSync(f.tokenFile)).toBe(false);
});
it('preserves an invalid existing credential for explicit recovery instead of replacing it',()=>{
 const f=fixture();writeFileSync(f.tokenFile,'corrupted');const before=readFileSync(f.envFile,'utf8');
 expect(()=>run(f,{GSTD_SETUP_NODE_NAME:'new-name'})).toThrow();
 expect(readFileSync(f.tokenFile,'utf8')).toBe('corrupted');expect(readFileSync(f.envFile,'utf8')).toBe(before);
});
it('executes the real installer env step when sed -i is unavailable (BSD/macOS case)',()=>{
 const f=fixture(),installDir=join(f.root,'node'),configDir=join(f.root,'config'),bin=join(f.root,'bin');
 mkdirSync(join(installDir,'scripts'),{recursive:true});mkdirSync(configDir);mkdirSync(bin);
 copyFileSync('scripts/configure-install-env.cjs',join(installDir,'scripts/configure-install-env.cjs'));
 copyFileSync(f.envFile,join(installDir,'.env.example'));
 writeFileSync(join(bin,'sed'),'#!/bin/sh\nexit 91\n',{mode:0o755});
 const installer=readFileSync('install.sh','utf8'),start=installer.indexOf('# Copy .env if missing'),end=installer.indexOf('# STEP 6:',start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 execFileSync('bash',['-c','set -euo pipefail\ninfo(){ :; }\nwarn(){ :; }\n'+installer.slice(start,end)],{
  env:{...process.env,PATH:bin+':'+process.env.PATH,INSTALL_DIR:installDir,CONFIG_DIR:configDir,
   NODE_NAME:'Apple Silicon | R&D',GSTD_WALLET_ADDRESS:'0:'+'22'.repeat(32)},stdio:'pipe'});
 const result=parseEnv(readFileSync(join(installDir,'.env'),'utf8'));
 expect(result.NODE_NAME).toBe('Apple Silicon | R&D');expect(result.GSTD_WALLET_ADDRESS).toBe('0:'+'22'.repeat(32));
 expect(result.GSTD_DASHBOARD_SETUP_TOKEN).toBe(readFileSync(join(configDir,'setup-token'),'utf8').trim());
});
