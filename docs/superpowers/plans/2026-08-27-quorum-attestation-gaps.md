# Quorum Attestation Gaps — Implementation Plan (Sub-project D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four bugs in the existing quorum attestation path so `attemptQuorumSettlement` / `participateInQuorumVerification` work correctly end-to-end.

**Architecture:** Add `identity` and `peerManager` setters to `SwarmAgent` so the quorum functions use startup-loaded state instead of calling `loadOrCreateAttestorIdentity()` on every invocation. Fix the `task_id` → `task.id` field name mismatch in `participateInQuorumVerification`, wire quality feedback from quorum outcomes into `PeerManager.recordOutcome()`, extend `SwarmStats` with three quorum counters, and surface them in the status endpoint and dashboard.

**Tech Stack:** TypeScript, Vitest, Node.js 20; `@ton/core`, `@ton/crypto` (already in package.json)

**Spec:** `docs/superpowers/specs/2026-08-27-quorum-attestation-gaps-design.md`

## Global Constraints

- No new external dependencies — `@ton/core`, `@ton/crypto`, `crypto` already in `package.json`.
- No behavioral change to the task-completion path — quorum remains fire-and-forget, never blocks `/tasks/complete`.
- Single-node survivability: all paths degrade to no-op with `identity = null` or `peerManager = null` or zero peers.
- `npx vitest run` and `npx tsc --noEmit --skipLibCheck` must stay clean after every task.
- Static imports replacing dynamic imports must not introduce circular dependencies (none exist between `attestation.ts`, `quorum-coordinator.ts`, `@ton/core` and `agent.ts`).

---

## File Map

| File | Change |
|------|--------|
| `src/swarm/agent.ts` | Tasks 1, 2, 3 — static imports, new fields/setters, normalization fix, recordOutcome, stats |
| `src/index.ts` | Task 1 — wire `setIdentity()` and `setPeerManager()` after swarm created |
| `src/gateway/server.ts` | Task 4 — add `quorumSettlement` block to `/api/v1/status` swarm response |
| `web/dashboard.html` | Task 4 — add 3 rows to Node Information card + JS wiring |
| `src/swarm/agent.test.ts` | Task 5 — new: 4 unit tests for the 4 fixes |

---

### Task 1: Static imports + identity/peerManager threading

**Files:**
- Modify: `src/swarm/agent.ts` (lines 1–22, 80–119, 672–689, 861–875)
- Modify: `src/index.ts` (lines 285–287)

**Interfaces:**
- Produces: `SwarmAgent.setIdentity(identity: AttestorIdentity): void` — called by Task 1's index.ts wiring; consumed by Task 2's guard checks and Task 5's tests.
- Produces: `SwarmAgent.setPeerManager(pm: PeerManager): void` — consumed by Task 2's `recordOutcome` call and Task 5's tests.

- [ ] **Step 1: Add static imports at the top of `src/swarm/agent.ts`**

The current imports end at line 22 (`import { CrossChainBridge } from '../blockchain/bridge.js'`). Add these five lines immediately after:

```ts
import type { AttestorIdentity } from '../p2p/identity.js';
import type { PeerManager } from '../p2p/peers.js';
import { hashResult, signAttestation, taskIdToUint64 } from '../p2p/attestation.js';
import { awaitQuorum } from '../p2p/quorum-coordinator.js';
import { Address } from '@ton/core';
```

- [ ] **Step 2: Add two private fields to `SwarmAgent` class**

The class fields block ends at line 93 (`private trainingCapable = false;`). Add two new fields immediately after:

```ts
private identity: AttestorIdentity | null = null;
private peerManager: PeerManager | null = null;
```

- [ ] **Step 3: Add two public setters to `SwarmAgent`**

The existing `setP2PNode(node: any): void` method starts at line 122. Add these two setters immediately before `setP2PNode`:

```ts
setIdentity(identity: AttestorIdentity): void { this.identity = identity; }
setPeerManager(pm: PeerManager): void { this.peerManager = pm; }
```

- [ ] **Step 4: Replace dynamic imports in `attemptQuorumSettlement`**

Find these 5 lines in `attemptQuorumSettlement` (currently around lines 684–689):

```ts
        const { loadOrCreateAttestorIdentity } = await import('../p2p/identity.js');
        const { hashResult, signAttestation, taskIdToUint64 } = await import('../p2p/attestation.js');
        const { awaitQuorum } = await import('../p2p/quorum-coordinator.js');
        const { Address } = await import('@ton/core');

        const identity = loadOrCreateAttestorIdentity();
```

Replace them with (two lines):

```ts
        if (!this.identity) return;
        const identity = this.identity;
```

- [ ] **Step 5: Replace dynamic imports in `participateInQuorumVerification`**

Find these 5 lines in `participateInQuorumVerification` (currently around lines 869–874, inside the `try` block):

```ts
            const { loadOrCreateAttestorIdentity } = await import('../p2p/identity.js');
            const { hashResult, signAttestation, taskIdToUint64 } = await import('../p2p/attestation.js');
            const { awaitQuorum } = await import('../p2p/quorum-coordinator.js');
            const { Address } = await import('@ton/core');

            const identity = loadOrCreateAttestorIdentity();
```

Replace them with (two lines, at the same indentation level as the `try` block contents):

```ts
            if (!this.identity) return;
            const identity = this.identity;
```

- [ ] **Step 6: Wire setIdentity and setPeerManager in `src/index.ts`**

Find the three lines that create and start the swarm (around lines 285–286):

```ts
        swarm = new SwarmAgent(config, wallet, memory);
        await swarm.start();
```

Add two lines immediately after `swarm.start()`:

```ts
        swarm = new SwarmAgent(config, wallet, memory);
        await swarm.start();
        if (swarm) swarm.setIdentity(identity);
        if (swarm) swarm.setPeerManager(gateway.getPeerManager());
```

`identity` is already declared at line 213 of `index.ts`. `gateway` is already started at line 246. Both are in scope here.

- [ ] **Step 7: Run type check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck
```

Expected: zero errors. If you see "cannot find module" or "has no exported member" errors, verify the import paths in step 1 match the actual file locations.

- [ ] **Step 8: Commit**

```bash
git add src/swarm/agent.ts src/index.ts
git commit -m "refactor: static imports + identity/peerManager threading in SwarmAgent"
```

---

### Task 2: task.id normalization + quality-score feedback

**Files:**
- Modify: `src/swarm/agent.ts` (`participateInQuorumVerification` start, `attemptQuorumSettlement` after `awaitQuorum` call)

**Interfaces:**
- Consumes: `this.peerManager` field from Task 1; `PeerManager.recordOutcome(nodeId: string, success: boolean): void` (added in sub-project C).
- Consumes: `this.identity` guard from Task 1 (normalization runs before it; recordOutcome after awaitQuorum).

- [ ] **Step 1: Add task.id normalization to `participateInQuorumVerification`**

Find the start of `participateInQuorumVerification` (which now begins with `if (!this.p2pNode) return;` after Task 1). Add the normalization as the very first two lines of the function body, before the `if (!this.p2pNode)` guard:

```ts
    private async participateInQuorumVerification(task: SwarmTask, coExecutors: string[], quorumThreshold: number): Promise<void> {
        if (!(task as any).id && (task as any).task_id) {
            (task as any).id = (task as any).task_id;
        }
        if (!this.p2pNode) return;
```

The normalization must come first (before any `return`) so the task is fixed up even in single-node mode, matching the ordering in `processTask()` at line 913.

- [ ] **Step 2: Add recordOutcome loop in `attemptQuorumSettlement`**

Find the `const quorumResult = await awaitQuorum(...)` call in `attemptQuorumSettlement`. Immediately after it (before `if (!quorumResult.accepted)`), add the recordOutcome loop:

```ts
        const quorumResult = await awaitQuorum(this.p2pNode, {
            // ... existing args unchanged ...
        });

        for (const coExecutorId of coExecutors) {
            this.peerManager?.recordOutcome(coExecutorId, quorumResult.accepted);
        }

        if (!quorumResult.accepted) {
```

The `?.` makes this a no-op if `peerManager` is null (single-node mode). The loop runs before the early-return `if (!quorumResult.accepted)` so it fires on both accepted and rejected outcomes.

- [ ] **Step 3: Run type check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/swarm/agent.ts
git commit -m "fix: task.id normalization + recordOutcome feedback in quorum path"
```

---

### Task 3: Quorum stats tracking

**Files:**
- Modify: `src/swarm/agent.ts` (`SwarmStats` interface, stats initializer, `attemptQuorumSettlement`, `getStats`)

**Interfaces:**
- Produces: `SwarmStats.quorumProofsSubmitted: number`, `SwarmStats.quorumProofsPending: number`, `SwarmStats.quorumAttestationsTotal: number` — consumed by Task 4 (server.ts reads via `agent.getStats()`).

- [ ] **Step 1: Extend `SwarmStats` interface**

Find the `export interface SwarmStats` block (lines 40–60). Add three fields at the end of the interface, before the closing `}`:

```ts
    // Quorum attestation
    quorumProofsSubmitted: number;
    quorumProofsPending: number;
    quorumAttestationsTotal: number;
```

- [ ] **Step 2: Initialize the three fields in the constructor**

Find the `this.stats = { ... }` object in the constructor (around line 99). Add three fields at the end, before the closing `};`:

```ts
            tasksByType: {},
            quorumProofsSubmitted: 0,
            quorumProofsPending: 0,
            quorumAttestationsTotal: 0,
```

- [ ] **Step 3: Increment stats in `attemptQuorumSettlement`**

Find the `const settlementPayload = { ... };` line in `attemptQuorumSettlement` (after the `if (!quorumResult.accepted)` block). Add two stat increments immediately before the `apiCall`, so they run on BOTH the submitted and queued-locally paths:

```ts
        const settlementPayload = {
            taskId,
            workerAddr,
            resultHash: resultHashHex,
            attestations: quorumResult.attestations,
            computeUnits: 1,
        };
        this.stats.quorumProofsSubmitted++;
        this.stats.quorumAttestationsTotal += quorumResult.attestations.length;
        const submitted = await this.apiCall('/settlement/quorum-proof', settlementPayload);
```

- [ ] **Step 4: Override `getStats()` to compute `quorumProofsPending` dynamically**

Find the current `getStats()` method (lines 241–244):

```ts
    getStats(): SwarmStats {
        this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        return { ...this.stats };
    }
```

Replace it with:

```ts
    getStats(): SwarmStats {
        this.stats.uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);
        this.stats.quorumProofsPending = this.loadPendingSettlements().length;
        return { ...this.stats };
    }
```

`loadPendingSettlements()` already wraps filesystem access in try/catch and returns `[]` on any error, so this never throws.

- [ ] **Step 5: Run type check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/swarm/agent.ts
git commit -m "feat: quorum stats — proofs submitted, pending, attestations total"
```

---

### Task 4: Status endpoint + dashboard

**Files:**
- Modify: `src/gateway/server.ts` (the swarm IIFE block, ~line 1583)
- Modify: `web/dashboard.html` (Node Information card HTML ~line 792; `loadSettings()` JS ~line 1698)

**Interfaces:**
- Consumes: `SwarmStats.quorumProofsSubmitted`, `quorumProofsPending`, `quorumAttestationsTotal` from Task 3 (via `agent.getStats()`).

- [ ] **Step 1: Add quorumSettlement to the status endpoint swarm block**

Find the swarm IIFE in `server.ts` (the `swarm: (() => { ... })()` block around lines 1567–1584). Inside the returned object, add the `quorumSettlement` field immediately before the closing `};` of the inner return:

Current end of the swarm block:
```ts
                        rank: stats?.rank || 0,
                    };
                })(),
```

Change to:
```ts
                        rank: stats?.rank || 0,
                        quorumSettlement: {
                            submitted:    stats?.quorumProofsSubmitted || 0,
                            pending:      stats?.quorumProofsPending || 0,
                            attestations: stats?.quorumAttestationsTotal || 0,
                        },
                    };
                })(),
```

- [ ] **Step 2: Add three rows to the Node Information card HTML**

Find line 792 in `web/dashboard.html`:

```html
        <div class="row jb"><span class="muted sm">Central Server</span><span class="badge badge-muted" id="s-central-badge">Loading...</span></div>
```

Change it to add `mb8` to the Central Server row (so spacing is consistent) and append three new rows after it:

```html
        <div class="row jb mb8"><span class="muted sm">Central Server</span><span class="badge badge-muted" id="s-central-badge">Loading...</span></div>
        <div class="row jb mb8"><span class="muted sm">Quorum Proofs</span><span class="fw6" id="s-qp-submitted">—</span></div>
        <div class="row jb mb8"><span class="muted sm">Pending Settlement</span><span class="fw6" id="s-qp-pending">—</span></div>
        <div class="row jb"><span class="muted sm">Attestations</span><span class="fw6" id="s-qp-attest">—</span></div>
```

The last row has no `mb8` (matches the pattern of the other final rows in sibling cards).

- [ ] **Step 3: Wire the three fields in `loadSettings()` JS**

Find the success branch of `loadSettings()` (around line 1690). It currently ends with:

```js
      set('s-arch',d.node?.arch||'—');
      set('s-curver','v'+(d.node?.version||'—'));
      const cb=document.getElementById('s-central-badge');
```

Add three `set()` calls after `set('s-curver', ...)` and before the `const cb=` line:

```js
      set('s-arch',d.node?.arch||'—');
      set('s-curver','v'+(d.node?.version||'—'));
      set('s-qp-submitted', d.swarm?.quorumSettlement?.submitted ?? '—');
      set('s-qp-pending',   d.swarm?.quorumSettlement?.pending   ?? '—');
      set('s-qp-attest',    d.swarm?.quorumSettlement?.attestations ?? '—');
      const cb=document.getElementById('s-central-badge');
```

- [ ] **Step 4: Run type check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/gateway/server.ts web/dashboard.html
git commit -m "feat: quorum settlement stats in status endpoint + dashboard"
```

---

### Task 5: Tests + live verification

**Files:**
- Create: `src/swarm/agent.test.ts`

**Interfaces:**
- Consumes: `SwarmAgent`, `setIdentity()`, `setPeerManager()` from Task 1; `participateInQuorumVerification`, `attemptQuorumSettlement` (private — accessed via `(agent as any)`); `getStats()` from Task 3.

- [ ] **Step 1: Create `src/swarm/agent.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SwarmAgent } from './agent.js';
import type { AttestorIdentity } from '../p2p/identity.js';

vi.mock('../gateway/server.js', () => ({ logActivity: vi.fn() }));
vi.mock('../lib/platform-health.js', () => ({ platformHealth: { getStatus: vi.fn() } }));
vi.mock('../blockchain/bridge.js', () => ({ CrossChainBridge: class {} }));

vi.mock('../p2p/attestation.js', () => ({
    hashResult: vi.fn().mockReturnValue(0n),
    signAttestation: vi.fn().mockReturnValue({ pubkeyHex: 'a'.repeat(64), signatureHex: 'b'.repeat(128) }),
    taskIdToUint64: vi.fn().mockReturnValue(0n),
    buildAttestationsChain: vi.fn(),
    verifyAttestationLocally: vi.fn(),
}));

vi.mock('../p2p/quorum-coordinator.js', () => ({
    awaitQuorum: vi.fn().mockResolvedValue({ accepted: false, attestations: [], reason: 'no quorum' }),
}));

vi.mock('@ton/core', () => ({
    Address: { parse: vi.fn().mockReturnValue({}) },
    beginCell: vi.fn(),
}));

const mockConfig = {
    nodeId: 'test-node-id',
    version: '1.0.0',
    nodeName: 'test',
    swarm: { enabled: true, maxCPU: 80, maxRAM: 80, apiUrl: 'http://test' },
    models: { available: [], ollamaUrl: '' },
    port: 8080,
    apiPort: 3000,
    publicUrl: '',
} as any;

const mockWallet = {
    getAddress: () => 'EQtest123',
    recordVerifiedEarning: vi.fn(),
} as any;

const mockMemory = {
    getEntryCount: () => 0,
    store: vi.fn(),
    retrieve: vi.fn(),
} as any;

const mockIdentity: AttestorIdentity = {
    keyPair: { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) } as any,
    pubkeyHex: '00'.repeat(32),
};

const baseTask = {
    id: 'task-abc',
    type: 'inference',
    model: 'llama3',
    prompt: 'hello',
    payload: {},
    reward_gstd: 1,
    requester: 'peer1',
    priority: 1,
};

describe('SwarmAgent quorum attestation gaps', () => {

    describe('task.id normalization in participateInQuorumVerification', () => {
        it('sets task.id from task.task_id when id is absent', async () => {
            const agent = new SwarmAgent(mockConfig, mockWallet, mockMemory);
            // Do NOT call setIdentity — function returns early after normalization
            const task: any = {
                task_id: 'peer-task-123',
                type: 'inference',
                model: 'llama3',
                prompt: 'hi',
                payload: {},
                reward_gstd: 0,
                requester: 'peer1',
                priority: 1,
            };
            await (agent as any).participateInQuorumVerification(task, [], 2);
            // Normalization ran before identity guard fired
            expect(task.id).toBe('peer-task-123');
        });
    });

    describe('setIdentity guard in attemptQuorumSettlement', () => {
        it('returns without calling hashResult when identity is not set', async () => {
            const agent = new SwarmAgent(mockConfig, mockWallet, mockMemory);
            // Do NOT call setIdentity
            const { hashResult } = await import('../p2p/attestation.js');
            await (agent as any).attemptQuorumSettlement(baseTask, 'task-abc', { output: 'test' });
            expect(hashResult).not.toHaveBeenCalled();
        });
    });

    describe('with identity + peerManager + mocked quorum', () => {
        let agent: SwarmAgent;
        const mockPm = { recordOutcome: vi.fn() } as any;

        const mockP2PNode = {
            getPeers: () => [{ nodeId: 'peer1' }, { nodeId: 'peer2' }],
            sendTask: vi.fn().mockResolvedValue(undefined),
        };

        beforeEach(async () => {
            vi.clearAllMocks();
            agent = new SwarmAgent(mockConfig, mockWallet, mockMemory);
            agent.setIdentity(mockIdentity);
            agent.setPeerManager(mockPm);
            (agent as any).p2pNode = mockP2PNode;
            vi.spyOn(agent as any, 'apiCall').mockResolvedValue({ ok: true });
        });

        it('calls recordOutcome for each co-executor after quorum accepted', async () => {
            const { awaitQuorum } = await import('../p2p/quorum-coordinator.js');
            vi.mocked(awaitQuorum).mockResolvedValueOnce({
                accepted: true,
                attestations: ['att1', 'att2'],
                reason: '',
            });

            await (agent as any).attemptQuorumSettlement(baseTask, 'task-abc', { output: 'test' });

            expect(mockPm.recordOutcome).toHaveBeenCalledTimes(2);
            expect(mockPm.recordOutcome).toHaveBeenCalledWith('peer1', true);
            expect(mockPm.recordOutcome).toHaveBeenCalledWith('peer2', true);
        });

        it('increments quorumProofsSubmitted and quorumAttestationsTotal on successful quorum', async () => {
            const { awaitQuorum } = await import('../p2p/quorum-coordinator.js');
            vi.mocked(awaitQuorum).mockResolvedValueOnce({
                accepted: true,
                attestations: ['att1', 'att2', 'att3'],
                reason: '',
            });

            await (agent as any).attemptQuorumSettlement(baseTask, 'task-abc', { output: 'test' });

            const stats = agent.getStats();
            expect(stats.quorumProofsSubmitted).toBe(1);
            expect(stats.quorumAttestationsTotal).toBe(3);
        });
    });

});
```

- [ ] **Step 2: Run the new tests**

```bash
cd /home/bot/gstdbot && npx vitest run src/swarm/agent.test.ts
```

Expected: 4 tests pass. If a test fails due to missing mock, look at the error message — it will tell you which import needs to be mocked.

- [ ] **Step 3: Run the full test suite (no regressions)**

```bash
cd /home/bot/gstdbot && npx vitest run
```

Expected: all existing tests still pass.

- [ ] **Step 4: TypeScript clean**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck
```

Expected: zero errors.

- [ ] **Step 5: Restart the live node**

```bash
pm2 restart gstdbot && pm2 logs gstdbot --lines 30 --nostream
```

Expected output to include `✓ Attestor identity loaded (pubkey: ...)`. If it panics on import errors (e.g. circular dependency), the static imports in Task 1 need to be revisited.

- [ ] **Step 6: Verify quorumSettlement in status response**

```bash
curl -s http://localhost:8080/api/v1/status | python3 -m json.tool | grep -A5 quorumSettlement
```

Expected output:
```json
"quorumSettlement": {
    "submitted": 0,
    "pending": 0,
    "attestations": 0
},
```

- [ ] **Step 7: Verify dashboard renders the new rows**

Open `http://localhost:8080` → Settings tab → Node Information card. Confirm three new rows appear: "Quorum Proofs", "Pending Settlement", "Attestations" — all showing `0` for a fresh node.

- [ ] **Step 8: Commit**

```bash
git add src/swarm/agent.test.ts
git commit -m "test: agent.test.ts — 4 unit tests for quorum attestation gap fixes"
```
