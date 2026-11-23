import { execFileSync } from 'child_process';

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

function isCommitHash(value: string): boolean {
    return /^[a-f0-9]{40,64}$/i.test(value);
}

export function fastForwardNodeUpdate(
    installDir: string,
    branch: string,
    run: GitRunner = runGit,
    expectedCommit?: string,
): NodeUpdateResult {
    if (expectedCommit !== undefined && !isCommitHash(expectedCommit)) throw new Error('Invalid signed update commit');
    const dirtyFiles = run(['status', '--porcelain', '--untracked-files=no'], installDir).trim();
    if (dirtyFiles) {
        throw new Error('Tracked local changes detected; refusing to overwrite node files');
    }

    run(['check-ref-format', '--branch', branch], installDir);
    const previousHash = run(['rev-parse', 'HEAD'], installDir).trim();
    if (!isCommitHash(previousHash)) throw new Error('Unable to determine current Git commit');

    if (expectedCommit?.toLowerCase() === previousHash.toLowerCase()) {
        return { previousHash, updatedHash: previousHash, output: '' };
    }

    const targetRef = expectedCommit || branch;
    run(['fetch', '--no-tags', 'origin', targetRef], installDir);
    if (run(['rev-parse', '--is-shallow-repository'], installDir).trim() === 'true') {
        run(['fetch', '--unshallow', '--no-tags', 'origin', targetRef], installDir);
    }

    const targetHash = run(['rev-parse', 'FETCH_HEAD'], installDir).trim();
    if (!isCommitHash(targetHash)) throw new Error('Unable to determine fetched Git commit');
    if (expectedCommit !== undefined && (!isCommitHash(expectedCommit)
        || targetHash.toLowerCase() !== expectedCommit.toLowerCase())) {
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
