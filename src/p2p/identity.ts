/**
 * P2P attestor identity — a persistent Ed25519 keypair used to sign task
 * attestations for quorum-based settlement (see docs/P2P_SETTLEMENT_RFC.md).
 *
 * Deliberately separate from:
 *  - the libp2p transport PeerId (connection identity, can be ephemeral)
 *  - the TON wallet (payment identity, external-signer only per src/wallet)
 *
 * This keypair uses the exact same Ed25519 primitives TON's `checkSignature`
 * on-chain opcode verifies against (@ton/crypto), so a signature produced
 * here is directly usable in a SettleTaskWithProof attestation without any
 * format conversion.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { keyPairFromSeed, sign, type KeyPair } from '@ton/crypto';
import { randomBytes, createHash } from 'crypto';

const CONFIG_DIR = join(homedir(), '.config', 'gstdbot');
const IDENTITY_FILE = join(CONFIG_DIR, 'attestor-identity.json');

export interface AttestorIdentity {
    keyPair: KeyPair;
    pubkeyHex: string; // 64 hex chars = 32 bytes, matches on-chain `Int as uint256`
}

/** Loads the node's attestor keypair, generating and persisting one on first run. */
export function loadOrCreateAttestorIdentity(): AttestorIdentity {
    if (existsSync(IDENTITY_FILE)) {
        const raw = JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
        const seed = Buffer.from(raw.seedHex, 'hex');
        const keyPair = keyPairFromSeed(seed);
        return { keyPair, pubkeyHex: keyPair.publicKey.toString('hex') };
    }

    const seed = randomBytes(32);
    const keyPair = keyPairFromSeed(seed);

    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
        IDENTITY_FILE,
        JSON.stringify({ seedHex: seed.toString('hex'), createdAt: new Date().toISOString() }, null, 2),
        { mode: 0o600 }, // seed is sensitive — same posture as wallet.json
    );

    return { keyPair, pubkeyHex: keyPair.publicKey.toString('hex') };
}

/** Raw sign — callers construct the exact message hash themselves (see attestation.ts). */
export function signWithIdentity(identity: AttestorIdentity, hash: Buffer): Buffer {
    return sign(hash, identity.keyPair.secretKey);
}

export function peerRequestMessage(nodeId: string, timestamp: number): Buffer {
    return createHash('sha256').update(`${nodeId}:${timestamp}`).digest();
}

export function signPeerRequest(
    identity: AttestorIdentity,
    nodeId: string,
    timestamp: number = Date.now()
): Record<string, string> {
    const msg = peerRequestMessage(nodeId, timestamp);
    const sig = signWithIdentity(identity, msg);
    return {
        'X-GSTD-Node-Id':  nodeId,
        'X-GSTD-Node-Ts':  String(timestamp),
        'X-GSTD-Node-Sig': sig.toString('hex'),
    };
}
