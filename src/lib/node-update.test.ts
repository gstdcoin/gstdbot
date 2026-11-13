import { describe, expect, it, vi } from 'vitest';
import { fastForwardNodeUpdate, rollbackNodeUpdate, type GitRunner } from './node-update.js';

const currentHash = 'a'.repeat(40);
const targetHash = 'b'.repeat(40);

describe('fastForwardNodeUpdate', () => {
    it('updates a clean checkout only by fast-forward', () => {
        const run = vi.fn<GitRunner>((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') return currentHash;
            if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return 'false';
            if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return targetHash;
            return '';
        });

        expect(fastForwardNodeUpdate('node-dir', 'main', targetHash, run)).toEqual({
            previousHash: currentHash,
            updatedHash: targetHash,
            output: '',
        });
        expect(run).toHaveBeenCalledWith(['fetch', '--no-tags', '--', 'origin', targetHash], 'node-dir');
        expect(run).toHaveBeenCalledWith(['merge', '--ff-only', targetHash], 'node-dir');
        expect(run).not.toHaveBeenCalledWith(['reset', '--hard', expect.anything()], 'node-dir');
    });

    it('refuses to update when tracked local changes exist', () => {
        const run = vi.fn<GitRunner>(() => ' M src/local-change.ts');

        expect(() => fastForwardNodeUpdate('node-dir', 'main', targetHash, run))
            .toThrow('Tracked local changes detected');
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('refuses a divergent remote history', () => {
        const run = vi.fn<GitRunner>((args) => {
            if (args[0] === 'status') return '';
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') return currentHash;
            if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return 'false';
            if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return targetHash;
            if (args[0] === 'merge-base') throw Object.assign(new Error('not ancestor'), { status: 1 });
            return '';
        });

        expect(() => fastForwardNodeUpdate('node-dir', 'main', targetHash, run))
            .toThrow('Local HEAD diverges from origin/main');
        expect(run).not.toHaveBeenCalledWith(['merge', '--ff-only', targetHash], 'node-dir');
    });
});

describe('rollbackNodeUpdate', () => {
    it('uses a non-destructive merge reset to restore the snapshot', () => {
        const run = vi.fn<GitRunner>(() => '');

        rollbackNodeUpdate('node-dir', currentHash, run);

        expect(run).toHaveBeenCalledWith(['reset', '--merge', currentHash], 'node-dir');
    });

    it('rejects invalid rollback refs', () => {
        const run = vi.fn<GitRunner>(() => '');

        expect(() => rollbackNodeUpdate('node-dir', 'HEAD; rm -rf /', run))
            .toThrow('Invalid rollback commit');
        expect(run).not.toHaveBeenCalled();
    });
});


describe('signed update target', () => {
    function git(shallow = false) {
        return vi.fn<GitRunner>((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') return currentHash;
            if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return String(shallow);
            if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return targetHash;
            return '';
        });
    }
    it('rejects a different signed target before touching the working tree', () => {
        const run = git();
        expect(() => fastForwardNodeUpdate('node-dir', 'main', 'c'.repeat(40), run))
            .toThrow('does not match the signed update manifest');
        expect(run.mock.calls.some(([args]) => args[0] === 'merge' || args[0] === 'reset')).toBe(false);
    });
    it('fetches only the signed target when deepening a shallow clone', () => {
        const run = git(true);
        expect(fastForwardNodeUpdate('node-dir', 'main', targetHash, run).updatedHash).toBe(targetHash);
        expect(run.mock.calls.filter(([args]) => args[0] === 'fetch')).toEqual([
            [['fetch', '--unshallow', '--no-tags', '--', 'origin', targetHash], 'node-dir'],
        ]);
        expect(run).toHaveBeenCalledWith(['merge', '--ff-only', targetHash], 'node-dir');
    });

    it.each(['main', 'a'.repeat(41), targetHash + '\n'])('rejects a non-object ID before invoking Git (%j)', (commit) => {
        const run = git();
        expect(() => fastForwardNodeUpdate('node-dir', 'main', commit, run)).toThrow('Invalid signed update commit');
        expect(run).not.toHaveBeenCalled();
    });

    it('rejects an object ID for a different repository format before fetching', () => {
        const run = git();
        expect(() => fastForwardNodeUpdate('node-dir', 'main', 'b'.repeat(64), run))
            .toThrow('different Git object format');
        expect(run.mock.calls.some(([args]) => args[0] === 'fetch')).toBe(false);
    });
});
