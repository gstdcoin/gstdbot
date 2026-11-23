import { execFileSync } from 'node:child_process';
import { isStaleCommand, verifyUpdateManifest, type UpdateManifest } from './platform-auth.js';
import type { GitRunner } from './node-update.js';

const git: GitRunner = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000 });

export async function approvedUpdateManifest(branch: string, request: typeof fetch = fetch): Promise<UpdateManifest> {
    const base = (process.env.GSTD_API_URL || 'https://app.gstdtoken.xyz/api/v1').replace(/\/+$/, '');
    const response = await request(base + '/nodes/update/manifest', {
        redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error('release_signing_unavailable');
    const { manifest } = await response.json() as { manifest?: UpdateManifest };
    if (!manifest || !/^[a-f0-9]{40,64}$/i.test(manifest.commit) ||
        !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.version) ||
        !Number.isSafeInteger(manifest.timestamp) || isStaleCommand(manifest.timestamp) ||
        manifest.branch !== branch || !verifyUpdateManifest(manifest)) throw new Error('invalid_signed_release');
    return manifest;
}

export async function signedNodeUpdateStatus(installDir: string, branch: string, currentVersion: string,
    run: GitRunner = git, request: typeof fetch = fetch) {
    const current = run(['rev-parse', 'HEAD'], installDir).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(current)) throw new Error('invalid_current_commit');
    const manifest = await approvedUpdateManifest(branch, request);
    const different = current.toLowerCase() !== manifest.commit.toLowerCase();
    let blocked: string | null = null;
    if (different && run(['status', '--porcelain', '--untracked-files=no'], installDir).trim()) blocked = 'tracked_local_changes';
    if (different && !blocked) {
        try {
            run(['merge-base', '--is-ancestor', manifest.commit, current], installDir);
            blocked = 'source_ahead_of_approved_release';
        } catch { /* A missing/new target is checked after the exact signed fetch during installation. */ }
    }
    return {
        update_available: different && blocked !== 'source_ahead_of_approved_release',
        can_apply: different && !blocked, blocked_reason: blocked,
        current_version: currentVersion, latest_version: manifest.version,
        current_hash: current.slice(0, 8), remote_hash: manifest.commit.slice(0, 8),
        approved_commit: manifest.commit, branch, release_channel: 'approved_signed', changelog: [],
    };
}
