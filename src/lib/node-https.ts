import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { platform, userInfo } from 'node:os';

const SOCKET = '/run/gstd-node-https/control.sock';
const PRIVATE_SUFFIX = /\.(?:local|localhost|internal|lan|home|corp|intranet|localdomain)$/;
export interface HttpsRequest { domain: string; email: string; agreeTerms: true; exposePublic: true }
export interface HttpsStatus {
    helperInstalled: boolean; state: string; verified: boolean; externalVerified: false;
    domain?: string; expires?: string; verifiedAt?: string; error?: string;
    renewal?: string; retryAfterEpoch?: number; attemptDomain?: string; upstreamPort?: number; lastAttemptError?: string;
}
export function validateHttpsRequest(value: unknown): HttpsRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_request');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !['domain','email','agreeTerms','exposePublic'].includes(key))) throw Error('invalid_request');
    if (input.agreeTerms !== true || input.exposePublic !== true) throw Error('consent_required');
    const domain = input.domain;
    if (typeof domain !== 'string' || domain.length > 253 || domain !== domain.trim()
        || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)
        || PRIVATE_SUFFIX.test(domain.toLowerCase())) throw Error('invalid_domain');
    const email = input.email;
    if (typeof email !== 'string' || email.length > 254 || !/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email)) throw Error('invalid_email');
    return { domain: domain.toLowerCase(), email, agreeTerms:true, exposePublic:true };
}
const ERROR_CODES = new Set(['invalid_request','invalid_domain','invalid_email','consent_required','https_busy',
    'https_cooldown','domain_change_requires_manual','https_upstream_mismatch','access_denied','request_too_large','domain_not_public','existing_proxy','ports_in_use',
    'pending_setup_interrupted','invalid_upstream','https_setup_failed','certificate_validation_failed','rollback_failed','tls_not_verified']);
export function sanitizeHttpsStatus(value: any): HttpsStatus {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('https_helper_unavailable');
    const result: HttpsStatus = {
        helperInstalled:true,
        state:['not_configured','configuring','verified','verification_required','failed'].includes(value.state) ? value.state : 'failed',
        verified:value.verified === true && value.state === 'verified', externalVerified:false, renewal:'caddy',
    };
    for (const name of ['domain','attemptDomain'] as const) {
        if (typeof value[name] === 'string' && /^[a-z0-9.-]{1,253}$/.test(value[name])) result[name] = value[name];
    }
    for (const name of ['expires','verifiedAt'] as const) {
        if (typeof value[name] === 'string' && Number.isFinite(Date.parse(value[name]))) result[name] = value[name];
    }
    if (typeof value.error === 'string' && ERROR_CODES.has(value.error)) result.error = value.error;
    if (typeof value.lastAttemptError === 'string' && ERROR_CODES.has(value.lastAttemptError)) result.lastAttemptError = value.lastAttemptError;
    if (Number.isInteger(value.upstreamPort) && value.upstreamPort >= 1024 && value.upstreamPort <= 65535) result.upstreamPort = value.upstreamPort;
    if (typeof value.retryAfterEpoch === 'number' && Number.isFinite(value.retryAfterEpoch)) result.retryAfterEpoch = value.retryAfterEpoch;
    return result;
}
export function httpsHelperRequest(body: Record<string, unknown>): Promise<HttpsStatus> {
    return new Promise((accept,reject) => {
        let data = '', settled = false;
        const socket = createConnection(SOCKET);
        const finish = (error?: Error, value?: HttpsStatus) => {
            if (settled) return; settled = true; socket.destroy();
            if (error) reject(error); else accept(value!);
        };
        socket.setTimeout(8000,()=>finish(Error('https_helper_unavailable')));
        socket.on('connect',()=>socket.write(JSON.stringify(body)+'\n'));
        socket.on('error',()=>finish(Error('https_helper_unavailable')));
        socket.on('data',chunk=>{
            data += chunk.toString('utf8');
            if (data.length > 8192) { finish(Error('https_helper_unavailable')); return; }
            if (!data.includes('\n')) return;
            try {
                const raw = JSON.parse(data.split('\n')[0]);
                if (raw.error && !raw.state) { finish(Error(ERROR_CODES.has(raw.error) ? raw.error : 'https_helper_unavailable')); return; }
                finish(undefined,sanitizeHttpsStatus(raw));
            } catch { finish(Error('https_helper_unavailable')); }
        });
        socket.on('end',()=>{if (!settled) finish(Error('https_helper_unavailable'));});
    });
}
/** System capability only: panel management never exposes a shell command. */
export function httpsAutomaticSetupSupported(port: number): boolean {
    return platform() === 'linux' && userInfo().uid !== 0 && existsSync('/run/systemd/system') && existsSync('/usr/bin/apt-get') && !existsSync('/.dockerenv') && !existsSync('/run/.containerenv') && Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 2019;
}
export async function httpsStatus(port: number) {
    try {
        const status = await httpsHelperRequest({action:'status'});
        if (status.upstreamPort !== port) return {...status, verified:false, state:'upstream_mismatch', error:'https_upstream_mismatch', setupSupported:httpsAutomaticSetupSupported(port)};
        return { ...status, setupSupported:httpsAutomaticSetupSupported(port) };
    }
    catch {
        return {helperInstalled:false, state:'helper_required', verified:false, externalVerified:false,
            setupSupported:httpsAutomaticSetupSupported(port)};
    }
}
