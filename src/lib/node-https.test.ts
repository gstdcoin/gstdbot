import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sockets = vi.hoisted(()=>({next:null as any,path:''}));
vi.mock('node:fs',async()=>{const actual=await vi.importActual<typeof import('node:fs')>('node:fs');return {...actual,existsSync:(path:any)=>['/run/systemd/system','/usr/bin/apt-get'].includes(path)?true:['/.dockerenv','/run/.containerenv'].includes(path)?false:actual.existsSync(path)};});
vi.mock('node:os',()=>({platform:()=> 'linux',userInfo:()=>({uid:1001,username:'node-worker'})}));
vi.mock('node:net',()=>({createConnection:(path:string)=>{sockets.path=path;return sockets.next;}}));
import { validateHttpsRequest, sanitizeHttpsStatus, httpsBootstrapCommand, httpsHelperRequest } from './node-https.js';

const valid={domain:'NODE.example.org',email:'operator+node@example.org',agreeTerms:true,exposePublic:true};
it('accepts only a domain profile and two explicit permissions',()=>{
 expect(validateHttpsRequest(valid)).toEqual({...valid,domain:'node.example.org'});
 for (const input of [
  {...valid,domain:'https://example.org/path'}, {...valid,domain:'127.0.0.1'}, {...valid,domain:'node.local'},
  {...valid,domain:'x.internal'}, {...valid,domain:'*.example.org'}, {...valid,domain:'a.example.org\nimport /root'},
  {...valid,email:'x@example.org\nroot'}, {...valid,agreeTerms:'true'}, {...valid,exposePublic:false},
  {...valid,command:'rm -rf /'}, {...valid,port:22}, {...valid,domain:'example.org:443'},
 ]) expect(()=>validateHttpsRequest(input)).toThrow();
});
it('never returns helper logs keys email credentials or external reachability claims',()=>{
 expect(sanitizeHttpsStatus({state:'verified',verified:true,externalVerified:true,domain:'node.example.org',
   upstreamPort:8081,email:'private@example.org',privateKey:'secret',logs:'sensitive',bootstrapCommand:'malicious'}))
 .toEqual({helperInstalled:true,state:'verified',verified:true,externalVerified:false,renewal:'caddy',domain:'node.example.org',upstreamPort:8081});
 expect(sanitizeHttpsStatus({state:'failed',verified:true,error:'private key contents'}).verified).toBe(false);
 expect(sanitizeHttpsStatus({state:'failed',error:'private key contents'}).error).toBeUndefined();
});
it('shows a safely quoted local command and rejects runtime-invalid upstream ports',()=>{
 expect(httpsBootstrapCommand("/srv/node's files",8081)).toBe("sudo bash '/srv/node'\\''s files/scripts/setup-node-https.sh' --user 'node-worker' --port 8081");
 for (const port of [0,80,443,2019,65536,NaN,8081.5,'8081; id' as any]) expect(httpsBootstrapCommand('/srv/node',port)).toBeNull();
});
class Socket extends EventEmitter {
 body='';setTimeout(){}destroy(){}
 write(value:string){this.body=value;this.emit('data',Buffer.from('{"state":"not_configured","upstreamPort":8081}\n'));}
}
it('uses only the fixed protected Unix socket and bounded JSON messages',async()=>{
 const socket=new Socket();sockets.next=socket;
 const result=httpsHelperRequest({action:'status'});socket.emit('connect');
 expect((await result).state).toBe('not_configured');
 expect(sockets.path).toBe('/run/gstd-node-https/control.sock');
 expect(JSON.parse(socket.body)).toEqual({action:'status'});
});
it('executes isolated Python helper security/rollback tests and validates bootstrap syntax',()=>{
 execFileSync('python3',['-m','unittest','discover','-s','scripts/tests','-p','test_node_https_helper.py'],{timeout:15000,stdio:'pipe'});
 execFileSync('bash',['-n','scripts/setup-node-https.sh'],{timeout:5000});
 const setup=readFileSync('scripts/setup-node-https.sh','utf8');
 expect(setup).toContain('apt-get download');
 expect(setup).toContain('sha256sum -c');
 expect(setup).not.toContain('apt-get install -y caddy');
 expect(setup).toContain('SocketMode=0600');
 expect(setup).toContain('NoNewPrivileges=true');
 expect(setup).not.toMatch(/sudoers|NOPASSWD|systemctl stop (nginx|caddy)/);
});
