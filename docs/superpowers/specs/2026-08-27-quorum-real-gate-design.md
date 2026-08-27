# Quorum as Real Gate — Design Spec

**Status:** Approved  
**Date:** 2026-08-27  
**Sub-project:** F

---

## Problem

Sub-project D wired real Ed25519 quorum attestation into the node lifecycle: `SwarmAgent` now calls `attemptQuorumSettlement()` after computing each inference task. But the call is fire-and-forget — it never blocks the existing `/tasks/complete` report. The central platform receives and pays out every task result whether or not quorum was assembled. Quorum is a logging concern, not an economic gate.

---

## Goal

Make quorum verification a **conditional hard gate** for task completion payout on inference tasks:

- When the node has ≥2 peers + identity loaded: quorum must succeed before `/tasks/complete` is called. If quorum fails, the reward is forfeited (task completion is not reported to the platform).
- When the node has <2 peers or no identity loaded: report to `/tasks/complete` as today (degraded mode), log clearly that quorum couldn't be attempted.

Single-node operators (current Pi setup, 0 peers) continue earning. Multi-node operators enforce the gate.

---

## Architecture

### 1. `canAttemptQuorum(): boolean`

New private method on `SwarmAgent`. Centralises the precondition check used in two places:

```ts
private canAttemptQuorum(): boolean {
    if (!this.p2pNode) return false;
    if (!this.identity) return false;
    const peers = (this.p2pNode.getPeers() as any[])
        .map((p: any) => p.nodeId)
        .filter((id: string) => id && id !== this.config.nodeId);
    return peers.length >= 2;
}
```

### 2. `attemptQuorumSettlement()` return type

Change from `Promise<void>` to `Promise<boolean>`:

- All early-exit `return;` statements → `return false;`
- After `quorumResult.accepted` path executes (settlement submitted or queued): add `return true;` at the end of the function body.

The semantics: `true` means quorum was reached and the settlement proof was submitted (or queued for retry); `false` means quorum was not reached for any reason.

### 3. `processTask()` gate

Replace the fire-and-forget block with a conditional gate. The existing pattern:

```ts
// OLD (fire-and-forget):
if (task.type === 'inference') {
    this.attemptQuorumSettlement(task, taskId, result).catch(() => {});
}
const reported = await this.apiCall('/tasks/complete', completionPayload);
```

New pattern:

```ts
// NEW (conditional gate):
if (task.type === 'inference') {
    if (this.canAttemptQuorum()) {
        const quorumReached = await this.attemptQuorumSettlement(task, taskId, result).catch(() => false);
        if (!quorumReached) {
            this.stats.tasksCompleted++;
            this.stats.tasksByType[task.type] = (this.stats.tasksByType[task.type] || 0) + 1;
            this.stats.quorumGateFailed++;
            logActivity(`Task ${taskId.slice(0, 8)} computed — quorum not reached, reward forfeited`, 'warn');
            return;
        }
        // quorum reached — fall through to /tasks/complete
    } else {
        logActivity(
            `Task ${taskId.slice(0, 8)} — no-quorum mode ` +
            `(peers: ${this.p2pNode ? (this.p2pNode.getPeers() as any[]).length : 0}, ` +
            `identity: ${!!this.identity})`,
            'info'
        );
        // fall through to /tasks/complete without quorum gate
    }
}
const reported = await this.apiCall('/tasks/complete', completionPayload);
```

### 4. Stats

New field on `SwarmStats`:

```ts
quorumGateFailed: number;
```

Initialised to `0` in the constructor alongside existing quorum stats. Incremented in `processTask()` when quorum was available but not reached (see Step 3). Not incremented for degraded-mode (no-quorum) paths — those are expected, not failures.

`getStats()` already returns the full `this.stats` object — no change needed.

### 5. `/api/node/status` — `quorumSettlement` block

Current:
```ts
quorumSettlement: {
    submitted: stats?.quorumProofsSubmitted || 0,
    pending:   stats?.quorumProofsPending   || 0,
    attestations: stats?.quorumAttestationsTotal || 0,
},
```

Add `gateFailed`:
```ts
quorumSettlement: {
    submitted:    stats?.quorumProofsSubmitted     || 0,
    pending:      stats?.quorumProofsPending       || 0,
    attestations: stats?.quorumAttestationsTotal   || 0,
    gateFailed:   stats?.quorumGateFailed          || 0,
},
```

### 6. Dashboard

In the existing quorum settlement card (`web/dashboard.html`), add one row:

```html
<div class="row jb mb8"><span class="muted sm">Gate Failed</span><span class="fw6 tr" id="s-qp-failed">—</span></div>
```

In `loadSettings()`, add:
```js
set('s-qp-failed', d.swarm?.quorumSettlement?.gateFailed ?? '—');
```

---

## Testing

New tests in `src/swarm/agent.test.ts`:

**Test 1:** `canAttemptQuorum()` returns false when fewer than 2 peers → `processTask()` calls `/tasks/complete` without waiting for quorum (degraded mode).

**Test 2:** `canAttemptQuorum()` returns true, `attemptQuorumSettlement()` returns false (quorum not reached) → `/tasks/complete` is NOT called, `quorumGateFailed` increments.

**Test 3:** `canAttemptQuorum()` returns true, `attemptQuorumSettlement()` returns true (quorum reached) → `/tasks/complete` IS called.

---

## Non-goals

- No change to non-inference task types (embedding, classification, etc.) — gate only applies to `type === 'inference'`.
- No change to the external platform API contract — `/tasks/complete` payload is unchanged.
- No change to the quorum timeout (8 000 ms) — already set in `attemptQuorumSettlement`.
- No backfilling of historical tasks.
- No change to retry-queue behaviour for already-queued task reports.
- `gstd-bridge` and cross-chain concerns remain out of scope.

---

## Files touched

| File | Change |
|------|--------|
| `src/swarm/agent.ts` | `canAttemptQuorum()` method; `attemptQuorumSettlement()` return type; `processTask()` gate; `SwarmStats.quorumGateFailed` |
| `src/gateway/server.ts` | `quorumSettlement.gateFailed` in `/api/node/status` |
| `web/dashboard.html` | Gate Failed row + JS wiring |
| `src/swarm/agent.test.ts` | 3 new unit tests |
