type Attempt={count:number;firstFailureAt:number;lockedUntil:number};
/** Per-gateway bounded PIN failure window; pre-lockout entries must not be reset. */
export class LoginAttemptLimiter {
 private attempts=new Map<string,Attempt>();
 constructor(private readonly clock:()=>number=Date.now){}
 private current(ip:string):Attempt|undefined{
  const entry=this.attempts.get(ip),now=this.clock();
  if(entry&&((entry.lockedUntil>0&&now>=entry.lockedUntil)||(!entry.lockedUntil&&now-entry.firstFailureAt>=900_000))){this.attempts.delete(ip);return undefined;}
  return entry;
 }
 check(ip:string):{allowed:boolean;remaining:number;lockoutMs?:number}{
  const entry=this.current(ip);
  if(entry&&entry.lockedUntil>this.clock())return{allowed:false,remaining:0,lockoutMs:entry.lockedUntil-this.clock()};
  if(!entry&&this.attempts.size>=4096){
   for(const key of this.attempts.keys())this.current(key);
   if(this.attempts.size>=4096)return{allowed:false,remaining:0,lockoutMs:900_000};
  }
  return{allowed:true,remaining:5-(entry?.count||0)};
 }
 record(ip:string,success:boolean):void{
  if(success){this.attempts.delete(ip);return;}
  const entry=this.current(ip)||{count:0,firstFailureAt:this.clock(),lockedUntil:0};
  entry.count++;
  if(entry.count>=5)entry.lockedUntil=this.clock()+900_000;
  this.attempts.set(ip,entry);
 }
}
