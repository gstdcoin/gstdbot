# Quorum Attestation Gaps — Design Spec (Sub-project D)

**Date:** 2026-08-27
**Status:** Approved for implementation

## Goal

Close four gaps in the existing quorum attestation path so the already-wired `attemptQuorumSettlement` / `participateInQuorumVerification` loop actually works correctly end-to-end:

1. **task.id normalization bug** — `participateInQuorumVerification` uses `task.id` directly; tasks arriving via the P2P protocol carry `task_id`, not `id`, so `taskIdToUint64(undefined)` silently produces the wrong taskId, making every co-executor cross-signature wrong.
2. **Identity loaded lazily per call** — both quorum functions call `loadOrCreateAttestorIdentity()` via dynamic import on every invocation; since sub-project C now loads identity at startup, `SwarmAgent` should receive and reuse it.
3. **Quality-score feedback missing** — when co-executors participate in quorum, `PeerManager.recordOutcome()` is never called; the sub-project C quality system is blind to quorum responsiveness.
4. **No operator visibility** — quorum settlement counts (submitted, pending, total attestations) are not surfaced anywhere; operators cannot tell if the system is working.

## Architecture

### What already exists (do not rebuild)

- `src/p2p/attestation.ts` — `signAttestation()`, `verifyAttestationLocally()`, `buildAttestationsChain()`, `hashResult()`, `taskIdToUint64()` — complete and correct.
- `src/p2p/quorum-coordinator.ts` — `awaitQuorum()` — complete, handles cross-signing protocol.
- `src/p2p/node.ts` — `broadcastAttestation()`, `sendAttestation()`, `attestation:received` events — complete.
- `src/swarm/agent.ts` — `attemptQuorumSettlement()` called from `processTask()` for inference tasks (line 928); `participateInQuorumVerification()` called when co-executor receives a quorum task (line 145); pending settlement retry queue with file persistence — all present.
- `src/p2p/peers.ts` — `PeerManager.recordOutcome(nodeId, success)` — added in sub-project C.
- `src/index.ts` — `loadOrCreateAttestorIdentity()` called at startup, identity stored as `const identity` — added in sub-project C.
- `src/gateway/server.ts` — `/api/v1/status` endpoint returns `swarm: { ... }` block from `agent.getStats()`.

### New components

**Identity threading into `SwarmAgent`:**

```ts
// New private field + setter on SwarmAgent class
private identity: AttestorIdentity | null = null;
setIdentity(identity: AttestorIdentity): void { this.identity = identity; }
```

Both `attemptQuorumSettlement()` and `participateInQuorumVerification()` currently do:
```ts
const { loadOrCreateAttestorIdentity } = await import('../p2p/identity.js');
const identity = loadOrCreateAttestorIdentity();
```

Replace with: `if (!this.identity) return;` guard at the top of each function, then use `this.identity` directly.

Also convert the other dynamic imports in these two functions (`attestation.js`, `quorum-coordinator.js`, `@ton/core`) to static imports at the top of `agent.ts` — they are always used on the happy path and have no circular deps.

Called from `index.ts` immediately after `swarm` is created and before `swarm.start()`:
```ts
if (swarm) swarm.setIdentity(identity);
```

**PeerManager threading into `SwarmAgent`:**

```ts
private peerManager: PeerManager | null = null;
setPeerManager(pm: PeerManager): void { this.peerManager = pm; }
```

Called from `index.ts` after gateway is initialized (gateway already owns peerManager):
```ts
if (swarm) swarm.setPeerManager(gateway.getPeerManager());
```

**task.id normalization in `participateInQuorumVerification`:**

Add the same two-line normalization that `processTask()` already applies (lines 913-914), at the top of `participateInQuorumVerification()`:
```ts
if (!(task as any).id && (task as any).task_id) {
    (task as any).id = (task as any).task_id;
}
```

**Quality-score feedback in `attemptQuorumSettlement`:**

After `awaitQuorum` returns, record outcomes for each co-executor. Since `coExecutors` always has exactly 2 entries and `quorumThreshold` is 2, a successful quorum means both responded:

```ts
for (const coExecutorId of coExecutors) {
    this.peerManager?.recordOutcome(coExecutorId, quorumResult.accepted);
}
```

Placed immediately after `awaitQuorum()` returns, before any branching on `quorumResult.accepted` — runs regardless of whether the quorum was accepted or rejected, since quality feedback is about the peer's responsiveness, not the settlement outcome.

**Quorum stats tracking:**

Add three fields to `SwarmStats` interface:
```ts
quorumProofsSubmitted: number;
quorumProofsPending: number;
quorumAttestationsTotal: number;
```

Initialize all three to `0` in the stats object. Track in `attemptQuorumSettlement()`:
- On `submitted` (platform call succeeded): `this.stats.quorumProofsSubmitted++; this.stats.quorumAttestationsTotal += quorumResult.attestations.length`
- On `!submitted` (queued locally): same increments — the proof was produced even if not yet delivered

`quorumProofsPending` is dynamic (file-backed): override it in `getStats()`:
```ts
getStats(): SwarmStats {
    this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    this.stats.quorumProofsPending = this.loadPendingSettlements().length;
    return { ...this.stats };
}
```

**Status endpoint — add quorum fields to swarm block:**

In `server.ts` at the `swarm: (() => { ... })()` block (~line 1567), add:
```ts
quorumSettlement: {
    submitted:    stats?.quorumProofsSubmitted || 0,
    pending:      stats?.quorumProofsPending || 0,
    attestations: stats?.quorumAttestationsTotal || 0,
},
```

**Dashboard — quorum rows in Node Information card:**

In `web/dashboard.html`, the "Node Information" card (~line 787) currently shows Node ID, Version, Platform, Architecture, Central Server. Add three rows after "Central Server":

```html
<div class="row jb mb8"><span class="muted sm">Quorum Proofs</span><span class="fw6" id="s-qp-submitted">—</span></div>
<div class="row jb mb8"><span class="muted sm">Pending Settlement</span><span class="fw6" id="s-qp-pending">—</span></div>
<div class="row jb"><span class="muted sm">Attestations</span><span class="fw6" id="s-qp-attest">—</span></div>
```

In the dashboard JS (`refreshSettings()` or equivalent status handler), wire them:
```js
set('s-qp-submitted', d.swarm?.quorumSettlement?.submitted ?? '—');
set('s-qp-pending',   d.swarm?.quorumSettlement?.pending   ?? '—');
set('s-qp-attest',    d.swarm?.quorumSettlement?.attestations ?? '—');
```

### Data flow: quorum attestation (corrected)

```
processTask('inference')
  → computeTaskResult()
  → attemptQuorumSettlement(task, taskId, result)
      → guard: this.identity? this.p2pNode? peers >= 2? → else no-op
      → sendTask() to 2 co-executors
      → awaitQuorum() — 8s timeout
          → broadcastAttestation (own reveal)
          → collect cross-signed endorsements
      → quorumResult.accepted?
          → recordOutcome(coExecutorId, accepted) × 2  ← NEW
          → stats: quorumProofsSubmitted++, attestationsTotal += N  ← NEW
          → apiCall('/settlement/quorum-proof', payload)
              → success: log "🔐 Quorum reached"
              → fail: queuePendingSettlement → retried every 2 min

participateInQuorumVerification(task, coExecutors, threshold)
  → normalize task.id ← FIXED
  → guard: this.identity? → else no-op  ← CHANGED
  → computeTaskResult()
  → awaitQuorum() — 8s timeout (cross-sign for originator, no platform report)
```

### Single-node survivability

All four changes degrade to no-op with zero peers:
- `setIdentity` / `setPeerManager` not called → both functions return early on their guards, quorum path is fully skipped (unchanged behavior).
- `recordOutcome` behind `this.peerManager?.recordOutcome()` — null-safe.
- Quorum stats remain 0 — status endpoint still returns valid JSON.

## Error handling

- Both quorum functions: `if (!this.identity) return;` — silent no-op, not an error (single-node mode is normal).
- `recordOutcome` is never called if `peerManager` is null.
- `this.loadPendingSettlements()` catching all filesystem errors (already wrapped in try/catch) — returns `[]` on failure; `quorumProofsPending` shows 0 rather than crashing `getStats()`.
- Static imports replacing dynamic imports: any import failure crashes the module at startup rather than silently at call time — this is better behavior (fail fast).

## Testing

**Unit tests (extend `src/swarm/agent.ts` test coverage):**

No dedicated test file exists for `agent.ts` — add `src/swarm/agent.test.ts`:

1. `task.id` normalization: construct a task with only `task_id` set; verify `participateInQuorumVerification` reads the correct ID (via spying on `taskIdToUint64`)
2. `setIdentity` guard: call `attemptQuorumSettlement` without calling `setIdentity` first; verify it returns without calling `hashResult` (i.e., no-ops cleanly)
3. `recordOutcome` called: mock peerManager with a jest spy; simulate quorum accepted → verify `recordOutcome(coExecutorId, true)` called for each co-executor
4. Stats tracking: simulate a successful quorum → verify `quorumProofsSubmitted` incremented and `quorumAttestationsTotal` reflects attestation count

**Live verification:**

- `npx tsc --noEmit --skipLibCheck` — clean
- `npx vitest run` — all tests pass (no regressions)
- `pm2 restart gstdbot`
- `curl -s http://localhost:8080/api/v1/status | python3 -m json.tool | grep -A5 quorumSettlement` — confirms fields present in response
- Dashboard Settings tab — confirm quorum rows render (show `0` for a fresh node with no quorum history)

## Global Constraints

- No new external dependencies — `@ton/core`, `@ton/crypto`, `crypto` already in package.json.
- No behavioral change to existing dashboard routes or task-completion path — quorum remains fire-and-forget, never blocks `/tasks/complete`.
- Single-node survivability: all paths degrade to no-op with zero peers and no identity set.
- `npx vitest run` and `npx tsc --noEmit --skipLibCheck` must stay clean.
- Static imports replacing dynamic imports in `agent.ts` must not introduce circular dependencies (none exist between `attestation.ts`, `quorum-coordinator.ts`, `@ton/core` and `agent.ts`).
