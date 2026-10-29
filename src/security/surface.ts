/** Minimal exposed surface. Everything else requires an operator session.
 * Archived finance/host-control modules cannot be re-enabled by an environment flag. */
export function nodeSurface(path: string): 'public'|'operator'|'retired' {
    const retired=['/api/update/component','/api/node/bind-wallet','/api/node/unbind-wallet','/api/fees','/api/node/rewards','/api/wallet','/api/system','/api/bridge','/api/apps','/apps','/api/telegram','/api/training','/api/validator',
        '/api/validators','/api/vaults','/api/oracle','/api/enterprise','/api/defi','/api/naas',
        '/api/system/reinstall','/api/system/reset','/api/system/update-os','/api/system/ssh',
        '/api/ssl','/api/dns/setup','/api/storage','/api/relay','/api/tasks','/api/rewards/claim'];
    if(retired.some(prefix=>path===prefix||path.startsWith(prefix+'/')))return 'retired';
    if(path==='/'||path.startsWith('/static/')||['/health','/favicon.ico','/v1/models','/v1/chat/completions',
        '/api/v1/chat','/api/auth/setup','/api/auth/login','/api/auth/check',
        '/api/v1/tasks/push','/api/v1/free-api/key','/api/v1/free-api/chat'].includes(path))return 'public';
    return 'operator';
}
