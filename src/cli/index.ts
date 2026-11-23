#!/usr/bin/env node
import '../core/platform-environment.js';
/** Compute-only CLI. Host tools, skill execution and implicit cloud agents are retired. */
import { Command } from 'commander';
import { createInterface } from 'readline';

export function nodeOrigin(value=process.env.GSTD_NODE_URL || 'http://127.0.0.1:8080'):string {
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))
        throw new Error('Use an HTTP(S) node origin without credentials or a path');
    return url.origin;
}
export function chatBody(message:string,model='auto',network=false) {
    if(!message.trim()||message.length>32000)throw new Error('Message must contain 1–32000 characters');
    return {model,messages:[{role:'user',content:message}],stream:false,max_tokens:512,privacy:network?'network':'local'};
}
async function request(origin:string,path:string,body?:unknown){
    const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?120000:10000)});
    const data=await response.json() as any;
    if(!response.ok)throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}
async function answer(message:string,options:any){
    const data=await request(nodeOrigin(options.url),'/v1/chat/completions',chatBody(message,options.model,options.network));
    console.log(data.choices?.[0]?.message?.content || 'Empty response');
    console.log(`[model: ${data.model || 'unknown'}; mode: ${options.network?'network allowed':'local'}]`);
}
export function cli(){
    const program=new Command().name('gstdbot').description('GSTD local-first compute node').version(require('../../package.json').version);
    program.command('gateway').alias('serve').description('Start the compute node').action(async()=>{await import('../index.js');});
    for(const name of ['status','doctor'])program.command(name).option('--url <origin>','Node origin',nodeOrigin()).action(async opts=>{
        const origin=nodeOrigin(opts.url);console.log(JSON.stringify(await request(origin,'/health'),null,2));
        console.log(JSON.stringify(await request(origin,'/v1/models'),null,2));
    });
    program.command('send <message>').option('--url <origin>','Node origin',nodeOrigin()).option('-m, --model <model>','Installed model','auto')
        .option('--network','Explicitly allow routing to other nodes',false).action(answer);
    program.command('chat',{isDefault:true}).option('--url <origin>','Node origin',nodeOrigin()).option('-m, --model <model>','Installed model','auto')
        .option('--network','Explicitly allow routing to other nodes',false).action(async options=>{
            console.log('GSTD compute chat · /exit closes · each message is independent. No prompt history is saved.');
            const input=createInterface({input:process.stdin,output:process.stdout,prompt:'You: '});
            input.prompt();
            for await(const line of input){
                if(line.trim()==='/exit'){input.close();break;}
                if(!line.trim()){input.prompt();continue;}
                try{await answer(line,options);}catch(error:any){console.error(error.message);}
                input.prompt();
            }
        });
    return program;
}
if(require.main===module)cli().parseAsync().catch((error:Error)=>{console.error(error.message);process.exitCode=1;});
