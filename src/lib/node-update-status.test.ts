import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./platform-auth.js', async load => ({ ...await load<any>(), verifyUpdateManifest: vi.fn(() => true) }));
import { verifyUpdateManifest } from './platform-auth.js';
import { approvedUpdateManifest, signedNodeUpdateStatus } from './node-update-status.js';
const current = 'a'.repeat(40), newer = 'b'.repeat(40);
const manifest = (commit = current) => ({ commit, branch: 'main', version: '3.7.2', timestamp: Date.now(), sig: 'ab'.repeat(64) });
const request = (value = manifest()) => vi.fn(async () => Response.json({ manifest: value, public_key: 'untrusted-ignored' })) as any;
const git = (dirty = '', ahead = false) => vi.fn((args: string[]) => {
    if (args[0] === 'rev-parse') return current;
    if (args[0] === 'status') return dirty;
    if (args[0] === 'merge-base' && !ahead) throw Object.assign(Error('not ancestor'), { status: 1 });
    return '';
});
afterEach(() => { vi.mocked(verifyUpdateManifest).mockReturnValue(true); vi.unstubAllEnvs(); });
describe('approved release discovery', () => {
    it('does not advertise unrelated newer main commits when already on the signed release', async () => {
        const run = git(); const status = await signedNodeUpdateStatus('node', 'main', '3.7.2', run, request());
        expect(status.update_available).toBe(false); expect(status.can_apply).toBe(false);
        expect(run.mock.calls.some(([args]) => args[0] === 'fetch')).toBe(false);
    });
    it('offers a newer approved commit only and refuses dirty or source-ahead installations', async () => {
        expect((await signedNodeUpdateStatus('node', 'main', '3.7.1', git(), request(manifest(newer)))).can_apply).toBe(true);
        expect((await signedNodeUpdateStatus('node', 'main', '3.7.1', git(' M source.ts'), request(manifest(newer)))).can_apply).toBe(false);
        expect((await signedNodeUpdateStatus('node', 'main', '3.7.3', git('', true), request(manifest(newer)))).update_available).toBe(false);
    });
    it('does not trust the response public key, an invalid signature, stale timestamp or another branch', async () => {
        vi.mocked(verifyUpdateManifest).mockReturnValue(false);
        await expect(approvedUpdateManifest('main', request())).rejects.toThrow('invalid_signed_release');
        vi.mocked(verifyUpdateManifest).mockReturnValue(true);
        await expect(approvedUpdateManifest('main', request({ ...manifest(), timestamp: Date.now() - 61000 }))).rejects.toThrow('invalid_signed_release');
        await expect(approvedUpdateManifest('develop', request())).rejects.toThrow('invalid_signed_release');
        const transport = vi.fn(async () => new Response(null, { status: 503 }));
        await expect(approvedUpdateManifest('main', transport)).rejects.toThrow('release_signing_unavailable');
    });
});
