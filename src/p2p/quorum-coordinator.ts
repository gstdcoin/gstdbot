/**
 * QuorumCoordinator — collects signed attestations for a single task from
 * its co-executors and decides whether a quorum was reached for THIS node's
 * own result. See docs/P2P_SETTLEMENT_RFC.md §3.
 *
 * Protocol (2-way cross-signing — this is the part that makes the quorum
 * cryptographically meaningful, not just "messages arrived"):
 *
 *  1. Every node signs a "reveal": msgHash(taskId, its OWN workerAddr,
 *     its OWN resultHash), and broadcasts it to co-executors. This is only
 *     valid as proof for THAT node's own payout — a signature that embeds
 *     address A can never verify as proof for address B, by construction
 *     (see attestation.ts). So a peer's self-signed reveal is NOT by itself
 *     usable toward MY quorum.
 *  2. When a node receives a peer's reveal and finds the peer's resultHash
 *     matches its OWN independently-computed result, it signs a fresh
 *     ENDORSEMENT — msgHash(taskId, the PEER's workerAddr, resultHash),
 *     signed with ITS OWN key — and broadcasts that too. This is the
 *     cross-signature that actually counts toward the peer's quorum.
 *  3. Each node tallies only attestations/endorsements whose `workerAddr`
 *     equals its OWN address, verifies each signature locally, and accepts
 *     once distinct valid signers >= quorumThreshold.
 *
 * Runs independently on every co-executor: each node races to collect
 * enough matching endorsements for its own resultHash before the deadline.
 * A node whose result was in the minority (or who never hears back from
 * enough peers) simply never reaches quorum for its own hash — there is no
 * single arbiter deciding who "wins".
 */

import type { GstdP2PNode, P2PAttestation } from './node';
import { verifyAttestationLocally, taskIdToUint64, signAttestation, type Attestation } from './attestation';
import type { AttestorIdentity } from './identity';
import { Address } from '@ton/core';

export interface QuorumResult {
    accepted: boolean;
    resultHash: string;
    attestations: Attestation[]; // ready to pass to buildAttestationsChain()
    reason?: string;
}

export interface QuorumTaskContext {
    taskId: string;
    identity: AttestorIdentity; // used to sign endorsements for peers on the fly
    workerAddr: string; // this node's own TON address — who gets paid if quorum is reached
    ownResultHash: string; // hex
    ownAttestation: P2PAttestation; // this node's own self-signed reveal (workerAddr = own address)
    coExecutorPeerIds: string[]; // peer IDs of the other nodes assigned this task
    quorumThreshold: number;
    timeoutMs?: number;
}

export function awaitQuorum(p2p: GstdP2PNode, ctx: QuorumTaskContext): Promise<QuorumResult> {
    const timeoutMs = ctx.timeoutMs ?? 8_000;
    // Attestations/endorsements addressed to MY OWN workerAddr, keyed by
    // attestor pubkey (own self-attestation seeded in immediately).
    const collected = new Map<string, P2PAttestation>();
    collected.set(ctx.ownAttestation.pubkeyHex, ctx.ownAttestation);
    const alreadyEndorsed = new Set<string>(); // dedupe: don't re-sign the same peer+resultHash repeatedly

    const workerAddr = Address.parse(ctx.workerAddr);
    const taskIdU64 = taskIdToUint64(ctx.taskId);
    const resultHashBig = BigInt('0x' + ctx.ownResultHash);

    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: QuorumResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            p2p.off('attestation:received', onAttestation);
            resolve(result);
        };

        const evaluate = () => {
            const candidates = Array.from(collected.values()).filter(
                (a) => a.taskId === ctx.taskId && a.resultHash === ctx.ownResultHash && a.workerAddr === ctx.workerAddr,
            );
            // Re-verify every collected signature locally before counting it —
            // a co-executor could forward a garbage/forged attestation.
            // On-chain checkSignature is the real authority; this is a
            // fail-fast local mirror so a bad signature doesn't silently
            // count toward quorum.
            const verified = candidates.filter((a) =>
                verifyAttestationLocally({ pubkeyHex: a.pubkeyHex, signatureHex: a.signatureHex }, taskIdU64, workerAddr, resultHashBig),
            );

            if (process.env.GSTD_P2P_DEBUG) {
                console.log(`[quorum-debug] ${ctx.ownAttestation.nodeId} evaluate: collected=${collected.size} candidates=${candidates.length} verified=${verified.length} threshold=${ctx.quorumThreshold}`);
            }

            if (verified.length >= ctx.quorumThreshold) {
                const attestations: Attestation[] = verified.map((a) => ({
                    pubkeyHex: a.pubkeyHex,
                    signatureHex: a.signatureHex,
                }));
                finish({ accepted: true, resultHash: ctx.ownResultHash, attestations });
            }
        };

        const onAttestation = (att: P2PAttestation) => {
            if (att.taskId !== ctx.taskId) return;
            if (!ctx.coExecutorPeerIds.length) return; // no quorum expected in single-node mode

            if (att.workerAddr === ctx.workerAddr) {
                // An endorsement (or my own echoed reveal) addressed to ME.
                collected.set(att.pubkeyHex, att);
                evaluate();
                return;
            }

            // A peer's OWN reveal for THEIR payout. If their result matches
            // what I independently computed, cross-sign an endorsement for
            // THEIR workerAddr and broadcast it — this is what lets them
            // reach quorum, and is the step that actually makes the quorum
            // mean something (I'm vouching with my own key, not repeating
            // theirs).
            if (att.resultHash !== ctx.ownResultHash) return; // I disagree with this peer's result — no endorsement
            const dedupeKey = `${att.workerAddr}:${att.resultHash}`;
            if (alreadyEndorsed.has(dedupeKey)) return;
            alreadyEndorsed.add(dedupeKey);

            try {
                const peerAddr = Address.parse(att.workerAddr);
                const endorsement = signAttestation(ctx.identity, taskIdU64, peerAddr, resultHashBig);
                const endorsementMsg: Omit<P2PAttestation, 'type'> = {
                    taskId: ctx.taskId,
                    nodeId: ctx.ownAttestation.nodeId,
                    workerAddr: att.workerAddr, // addressed to the PEER being endorsed
                    resultHash: ctx.ownResultHash,
                    pubkeyHex: endorsement.pubkeyHex, // but signed by ME
                    signatureHex: endorsement.signatureHex,
                };
                p2p.broadcastAttestation(ctx.coExecutorPeerIds, endorsementMsg).catch(() => {});
            } catch {
                // malformed peer address — nothing to endorse
            }
        };

        p2p.on('attestation:received', onAttestation);

        // Broadcast our own reveal to every co-executor, then evaluate
        // immediately in case attestations already arrived (out-of-order).
        p2p.broadcastAttestation(ctx.coExecutorPeerIds, ctx.ownAttestation)
            .then((sent) => {
                if (process.env.GSTD_P2P_DEBUG) {
                    console.log(`[quorum-debug] ${ctx.ownAttestation.nodeId} broadcastAttestation sent=${sent}/${ctx.coExecutorPeerIds.length}`);
                }
            })
            .catch(() => {});
        evaluate();

        const timer = setTimeout(() => {
            finish({
                accepted: false,
                resultHash: ctx.ownResultHash,
                attestations: [],
                reason: `quorum not reached within ${timeoutMs}ms (${collected.size}/${ctx.quorumThreshold} counted toward own payout)`,
            });
        }, timeoutMs);
    });
}
