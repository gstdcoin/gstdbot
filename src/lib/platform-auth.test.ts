import { describe, it, expect } from 'vitest';
import { keyPairFromSeed, sign } from '@ton/crypto';
import { randomBytes, createHash } from 'crypto';
import {
    verifyPlatformCommand,
    verifyUpdateManifest,
    isStaleCommand,
    type PlatformCommand,
    type UpdateManifest,
} from './platform-auth.js';

// Fresh test keypair — NOT the production platform key.
// Tests pass this as the optional second argument to override the baked-in constant.
const testSeed      = randomBytes(32);
const testKp        = keyPairFromSeed(testSeed);
const testPubkeyHex = testKp.publicKey.toString('hex');

function signCmd(type: string, payload: Record<string, unknown> | undefined, ts: number): string {
    const msg = createHash('sha256')
        .update(`${type}:${JSON.stringify(payload ?? {})}:${ts}`)
        .digest();
    return Buffer.from(sign(msg, testKp.secretKey)).toString('hex');
}

function signMft(commit: string, branch: string, version: string, ts: number): string {
    const msg = createHash('sha256')
        .update(`${commit}:${branch}:${version}:${ts}`)
        .digest();
    return Buffer.from(sign(msg, testKp.secretKey)).toString('hex');
}

// ─── verifyPlatformCommand ────────────────────────────────────────

describe('verifyPlatformCommand', () => {
    it('returns true for a valid signed command (no payload)', () => {
        const ts  = Date.now();
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: signCmd('restart', undefined, ts) };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(true);
    });

    it('returns true for a valid signed command with payload', () => {
        const ts  = Date.now();
        const cmd: PlatformCommand = {
            type: 'configure', payload: { key: 'value' }, timestamp: ts,
            sig: signCmd('configure', { key: 'value' }, ts),
        };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(true);
    });

    it('returns false when payload is tampered after signing', () => {
        const ts  = Date.now();
        const sig = signCmd('configure', { key: 'original' }, ts);
        const cmd: PlatformCommand = { type: 'configure', payload: { key: 'tampered' }, timestamp: ts, sig };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(false);
    });

    it('returns false when sig is from a different keypair', () => {
        const otherKp  = keyPairFromSeed(randomBytes(32));
        const ts       = Date.now();
        const msg      = createHash('sha256').update(`restart:{}:${ts}`).digest();
        const wrongSig = Buffer.from(sign(msg, otherKp.secretKey)).toString('hex');
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: wrongSig };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(false);
    });

    it('returns false for malformed sig hex without throwing', () => {
        const cmd: PlatformCommand = { type: 'restart', timestamp: Date.now(), sig: 'not-valid-hex!!' };
        expect(() => verifyPlatformCommand(cmd, testPubkeyHex)).not.toThrow();
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(false);
    });

    it('returns false when pubkeyHex is empty string', () => {
        const ts  = Date.now();
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: signCmd('restart', undefined, ts) };
        expect(verifyPlatformCommand(cmd, '')).toBe(false);
    });

    it('returns false when default pubkey (production) is used with a test-key sig', () => {
        // Production PLATFORM_PUBKEY_HEX ≠ testPubkeyHex → verification must fail
        const ts  = Date.now();
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: signCmd('restart', undefined, ts) };
        expect(verifyPlatformCommand(cmd)).toBe(false);
    });
});

// ─── verifyUpdateManifest ─────────────────────────────────────────

describe('verifyUpdateManifest', () => {
    it('returns true for a valid signed manifest', () => {
        const ts = Date.now();
        const m: UpdateManifest = {
            commit: 'a'.repeat(40), branch: 'main', version: '1.4.2', timestamp: ts,
            sig: signMft('a'.repeat(40), 'main', '1.4.2', ts),
        };
        expect(verifyUpdateManifest(m, testPubkeyHex)).toBe(true);
    });

    it('returns false when commit is tampered after signing', () => {
        const ts  = Date.now();
        const sig = signMft('a'.repeat(40), 'main', '1.4.2', ts);
        const m: UpdateManifest = { commit: 'b'.repeat(40), branch: 'main', version: '1.4.2', timestamp: ts, sig };
        expect(verifyUpdateManifest(m, testPubkeyHex)).toBe(false);
    });

    it('returns false for malformed sig without throwing', () => {
        const m: UpdateManifest = { commit: 'a'.repeat(40), branch: 'main', version: '1.0.0', timestamp: Date.now(), sig: 'bad' };
        expect(() => verifyUpdateManifest(m, testPubkeyHex)).not.toThrow();
        expect(verifyUpdateManifest(m, testPubkeyHex)).toBe(false);
    });

    it('returns false when pubkeyHex is empty string', () => {
        const ts = Date.now();
        const m: UpdateManifest = {
            commit: 'a'.repeat(40), branch: 'main', version: '1.0.0', timestamp: ts,
            sig: signMft('a'.repeat(40), 'main', '1.0.0', ts),
        };
        expect(verifyUpdateManifest(m, '')).toBe(false);
    });
});

// ─── isStaleCommand ───────────────────────────────────────────────

describe('isStaleCommand', () => {
    it('returns false for a fresh timestamp', () => {
        expect(isStaleCommand(Date.now())).toBe(false);
    });

    it('returns false for timestamp 59 999 ms in the past', () => {
        expect(isStaleCommand(Date.now() - 59_999)).toBe(false);
    });

    it('returns true for timestamp 60 001 ms in the past', () => {
        expect(isStaleCommand(Date.now() - 60_001)).toBe(true);
    });

    it('returns true for a timestamp 60 001 ms in the future', () => {
        expect(isStaleCommand(Date.now() + 60_001)).toBe(true);
    });

    it('respects a custom maxSkewMs', () => {
        expect(isStaleCommand(Date.now() - 5_001, 5_000)).toBe(true);
        expect(isStaleCommand(Date.now() - 4_999, 5_000)).toBe(false);
    });
});
