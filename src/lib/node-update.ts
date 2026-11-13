import { execFileSync } from 'child_process';
import { isApprovedUpdate, type UpdateManifest } from './platform-auth.js';

export interface NodeUpdateResult {
    previousHash: string;
    updatedHash: string;
    output: string;
}

export type GitRunner = (args: string[], cwd: string) => string;

const runGit: GitRunner = (args, cwd) => execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 60000,
});

function isCommitHash(value: unknown): value is string {
    return typeof value === 'string'
        && (value.length === 40 || value.length === 64)
        && !/[^a-f0-9]/i.test(value);
}

export async function updateApprovedNode(installDir: string, branch: string, manifest?: UpdateManifest): Promise<NodeUpdateResult> {
    if (!manifest) {
        const response = await fetch('https://app.gstdtoken.com/api/v1/nodes/update/manifest', {
            redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) throw Error('Signed node release unavailable');
        manifest = (await response.json() as { manifest?: UpdateManifest }).manifest;
    }
    if (!isApprovedUpdate(manifest, branch)) throw Error('Invalid or stale signed node release');
    return fastForwardNodeUpdate(installDir, branch, manifest.commit);
}

export function fastForwardNodeUpdate(
    installDir: string,
    branch: string,
    expectedCommit: string,
    run: GitRunner = runGit,
): NodeUpdateResult {
    if (!isCommitHash(expectedCommit)) throw new Error('Invalid signed update commit');

    const dirtyFiles = run(['status', '--porcelain', '--untracked-files=no'], installDir).trim();
    if (dirtyFiles) {
        throw new Error('Tracked local changes detected; refusing to overwrite node files');
    }

    run(['check-ref-format', '--branch', branch], installDir);
    const previousHash = run(['rev-parse', 'HEAD'], installDir).trim();
    if (!isCommitHash(previousHash)) throw new Error('Unable to determine current Git commit');
    if (expectedCommit.length !== previousHash.length) {
        throw new Error('Signed update commit uses a different Git object format');
    }

    const shallow = run(['rev-parse', '--is-shallow-repository'], installDir).trim() === 'true';
    const fetchOptions = shallow ? ['--unshallow', '--no-tags'] : ['--no-tags'];
    run(['fetch', ...fetchOptions, '--', 'origin', expectedCommit], installDir);

    const targetHash = run(['rev-parse', 'FETCH_HEAD'], installDir).trim();
    if (!isCommitHash(targetHash)) throw new Error('Unable to determine fetched Git commit');
    if (targetHash.toLowerCase() !== expectedCommit.toLowerCase()) {
        throw new Error('Fetched commit does not match the signed update manifest; update refused');
    }

    if (previousHash !== targetHash) {
        try {
            run(['merge-base', '--is-ancestor', previousHash, targetHash], installDir);
        } catch (error: any) {
            if (error?.status === 1) {
                throw new Error(`Local HEAD diverges from origin/${branch}; update refused`);
            }
            throw error;
        }
    }

    const output = previousHash === targetHash
        ? ''
        : run(['merge', '--ff-only', targetHash], installDir);

    return { previousHash, updatedHash: targetHash, output };
}

export function rollbackNodeUpdate(installDir: string, commit: string, run: GitRunner = runGit): void {
    if (!isCommitHash(commit)) throw new Error('Invalid rollback commit');
    run(['reset', '--merge', commit], installDir);
}
