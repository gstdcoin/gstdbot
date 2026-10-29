import { describe,it,expect,vi,afterEach } from 'vitest';
import { nodeSurface } from './surface.js';
import { NeuralRouter } from '../gateway/router.js';
describe('compute node boundaries',()=>{
    it.each(['/api/update/component','/api/node/bind-wallet','/api/node/unbind-wallet','/api/system/reset','/api/system/ssh/harden','/api/telegram/webhook','/api/bridge/send','/api/apps/install','/api/validator/stake','/api/training/start'])('retires the dangerous surface %s',path=>expect(nodeSurface(path)).toBe('retired'));
    it.each(['/api/node/status','/api/node/usage/recent','/api/node/events','/api/update','/unknown'])('requires an operator session for %s',path=>expect(nodeSurface(path)).toBe('operator'));
    it.each(['/v1/chat/completions','/health','/api/auth/login'])('retains core entry point %s',path=>expect(nodeSurface(path)).toBe('public'));
    it('never uploads a private prompt when local inference fails',async()=>{
        const fetcher=vi.fn().mockRejectedValue(new Error('local unavailable'));vi.stubGlobal('fetch',fetcher);
        await expect(new NeuralRouter('',false).route('auto',[{role:'user',content:'private content'}])).rejects.toThrow('requested_model_unavailable');
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(String(fetcher.mock.calls[0][0])).toContain('127.0.0.1:11434');
    });
});
afterEach(()=>vi.unstubAllGlobals());

it('keeps managed HTTPS operator-only and retires copied-key SSL routes',()=>{
 expect(nodeSurface('/api/node/https/status')).toBe('operator');
 expect(nodeSurface('/api/node/https/configure')).toBe('operator');
 expect(nodeSurface('/api/ssl/status')).toBe('retired');
 expect(nodeSurface('/api/ssl/setup')).toBe('retired');
});
