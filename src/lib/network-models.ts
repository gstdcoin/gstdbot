export type NetworkModel = {model_id:string;nodes_count:number;price_gstd:number;pricing?:'quote_required'|'legacy_fixed_gstd'|'free'};
let cached:{models:NetworkModel[];checked_at:string}|null=null;
let expires=0;
let pending:Promise<{models:NetworkModel[];checked_at:string}|null>|null=null;
/** One registry call per minute at most; concurrent operator views share it. */
export async function networkModels(platformUrl:string){
 if(Date.now()<expires)return cached;
 if(pending)return pending;
 pending=(async()=>{
  try{
   const r=await fetch(platformUrl.replace(/\/$/,'')+'/api/v1/models/available',{signal:AbortSignal.timeout(6000)});
   if(!r.ok)throw Error('registry_unavailable');
   const d:any=await r.json();if(!Array.isArray(d.models))throw Error('registry_invalid');
   const models:NetworkModel[]=d.models.filter((m:any)=>typeof m.model_id==='string'&&/^[a-z0-9:._/-]{1,160}$/i.test(m.model_id)&&Number.isSafeInteger(m.nodes_count)&&m.nodes_count>0&&Number.isFinite(m.price_gstd)&&m.price_gstd>=0).map((m:any)=>({model_id:m.model_id,nodes_count:m.nodes_count,price_gstd:m.price_gstd,...(['quote_required','legacy_fixed_gstd','free'].includes(m.pricing)?{pricing:m.pricing}:{})}));
   cached={models,checked_at:new Date().toISOString()};
  }catch{cached=null;}
  expires=Date.now()+60000;return cached;
 })();
 try{return await pending;}finally{pending=null;}
}
