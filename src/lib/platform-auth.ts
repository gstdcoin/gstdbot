import { signVerify } from '@ton/crypto';
import { createHash } from 'crypto';

/**
 * Ed25519 public key of the GSTD platform operator — baked into source so
 * it is auditable in every PR and cannot be overridden at runtime.
 * To rotate: generate a new keypair, commit the new pubkey, ship a release.
 * The matching release seed is held only in the platform Worker secret; never a TON wallet seed.
 */
export const PLATFORM_PUBKEY_HEX = '82a7b29cca0bff9cdd7ac285277af45287bce77066cf40548ca16ab34a63f30e';

export interface PlatformCommand {
    type:     string;
    payload?: Record<string, unknown>;
    timestamp: number;
    sig:      string;
}

export interface UpdateManifest {
    commit:   string;   // full 40-char SHA of the intended HEAD after git pull
    branch:   string;
    version:  string;
    timestamp: number;
    sig:      string;
}

function commandMessage(type: string, payload: Record<string, unknown> | undefined, timestamp: number): Buffer {
    return createHash('sha256')
        .update(`${type}:${JSON.stringify(payload ?? {})}:${timestamp}`)
        .digest();
}

function manifestMessage(m: Omit<UpdateManifest, 'sig'>): Buffer {
    return createHash('sha256')
        .update(`${m.commit}:${m.branch}:${m.version}:${m.timestamp}`)
        .digest();
}

/**
 * Returns true if the command's signature is valid.
 * Pass a test keypair's pubkeyHex as the second argument in tests;
 * omit it in production code to use the baked-in PLATFORM_PUBKEY_HEX.
 */
export function verifyPlatformCommand(cmd: PlatformCommand, pubkeyHex = PLATFORM_PUBKEY_HEX): boolean {
    if (!pubkeyHex || pubkeyHex.length !== 64) return false;
    try {
        const msg = commandMessage(cmd.type, cmd.payload, cmd.timestamp);
        return signVerify(msg, Buffer.from(cmd.sig, 'hex'), Buffer.from(pubkeyHex, 'hex'));
    } catch {
        return false;
    }
}

/**
 * Returns true if the update manifest's signature is valid.
 * Pass a test keypair's pubkeyHex as the second argument in tests.
 */
export function verifyUpdateManifest(manifest: UpdateManifest, pubkeyHex = PLATFORM_PUBKEY_HEX): boolean {
    if (!pubkeyHex || pubkeyHex.length !== 64) return false;
    try {
        const msg = manifestMessage(manifest);
        return signVerify(msg, Buffer.from(manifest.sig, 'hex'), Buffer.from(pubkeyHex, 'hex'));
    } catch {
        return false;
    }
}

export function isApprovedUpdate(manifest: UpdateManifest | undefined, branch: string): manifest is UpdateManifest {
    return !!manifest && /^[a-f0-9]{40}$/.test(manifest.commit) && manifest.branch === branch &&
        /^\d+\.\d+\.\d+$/.test(manifest.version) && Number.isSafeInteger(manifest.timestamp) &&
        /^[a-f0-9]{128}$/.test(manifest.sig) && !isStaleCommand(manifest.timestamp) && verifyUpdateManifest(manifest);
}

/** Returns true if the timestamp is outside the ±maxSkewMs replay-protection window. */
export function isStaleCommand(timestamp: number, maxSkewMs = 60_000): boolean {
    return Math.abs(Date.now() - timestamp) > maxSkewMs;
}
