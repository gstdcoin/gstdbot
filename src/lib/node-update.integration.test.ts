import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { fastForwardNodeUpdate } from './node-update.js';

it('real Git installs an approved ancestor of newer main without installing main or altering node identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'gstd-signed-update-'));
    const source = join(root, 'source'), installed = join(root, 'installed');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
        git(root, 'init', '-b', 'main', source);
        const commit = (text: string) => {
            writeFileSync(join(source, 'code.txt'), text);
            git(source, 'add', 'code.txt');
            git(source, '-c', 'user.name=GSTD test', '-c', 'user.email=gstd-test@example.invalid', 'commit', '-m', text);
            return git(source, 'rev-parse', 'HEAD');
        };
        const previous = commit('installed'), approved = commit('approved release'), unapproved = commit('later unapproved main');
        git(root, 'clone', '--no-hardlinks', source, installed);
        git(installed, 'checkout', '--detach', previous);
        writeFileSync(join(installed, 'identity.json'), 'preserved local signing identity fixture');
        const result = fastForwardNodeUpdate(installed, 'main', undefined, approved);
        expect(result.updatedHash).toBe(approved);
        expect(git(installed, 'rev-parse', 'HEAD')).toBe(approved);
        expect(git(source, 'rev-parse', 'main')).toBe(unapproved);
        expect(readFileSync(join(installed, 'code.txt'), 'utf8')).toBe('approved release');
        expect(readFileSync(join(installed, 'identity.json'), 'utf8')).toBe('preserved local signing identity fixture');
        expect(() => fastForwardNodeUpdate(installed, 'main', undefined, previous)).toThrow('diverges');
        expect(git(installed, 'rev-parse', 'HEAD')).toBe(approved);
    } finally {
        if (resolve(root).startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('gstd-signed-update-')) {
            rmSync(root, { recursive: true, force: true });
        }
    }
}, 20000);
