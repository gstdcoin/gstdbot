import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSavedNodeConfig } from './saved-node-config.js';

const directories: string[] = [];
function fixture(raw?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'gstd-saved-config-'));
    directories.push(dir);
    const file = join(dir, 'config.json');
    if (raw !== undefined) writeFileSync(file, raw, { mode: 0o600 });
    return file;
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('allows defaults only when there is no saved configuration', () => {
    expect(readSavedNodeConfig(fixture())).toBeNull();
});
it.each(['{broken', 'null', '[]', '"config"', '{}', '{"nodeId":42}', '{"nodeId":" "}', '{"nodeId":"stable","swarm":null}', '{"nodeId":"stable","dashboard":[]}'])('preserves damaged saved configuration and refuses identity replacement (%s)', raw => {
    const file = fixture(raw);
    expect(() => readSavedNodeConfig(file)).toThrow('Refusing to replace the node identity');
    expect(readFileSync(file, 'utf8')).toBe(raw);
});
it('retains restored identity, settings and extensions without rewriting the file', () => {
    const saved = { nodeId: 'original-node-id', nodeName: 'restored', swarm: { apiUrl: 'https://app.gstdtoken.xyz' }, extension: { custom: true } };
    const raw = JSON.stringify(saved);
    const file = fixture(raw);
    expect(readSavedNodeConfig(file)).toEqual(saved);
    expect(readFileSync(file, 'utf8')).toBe(raw);
});
it('does not disclose damaged contents in an error message', () => {
    const file = fixture('{"privateValue":"fixture-credential",');
    expect(() => readSavedNodeConfig(file)).toThrow(/^Saved node configuration is corrupt;/);
    try { readSavedNodeConfig(file); } catch (error) { expect(String(error)).not.toContain('fixture-credential'); }
});
