/**
 * Live multi-node test — NOT a mock. Spins up 3 real GstdP2PNode instances
 * (real libp2p, real TCP sockets on localhost, real mDNS discovery, real
 * Ed25519 signing) in one process and drives a full redundant-execution +
 * quorum-attestation round, simulating:
 *   - 2 honest nodes computing the same result (should reach quorum)
 *   - 1 dissenting node computing a different result (should NOT reach
 *     quorum for its own result — proves the majority mechanism actually
 *     rejects a minority/dishonest answer, not just that messages arrive)
 *
 * Run: npx tsx tests/p2p-quorum-live.ts
 */

import { GstdP2PNode } from '../src/p2p/node';
import { signAttestation, hashResult, taskIdToUint64 } from '../src/p2p/attestation';
import { awaitQuorum } from '../src/p2p/quorum-coordinator';
import { createHash } from 'crypto';
import { keyPairFromSeed } from '@ton/crypto';
import { join } from 'path';
import { mkdirSync } from 'fs';

// Use isolated per-node identity files so 3 "nodes" in one process don't
// collide on ~/.config/gstdbot/attestor-identity.json.
function isolatedIdentity(nodeIndex: number) {
    const dir = join(process.cwd(), '.p2p-test-tmp', `node-${nodeIndex}`);
    mkdirSync(dir, { recursive: true });
    const seed = createHash('sha256').update(`test-node-${nodeIndex}`).digest();
    const keyPair = keyPairFromSeed(seed);
    return { keyPair, pubkeyHex: keyPair.publicKey.toString('hex') };
}

// Deterministic fake TON addresses for the 3 nodes (valid workchain-0 form).
function fakeAddress(nodeIndex: number): string {
    const { Address } = require('@ton/core');
    const hash = createHash('sha256').update(`worker-${nodeIndex}`).digest();
    return new Address(0, hash).toString();
}

async function main() {
    console.log('=== Live P2P quorum test: 3 real libp2p nodes ===\n');

    const identities = [0, 1, 2].map(isolatedIdentity);
    const addresses = [0, 1, 2].map(fakeAddress);

    const nodes = [0, 1, 2].map(
        (i) =>
            new GstdP2PNode({
                nodeId: `test-node-${i}`,
                walletAddress: addresses[i],
                listenPort: 14001 + i,
                enableMdns: true,
                bootstrapPeers: [],
            }),
    );

    console.log('Starting 3 nodes...');
    const peerIds = await Promise.all(nodes.map((n) => n.start()));
    peerIds.forEach((id, i) => console.log(`  node-${i}: ${id.slice(0, 20)}...`));

    // Don't depend on mDNS multicast working in this sandbox (often blocked
    // in containers/CI) — explicitly cross-dial every pair, the same way the
    // Bootstrap discovery layer would for WAN nodes. This still exercises
    // real TCP+Noise+Yamux libp2p connections end-to-end, just via a known
    // multiaddr instead of multicast discovery.
    console.log('\nCross-dialing all node pairs directly (bypassing mDNS)...');
    const multiaddrs = nodes.map((n) => n.getMultiaddrs());
    multiaddrs.forEach((addrs, i) => console.log(`  node-${i} multiaddrs:`, addrs));

    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (i === j) continue;
            // Prefer the loopback address — this is a same-machine test, and
            // the LAN/VPN-adapter addresses libp2p also announces may not
            // actually be reachable in a sandboxed network namespace.
            const target = multiaddrs[j].find((a) => a.startsWith('/ip4/127.0.0.1/')) || multiaddrs[j][0];
            if (target) {
                const ok = await nodes[i].connectToPeer(target);
                if (!ok) console.log(`  dial node-${i} -> node-${j} (${target}) failed`);
            }
        }
    }

    console.log('\nWaiting for connections to establish...');
    const deadline = Date.now() + 15_000;
    let allConnected = false;
    while (Date.now() < deadline) {
        const counts = nodes.map((n) => n.getConnectionCount());
        if (counts.every((c) => c >= 2)) {
            allConnected = true;
            break;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!allConnected) {
        console.error('FAIL: nodes did not establish direct connections within 15s');
        console.error('Raw connection counts:', nodes.map((n) => n.getConnectionCount()));
        await Promise.all(nodes.map((n) => n.stop()));
        process.exit(1);
    }
    console.log('All 3 nodes have 2 live libp2p connections each — mesh formed.');

    // Opening an application-level stream immediately after a connection is
    // established can race with libp2p's automatic identify exchange and
    // gets reset (reproduced and confirmed during development of this test).
    // The existing heartbeat code already waits 1s after peer:connect for
    // the same reason; match that here before driving the attestation flow.
    await new Promise((r) => setTimeout(r, 1500));
    console.log('(settled)\n');

    // Map peerId -> node index, so we can resolve coExecutor peer IDs.
    const peerIdOf = (i: number) => peerIds[i];

    const taskId = '11111111-1111-1111-1111-111111111111';
    // Nodes 0 and 1 compute the SAME (honest, majority) result.
    // Node 2 computes a DIFFERENT result (simulating a fault or dishonest node).
    const honestResult = 'the answer is 42';
    const dissentingResult = 'the answer is 41 (wrong)';
    const results = [honestResult, honestResult, dissentingResult];

    console.log('Each node "executes" the task and broadcasts a signed attestation to its co-executors...\n');

    const runs = [0, 1, 2].map(async (i) => {
        const identity = identities[i];
        const resultHash = hashResult(results[i]).toString(16).padStart(64, '0');
        const workerAddr = addresses[i]; // each node settles for ITSELF
        const taskIdU64 = taskIdToUint64(taskId);

        const att = signAttestation(identity, taskIdU64, require('@ton/core').Address.parse(workerAddr), BigInt('0x' + resultHash));
        const ownAttestation = {
            type: 'attestation' as const,
            taskId,
            nodeId: `test-node-${i}`,
            workerAddr,
            resultHash,
            pubkeyHex: att.pubkeyHex,
            signatureHex: att.signatureHex,
        };

        const coExecutors = [0, 1, 2].filter((j) => j !== i).map(peerIdOf);

        const result = await awaitQuorum(nodes[i], {
            taskId,
            identity,
            workerAddr,
            ownResultHash: resultHash,
            ownAttestation,
            coExecutorPeerIds: coExecutors,
            quorumThreshold: 2,
            timeoutMs: 10_000,
        });

        return { nodeIndex: i, result };
    });

    const outcomes = await Promise.all(runs);

    console.log('=== Results ===');
    let pass = true;
    for (const { nodeIndex, result } of outcomes) {
        console.log(
            `node-${nodeIndex} (result="${results[nodeIndex]}"): accepted=${result.accepted}` +
                (result.accepted ? `, attestations=${result.attestations.length}` : `, reason=${result.reason}`),
        );
    }

    const node0 = outcomes[0].result;
    const node1 = outcomes[1].result;
    const node2 = outcomes[2].result;

    if (!node0.accepted || node0.attestations.length < 2) {
        console.error('FAIL: honest node-0 should have reached quorum with >=2 attestations');
        pass = false;
    }
    if (!node1.accepted || node1.attestations.length < 2) {
        console.error('FAIL: honest node-1 should have reached quorum with >=2 attestations');
        pass = false;
    }
    if (node2.accepted) {
        console.error('FAIL: dissenting node-2 should NOT have reached quorum for its own (minority) result');
        pass = false;
    }

    await Promise.all(nodes.map((n) => n.stop()));

    if (pass) {
        console.log('\nPASS — majority result reached quorum over real P2P connections; minority result correctly rejected.');
        // Write node-0's real, P2P-produced attestations out so the contracts
        // repo's sandbox test can prove these exact signatures — generated by
        // this TypeScript P2P layer, over a real network — are accepted by
        // the actual compiled SettlementMaster contract, not just structurally
        // similar to what a contract test independently fabricated.
        const fs = require('fs');
        const path = require('path');
        const outPath = path.join(process.cwd(), '.p2p-test-tmp', 'node0-quorum-proof.json');
        fs.writeFileSync(
            outPath,
            JSON.stringify(
                {
                    taskId,
                    workerAddr: addresses[0],
                    resultHash: node0.resultHash,
                    attestations: node0.attestations, // [{pubkeyHex, signatureHex}, ...]
                },
                null,
                2,
            ),
        );
        console.log(`Wrote real attestation proof to ${outPath} for cross-repo contract verification.`);
        process.exit(0);
    } else {
        console.log('\nFAIL — see errors above.');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Test crashed:', err);
    process.exit(1);
});
