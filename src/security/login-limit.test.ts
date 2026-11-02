import {it,expect} from 'vitest';
import {LoginAttemptLimiter} from './login-limit.js';
it('accumulates failures before lockout and releases only after the lockout expires',()=>{
 let now=1000;const gate=new LoginAttemptLimiter(()=>now);
 for(let i=0;i<5;i++){expect(gate.check('client').remaining).toBe(5-i);gate.record('client',false);now+=1;}
 expect(gate.check('client').allowed).toBe(false);
 now+=899_998;expect(gate.check('client').allowed).toBe(false);
 now+=2;expect(gate.check('client')).toEqual({allowed:true,remaining:5});
});
it('resets after a successful login or an expired unblocked failure window',()=>{
 let now=1;const gate=new LoginAttemptLimiter(()=>now);
 gate.record('client',false);expect(gate.check('client').remaining).toBe(4);
 gate.record('client',true);expect(gate.check('client').remaining).toBe(5);
 gate.record('client',false);now+=900_000;
 expect(gate.check('client').remaining).toBe(5);
});
it('isolates clients and bounds failure tracking without discarding active lockouts',()=>{
 let now=1;const gate=new LoginAttemptLimiter(()=>now);
 for(let i=0;i<4096;i++)gate.record('client'+i,false);
 expect(gate.check('new-client').allowed).toBe(false);
 expect(gate.check('client0')).toEqual({allowed:true,remaining:4});
 now+=900_000;expect(gate.check('new-client')).toEqual({allowed:true,remaining:5});
});
