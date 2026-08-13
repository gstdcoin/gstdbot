<title>GSTD P2P Settlement RFC</title>

# RFC: P2P Task Routing + Fully On-Chain Settlement

**Status:** Design proposal, not implemented. Written for review before any code lands in `gstdbot` or `contracts`.
**Scope:** Replace the centralized `app.gstdtoken.com` task queue and Redis reward ledger with peer-to-peer task routing and settlement that any node can trigger directly on TON — no backend in the trust path.
**Constraint from the audit:** every claim below is scoped to what the code in `gstdbot`, `contracts`, and `ai` actually contains today (see prior research turn). Nothing here assumes unfinished code already works.

---

## 1. Why this isn't a small change

Three things block "just remove the backend":

1. **`SettlementMaster.tact` hard-codes the caller.** `require(sender() == self.owner || sender() == self.gateway, ...)`. No node can settle its own work today — a single gateway wallet must sign every payout.
2. **No fraud-proof exists anywhere in the P2P layer.** The backend's `tasks/complete.ts` + `lib/rewards.ts` (~290 lines) currently do 7 real jobs: proof-of-assignment, wallet-identity binding, reward idempotency, a hard reward cap, wallet-level batching (economically required — see §4), community-tax accounting, and fine-tuning shard tracking. `GstdP2PNode`'s task protocol has none of these — a node can just claim to have done a task.
3. **Reachability isn't actually P2P today.** Home-NAT nodes reach each other via Cloudflare Tunnel + a GitHub-hosted peer list, not libp2p NAT traversal (no relay/AutoNAT/STUN in `package.json`).

Everything below addresses these three, in order.

---

## 2. Core idea: move trust from *who calls* to *whose signatures are attached*

The contract currently trusts the caller's identity. Instead, it should trust a **quorum of signatures** attached to the call, regardless of who submits the transaction. This is a standard pattern (equivalent to a threshold multisig) and is the only change that lets a node settle its own work without reintroducing a trusted party.

Concretely: a node may call settlement directly, but only succeeds if it attaches signed attestations from other nodes that witnessed the same result.

---

## 3. Result verification: redundant execution, not blind trust

AI inference can't generally be cheaply re-checked after the fact (sampling, non-determinism, model-load differences). The established pattern for this class of problem — used across DePIN AI networks — is **redundant execution with majority agreement**, not a trusted validator.

**Flow for a task requiring verification:**

1. Task is dispatched to **K=3** distinct nodes concurrently (via `GstdP2PNode`'s existing task protocol — the send side already works).
2. Each node computes the result, hashes it, and **commits** `sign(taskId, resultHash, nodeId, timestamp)` — hash only, not the full output, over the existing `/gstd/task/1.0.0` protocol (extended with a new commit sub-type). This commit-before-reveal step stops a lazy node from just copying another node's answer.
3. After a short window, nodes **reveal** full results.
4. If **≥2 of 3** resultHash commitments match, that result is canonical. The matching nodes each get a valid attestation set (each other's signatures over the same `resultHash`); the outlier gets nothing.
5. If all three disagree — expected for creative/high-temperature generation — the task falls into an **unverified tier**: single-node result, lower reward, flagged to the requester as unverified. This is an honest tradeoff, not a bug: don't market single-node results as "cryptographically verified."

**Two explicit tiers**, not one oversold guarantee:
| Tier | Cost | Guarantee |
|---|---|---|
| Verified | ~3× compute (K=3 redundant run) | ≥2-of-3 independent agreement |
| Best-effort | 1× compute | Signed by the executing node only — no correctness proof |

**Fine-tuning jobs** (rarer, expensive to fully duplicate): spot-check instead of redundant training. A small quorum re-evaluates the returned LoRA adapter against a held-out validation slice and attests only if loss is in the expected range. Full redundant training is not proposed — it defeats the point of distributing the work.

---

## 4. New contract messages (`SettlementMaster.tact`)

Two new messages, additive — the existing `SettleTask` path can stay for a transition period if useful.

```tact
message SettleTaskWithProof {
    taskId: Int as uint64;
    workerAddr: Address;
    resultHash: Int as uint256;
    attestations: Cell;       // packed (attestorAddr, signature)[], ≥ quorumThreshold, distinct signers
    gstdBonusAmount: Int as coins;
    computeUnits: Int as uint64;
}

message SettleBatch {
    entries: Cell;             // packed SettleTaskWithProof-equivalent entries, same workerAddr
    // one gas reserve / one set of outbound sends for the whole batch
}
```

**Auth change:** replace the `sender()` check with signature verification —

```tact
// was: require(sender() == self.owner || sender() == self.gateway, ...)
require(verifyQuorum(attestations, quorumThreshold, taskId, workerAddr, resultHash), "Insufficient attested quorum");
```

`verifyQuorum` checks each signature is a valid Ed25519 signature over `(taskId, workerAddr, resultHash)` from a **distinct address registered in `AgentRegistry`** (prerequisite: `AgentRegistry` must actually be deployed — it's written but per `deployment-mainnet.json` is still `phase2_todo`). Bounding K=3 keeps this to 2-3 signature checks per call, not unbounded gas growth.

`sender()` becomes irrelevant to trust — any node (or even a third party) can submit the transaction; only the attached signatures matter. This is what lets a node settle its own work.

**Why `SettleBatch` is required, not optional:** the contract's own `minPayment = ton("0.05")` plus its `0.1 TON` gas reserve means every settlement call needs ≥0.15 TON of attached value. Individual inference-task rewards (fractions of a cent in GSTD) can't each clear that floor. `SettleBatch` lets a node accumulate multiple fully-attested, self-contained task credits locally and cash them out in one call once a threshold is crossed — functionally similar to closing a payment channel, without full state-channel complexity. This also fixes a concrete bug found in the current flow: `settle-rewards.ts` synthesizes `taskId = Date.now() + i` for batched settlements, which defeats the contract's own per-`taskId` replay guard. Under this design, `taskId` must be a deterministic, globally unique ID minted at task-creation time (e.g. `hash(requesterPubkey, nonce, taskSpec)`) and carried unchanged through claim → execution → attestation → settlement, so the existing replay guard actually protects what it's supposed to.

---

## 5. Closing the other gaps found in the audit

| Gap (from research) | Resolution |
|---|---|
| Proof-of-assignment (task wasn't fabricated) | Task creation mints a signed "offer"; claiming node signs a `TaskClaim` and gossips it. First valid claim over the mesh wins; duplicate claims are simply not attested by peers. |
| Wallet-identity binding | Free — attestation signatures use the same TON wallet keypair the node already has via TonConnect. No new key management. |
| Reward idempotency | Enforced by the contract's existing `settledTasks: map<Int, Bool>`, once `taskId` is deterministic (see §4). |
| Hard reward cap | Keep `MAX_REWARD`-equivalent as a contract-level constant, same as today — this doesn't need to move anywhere, just needs to survive into the new message handler. |
| Community-tax / treasury split | Unchanged — `SettleTaskWithProof`/`SettleBatch` keep the existing 85/10/5 split logic verbatim. |
| Fine-tuning shard tracking | Becomes part of the spot-check attestation payload (§3) rather than a Redis job-state record. |
| Bootstrap/NAT not actually P2P today | Replace the GitHub seed-file + Cloudflare Tunnel with: (a) libp2p `circuit-relay-v2` + AutoNAT (missing from `package.json` today) for NAT traversal, (b) a small rotating set of highest-`uptimeScore` nodes (from `AgentRegistry`, once deployed) published via a DNS TXT record or a tiny on-chain config cell, instead of a GitHub-hosted file. Keeps bootstrap inside "site + nodes + chain" with no separate SaaS dependency. |

---

## 6. What's reused vs. genuinely new

**Reused as-is:**
- `GstdP2PNode`'s existing libp2p transport/protocol scaffolding (TCP+Noise+Yamux+mDNS+Bootstrap) — extended, not replaced.
- Node's existing TON wallet keypair for all signing.
- `SettlementMaster`'s 85/10/5 split, treasury deposit, and jetton-bonus send logic.
- `AgentRegistry.tact` — already written, just needs to actually be deployed.

**New work:**
- Complete the currently-unused `TaskResponseSchema` path in `GstdP2PNode` (protocol type exists, nothing sends a response today).
- Commit-reveal redundant-execution dispatch + majority comparison (new client logic in `gstdbot`).
- Attestation signing/verification (straightforward given existing wallet keys).
- `SettleTaskWithProof` + `SettleBatch` contract messages and `verifyQuorum` (new Tact code).
- `circuit-relay-v2` / AutoNAT wiring (new dependency, not currently present).
- On-chain or DNS-based bootstrap registry (small, new).
- Deploying `AgentRegistry` to mainnet (code exists, deployment doesn't).

---

## 7. What I will not do without an explicit go-ahead per step

- **Deploy any new contract message to mainnet without an external security audit.** This moves real GSTD; the existing bridge repo is a cautionary example of what shipping unaudited "decentralized" financial code looks like in production.
- **Roll this out to real node operators before a testnet run.** Redundant-execution dispatch and quorum verification need to be exercised against real network conditions (latency, dropped peers, actual NAT variety) before any mainnet reward is at stake.
- **Push any of this to GitHub myself** — I don't have write access to `gstdbot`, `ai`, or `contracts` (confirmed by a 403 on push, same as `web` earlier). Anything implemented here is delivered as a local patch/branch for you to review and push.

## 8. Suggested order of work

1. Deploy `AgentRegistry` to mainnet (already written — lowest-risk first step, no new contract logic).
2. Implement and test `TaskResponseSchema` completion + commit-reveal dispatch in `gstdbot`, against a local multi-node testbed — no money involved yet, pure networking/logic correctness.
3. Write and internally review `SettleTaskWithProof` / `SettleBatch` + `verifyQuorum`, deploy to **TON testnet only**.
4. Run a real multi-node testnet trial — deliberately include a dishonest node to confirm the quorum mechanism actually rejects bad attestations.
5. External audit of the new contract messages.
6. Mainnet deployment, with the old `SettleTask`/gateway path kept live in parallel until the new path has a track record.
7. Only then retire the gateway-based path and the centralized task queue.

---

## 9. Progress record — what's actually built and verified vs. still open

Updated after implementation work in this session. Read this section before assuming any part of §8's plan is still purely theoretical — steps 1–2 below have real, tested code behind them now.

**Done and verified:**
- `SettleTaskWithProof`, `SettleBatch`, `RegisterAttestorKey`, `SetQuorumThreshold`, and `verifyQuorum` added to `SettlementMaster.tact`, compiled successfully with the real Tact compiler. The existing `SettleTask`/gateway path is untouched and still works (regression-tested).
- 8 automated sandbox tests (`@ton/sandbox`, real TON contract emulator, not mocks) in `tests/SettlementMaster.spec.ts`, covering: valid 2-of-3 quorum settling correctly with an 85% worker payout; rejection of below-threshold quorum; rejection of a duplicated signature counted as two attestations; rejection of an unregistered signer; rejection of a forged/tampered `resultHash`; replay protection on `taskId`; `SettleBatch` settling multiple tasks in one call; and the original gateway path still working unmodified. All 8 pass.
- Three real, previously-undiscovered libp2p compatibility bugs found and fixed in `gstdbot`'s `src/p2p/node.ts` — the P2P layer's send/receive path did not actually work with the pinned `libp2p ^3.1.6`:
  1. `connectToPeer()` passed a raw multiaddr string to `node.dial()`, which this libp2p version rejects — needs a parsed `Multiaddr`.
  2. `getConnections(peerId)` was called with a plain string everywhere (heartbeat, task, and the new task-response/attestation sends) — this version requires a real `PeerId` object.
  3. Every protocol handler used the pre-v3 `stream.sink()`/`stream.source` duplex API, which no longer exists — v3's `Stream` is itself a `send()`/`close()` + directly-async-iterable `MessageStream`. Handlers were also destructuring `{ stream }` from what libp2p actually passes as two positional arguments, `(stream, connection)` — so `stream` was `undefined` in every handler.
  All four are fixed; without this, no P2P message of any kind (heartbeat included) could have been sent or received on the currently pinned libp2p version.
- `src/p2p/identity.ts`, `src/p2p/attestation.ts`, `src/p2p/quorum-coordinator.ts` added: persistent Ed25519 attestor identity (separate from the transport PeerId and the TON wallet), message hashing/signing that exactly mirrors the Tact contract's `verifyQuorum()` cell layout, and a two-way cross-signing coordinator (a peer's self-signed reveal only proves its own claim by construction — reaching quorum requires peers to counter-sign a message addressed to *your* worker address once they independently confirm your result matches theirs).
- `GstdP2PNode` extended with the `/gstd/task-response/1.0.0` and `/gstd/attestation/1.0.0` protocols (`TaskResponseSchema` was previously declared but never wired to anything).
- **Live end-to-end test** (`tests/p2p-quorum-live.ts`, real processes, real TCP sockets, real Ed25519 keys — nothing mocked): 3 real `GstdP2PNode` instances connect over genuine libp2p transport; 2 nodes independently compute the same result and correctly reach 2-of-3 quorum via real cross-signed network messages; the 1 dissenting node correctly fails to reach quorum for its own (minority) result. Passing.
- **Cross-repo integration proof** (`contracts/scripts/verify-p2p-proof.ts`): the exact attestations produced by the live gstdbot P2P run above were fed into the real compiled `SettlementMaster` contract in the TON sandbox and were accepted, settling correctly. This confirms the P2P signing format and the on-chain `verifyQuorum()` are genuinely bit-for-bit compatible, not just independently plausible.

**Still open (§8 steps not done, and why):**
- **`AgentRegistry` mainnet deployment** — needs the project's deployer mnemonic; no key was available in this session. The contract and deploy script are ready; deployment is a one-command action for whoever holds the key.
- **`RegisterAttestorKey` population from real node operators** — currently a manual DAO action per the interim design in §5; wiring it to an automatic on-chain relay from `AgentRegistry` registrations is still open, as noted in §6.
- **TON testnet trial** — the sandbox tests are a local TON emulator (`@ton/sandbox`), not a real testnet deployment. Real testnet latency/fee behavior is unverified.
- **External security audit** — not done. Do not deploy the new settlement messages to mainnet without one; this is unaudited code handling real fund movement, same caution that applies to any new financial contract.
- **NAT traversal / bootstrap redesign** (§5, last row) — `circuit-relay-v2`/AutoNAT wiring and moving bootstrap off the GitHub-hosted seed file are still just proposed, not implemented.
- **Redundant-execution dispatch wiring into `swarm/agent.ts`'s actual task loop** — the live test drives the coordinator directly with pre-computed results (standing in for real inference output) to prove the protocol; it is not yet wired into the real task-polling/execution pipeline.

---

*This document reflects the state of `gstdcoin/ai`, `gstdcoin/gstdbot`, and `gstdcoin/contracts` as read directly from source in this session. Re-verify against current code before acting on it if time has passed.*
