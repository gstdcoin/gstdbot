/**
 * Attestation hashing/signing/packing — MUST exactly match
 * `SettlementMaster.tact`'s `verifyQuorum()`:
 *
 *   msgHash = beginCell()
 *       .storeUint(taskId, 64)
 *       .storeAddress(workerAddr)
 *       .storeUint(resultHash, 256)
 *       .endCell()
 *       .hash()
 *
 *   attestations = chain of cells, each: {pubkey: uint256, signature: 512 bits},
 *   ref[0] = next attestation cell (or none for the last one).
 *
 * If this drifts from the contract, signatures will simply fail to verify
 * on-chain — there is a sandbox test in gstdcoin/contracts pinning the exact
 * same layout (tests/SettlementMaster.spec.ts), keep both in sync.
 */

import { Address, beginCell, Cell } from '@ton/core';
import { sign as ed25519Sign, signVerify } from '@ton/crypto';
import { createHash } from 'crypto';
import type { AttestorIdentity } from './identity';

export interface Attestation {
    pubkeyHex: string; // 32 bytes hex
    signatureHex: string; // 64 bytes hex
}

/**
 * P2P task IDs are UUIDs (see TaskRequestSchema); the on-chain message needs
 * a uint64. This mapping MUST be used consistently everywhere a task's
 * on-chain taskId is needed (signing, local verification, and the final
 * SettleTaskWithProof submission) — a mismatch here means signatures simply
 * won't verify. First 8 bytes of sha256(uuid) is enough entropy that
 * accidental collisions are not a practical concern at realistic task volume.
 */
export function taskIdToUint64(taskUuid: string): bigint {
    const digest = createHash('sha256').update(taskUuid, 'utf-8').digest();
    return BigInt('0x' + digest.subarray(0, 8).toString('hex'));
}

export function computeMsgHash(taskId: bigint, workerAddr: Address, resultHash: bigint): Buffer {
    return beginCell()
        .storeUint(taskId, 64)
        .storeAddress(workerAddr)
        .storeUint(resultHash, 256)
        .endCell()
        .hash();
}

/** Deterministic 256-bit hash of a task result, for use as `resultHash`. */
export function hashResult(result: string): bigint {
    const digest = createHash('sha256').update(result, 'utf-8').digest();
    return BigInt('0x' + digest.toString('hex'));
}

export function signAttestation(
    identity: AttestorIdentity,
    taskId: bigint,
    workerAddr: Address,
    resultHash: bigint,
): Attestation {
    const hash = computeMsgHash(taskId, workerAddr, resultHash);
    const signature = ed25519Sign(hash, identity.keyPair.secretKey);
    return { pubkeyHex: identity.pubkeyHex, signatureHex: signature.toString('hex') };
}

/** Local sanity check — same primitive the contract's checkSignature() uses. */
export function verifyAttestationLocally(
    att: Attestation,
    taskId: bigint,
    workerAddr: Address,
    resultHash: bigint,
): boolean {
    const hash = computeMsgHash(taskId, workerAddr, resultHash);
    return signVerify(hash, Buffer.from(att.signatureHex, 'hex'), Buffer.from(att.pubkeyHex, 'hex'));
}

/** Builds the Cell chain SettleTaskWithProof/SettleBatch expect for `attestations`. */
export function buildAttestationsChain(attestations: Attestation[]): Cell {
    let chain: Cell | null = null;
    for (let i = attestations.length - 1; i >= 0; i--) {
        const a = attestations[i];
        const b = beginCell()
            .storeUint(BigInt('0x' + a.pubkeyHex), 256)
            .storeBuffer(Buffer.from(a.signatureHex, 'hex'));
        if (chain) b.storeRef(chain);
        chain = b.endCell();
    }
    if (!chain) throw new Error('buildAttestationsChain: empty attestation list');
    return chain;
}
