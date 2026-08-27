# Decentralized Inference Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inference routing smarter (peer quality scoring) and add node keypair auth so P2P-facing routes can be called by other nodes without a dashboard PIN.

**Architecture:** PeerQuality state is tracked in-memory per peer inside PeerManager; `getBestPeer()` gains a consecutive-fail filter and a failure-rate penalty; Ed25519 public keys flow through heartbeats into PeerInfo; a new `requirePeerAuth()` middleware verifies those keys for the `/api/resources/request` route.

**Tech Stack:** TypeScript, `@ton/crypto` (already in package.json), Node.js `crypto` module.

**Spec:** `docs/superpowers/specs/2026-08-27-decentralized-inference-routing-design.md`

## Global Constraints

- No new external dependencies — `@ton/crypto` and `crypto` are already in `package.json`.
- No behavioral change to existing dashboard routes — `requireNodeAuth` stays on all dashboard-operator routes; only `POST /api/resources/request` is swapped.
- Single-node survivability: empty peer table must never crash or error — all new paths degrade to no-op with zero peers.
- `pubkeyHex` is optional everywhere — nodes without an identity file still participate in the mesh.
- Log when consecutive-fail filter excludes a peer: `[Peers] Excluding ${nodeId}: ${consecutiveFails} consecutive failures`.
- `npx vitest run` and `tsc --noEmit --skipLibCheck` must stay clean after every task.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/p2p/peers.ts` | Modify | `PeerInfo.pubkeyHex`, `PeerQuality` interface, `quality` Map, `recordOutcome()`, updated `getBestPeer()` filter + scoring, `registerPeer()` 6th param, new `getPeer()` method |
| `src/p2p/node.ts` | Modify | `HeartbeatSchema` gains `pubkeyHex`, `P2PHeartbeat` type auto-updates, `GstdP2PNode` gains `identity` field and `setIdentity()` setter; `broadcastHeartbeat()` and `sendHeartbeatTo()` include `pubkeyHex` |
| `src/p2p/identity.ts` | Modify | New `signPeerRequest()` export |
| `src/gateway/server.ts` | Modify | New `requirePeerAuth()` function, `OmegaGateway` gains `attestorIdentity` field and `setAttestorIdentity()` setter; `/api/resources/request` swapped from `requireNodeAuth` to `requirePeerAuth` |
| `src/index.ts` | Modify | Load identity at startup, pass to `p2pNode.setIdentity()` and `gateway.setAttestorIdentity()`; update both `heartbeat:received` bridges to pass `data.pubkeyHex` |
| `src/p2p/peers.test.ts` | Modify | Extend with 5 quality-scoring unit tests |
| `src/p2p/identity.test.ts` | Create | 5 sign/verify + requirePeerAuth round-trip tests |

---

### Task 1: PeerQuality tracking in PeerManager

**Files:**
- Modify: `src/p2p/peers.ts`

**Interfaces:**
- Produces: `PeerInfo.pubkeyHex?: string` (Task 2 reads this), `recordOutcome(nodeId: string, success: boolean): void` (Task 3 uses this indirectly), updated `getBestPeer()` with consecutive-fail filter and quality penalty

- [ ] **Step 1: Add `PeerQuality` interface and `quality` Map to `PeerManager`**

In `src/p2p/peers.ts`, add `pubkeyHex?: string` to `PeerInfo` (after `source: PeerSource`), and inside `PeerManager` class add the quality state:

```ts
// Add to PeerInfo interface (after `source: PeerSource`):
pubkeyHex?: string;

// Add inside PeerManager class body (after `private peers = new Map...` line):
interface PeerQuality {
    successes: number;
    failures: number;
    consecutiveFails: number;
}
private quality = new Map<string, PeerQuality>();
```

Note: declare `PeerQuality` as a private interface at top of class or as a module-level interface before the class. Module-level is cleaner — place it alongside `PeerInfo` and `HeartbeatPayload`.

- [ ] **Step 2: Add `recordOutcome()` method**

Add after `registerPeer()` (around line 222):

```ts
recordOutcome(nodeId: string, success: boolean): void {
    const q = this.quality.get(nodeId) ?? { successes: 0, failures: 0, consecutiveFails: 0 };
    if (success) {
        q.consecutiveFails = 0;
        q.successes++;
    } else {
        q.consecutiveFails++;
        q.failures++;
    }
    this.quality.set(nodeId, q);
}
```

- [ ] **Step 3: Update `getBestPeer()` — add consecutive-fail filter and quality penalty**

The current filter (line 240) is:
```ts
.filter(p => p.latencyMs < UNVERIFIED_LATENCY_MS);
```

Replace the `getBestPeer()` method body's filter + scoring block with:

```ts
const live = Array.from(this.peers.values())
    .filter(p => now - p.lastSeen < PEER_TTL_MS && p.url !== this.selfInfo.url)
    .filter(p => p.latencyMs < UNVERIFIED_LATENCY_MS)
    .filter(p => {
        const consec = this.quality.get(p.nodeId)?.consecutiveFails ?? 0;
        if (consec >= 3) {
            console.log(`[Peers] Excluding ${p.nodeId}: ${consec} consecutive failures`);
            return false;
        }
        return true;
    });

if (!live.length) return null;

const scored = live.map(p => {
    const modelNorm = model.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const hasModel = p.capabilities.some(c =>
        c.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(modelNorm) ||
        modelNorm.includes(c.replace(/[^a-z0-9]/gi, '').toLowerCase())
    );
    const q = this.quality.get(p.nodeId);
    const total = (q?.successes ?? 0) + (q?.failures ?? 0);
    const failRate = total >= 5 ? (q!.failures / total) : 0;
    const qualityPenalty = failRate > 0.3 ? 500 : 0;
    const score = (hasModel ? 1000 : 0)
        + Math.max(0, 2000 - p.latencyMs)
        + Math.min(p.uptime / 3600, 100)
        - qualityPenalty;
    return { peer: p, score };
});
```

- [ ] **Step 4: Wire `recordOutcome()` into `forwardToPeer()`**

Current `forwardToPeer()` throws on failure. Wrap the body in a try/catch and call `recordOutcome` on both paths:

```ts
async forwardToPeer(
    peer: PeerInfo,
    model: string,
    messages: any[],
    maxTokens: number,
    temperature: number
): Promise<{ content: string; model: string; tokens: number }> {
    const start = Date.now();
    try {
        const resp = await fetch(`${peer.url.replace(/\/$/, '')}/v1/ollama/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens, temperature }),
            signal: AbortSignal.timeout(90_000),
        });
        if (!resp.ok) throw new Error(`Peer ${peer.nodeId} returned ${resp.status}`);
        const data: any = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (!content) throw new Error('Empty response from peer');
        peer.latencyMs = Date.now() - start;
        peer.lastSeen = Date.now();
        this.recordOutcome(peer.nodeId, true);
        return {
            content,
            model: data.model || model,
            tokens: data.usage?.completion_tokens || 0,
        };
    } catch (e) {
        this.recordOutcome(peer.nodeId, false);
        throw e;
    }
}
```

- [ ] **Step 5: Type-check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot && git add src/p2p/peers.ts && git commit -m "feat(peers): add PeerQuality tracking — consecutive-fail filter and failure-rate penalty in getBestPeer"
```

---

### Task 2: pubkeyHex in heartbeats + GstdP2PNode.setIdentity()

**Files:**
- Modify: `src/p2p/node.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `PeerInfo.pubkeyHex?: string` (added in Task 1), `AttestorIdentity` from `src/p2p/identity.ts`
- Produces: `GstdP2PNode.setIdentity(identity: AttestorIdentity): void`, `heartbeat:received` events now carry `pubkeyHex?: string`, `PeerManager.registerPeer()` gains 6th optional `pubkeyHex?: string` param

- [ ] **Step 1: Add `pubkeyHex` to `HeartbeatSchema` in `node.ts`**

In `src/p2p/node.ts`, inside `HeartbeatSchema` (after the `httpUrl` field, before the closing `}`):

```ts
pubkeyHex: z.string().length(64).optional(), // 32-byte Ed25519 public key, hex
```

The `P2PHeartbeat` type is `z.infer<typeof HeartbeatSchema>`, so it automatically gets `pubkeyHex?: string`.

- [ ] **Step 2: Add `identity` field and `setIdentity()` to `GstdP2PNode`**

Find the `GstdP2PNode` class definition. Add imports at the top of `node.ts`:

```ts
import type { AttestorIdentity } from './identity.js';
```

Add a private field in the class body (near other private fields like `private node: any`):

```ts
private identity: AttestorIdentity | null = null;

setIdentity(identity: AttestorIdentity): void {
    this.identity = identity;
}
```

- [ ] **Step 3: Include `pubkeyHex` in both heartbeat builders**

In `broadcastHeartbeat()` (line ~476) and `sendHeartbeatTo()` (line ~506), the `hb: P2PHeartbeat` object is built with all fields. Add `pubkeyHex` to both:

```ts
// In both broadcastHeartbeat() and sendHeartbeatTo(), inside the hb object:
httpUrl: this.getPublicHttpUrl(),
pubkeyHex: this.identity?.pubkeyHex,
```

- [ ] **Step 4: Add 6th `pubkeyHex` param to `registerPeer()` and store it in `PeerInfo`**

In `src/p2p/peers.ts`, update `registerPeer()` signature and storage:

```ts
registerPeer(nodeId: string, url: string, capabilities: string[], source: PeerSource = 'http-gossip', touch: boolean = true, pubkeyHex?: string): void {
    if (nodeId === this.selfInfo.nodeId) return;
    const existing = this.peers.get(nodeId);
    this.peers.set(nodeId, {
        nodeId, url, capabilities,
        version:      existing?.version ?? '?',
        cpuCores:     existing?.cpuCores ?? 0,
        ramGb:        existing?.ramGb ?? 0,
        uptime:       existing?.uptime ?? 0,
        tasksHandled: existing?.tasksHandled ?? 0,
        lastSeen:     touch ? Date.now() : (existing?.lastSeen ?? 0),
        latencyMs:    existing?.latencyMs || UNVERIFIED_LATENCY_MS,
        source,
        pubkeyHex:    pubkeyHex ?? existing?.pubkeyHex,
    });
    this.saveToDisk();
}
```

Note: `pubkeyHex ?? existing?.pubkeyHex` preserves a previously-known key if a later heartbeat omits it (node without identity file).

- [ ] **Step 5: Update both `heartbeat:received` bridge listeners in `index.ts`**

There are two places in `src/index.ts` where `heartbeat:received` is handled: the main startup path (line ~454) and the retry-mesh path (line ~194). Update both from:

```ts
pm?.registerPeer(data.nodeId, data.httpUrl, data.capabilities || [], 'p2p-mesh', false);
```

To:

```ts
pm?.registerPeer(data.nodeId, data.httpUrl, data.capabilities || [], 'p2p-mesh', false, data.pubkeyHex);
```

- [ ] **Step 6: Type-check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /home/bot/gstdbot && git add src/p2p/node.ts src/p2p/peers.ts src/index.ts && git commit -m "feat(p2p): propagate Ed25519 pubkeyHex through heartbeats into PeerInfo"
```

---

### Task 3: requirePeerAuth + signPeerRequest + identity threading

**Files:**
- Modify: `src/p2p/identity.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/index.ts`
- Modify: `src/p2p/peers.ts`

**Interfaces:**
- Consumes: `PeerInfo.pubkeyHex?: string` (Task 1), `GstdP2PNode.setIdentity()` (Task 2), `PeerManager.registerPeer()` 6-param (Task 2)
- Produces:
  - `signPeerRequest(identity: AttestorIdentity, nodeId: string, timestamp?: number): Record<string, string>` in `identity.ts`
  - `getPeer(nodeId: string): PeerInfo | undefined` in `peers.ts`
  - `requirePeerAuth(req, res): Promise<boolean>` in `server.ts`
  - `GatewayServer.setAttestorIdentity(identity: AttestorIdentity): void` in `server.ts`
  - `loadOrCreateAttestorIdentity()` called at index.ts startup

- [ ] **Step 1: Add `signPeerRequest()` to `identity.ts`**

In `src/p2p/identity.ts`, add at the top of file (after existing imports):

```ts
import { createHash } from 'crypto';
```

Then add two exports after the existing `signWithIdentity()`:

```ts
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
```

- [ ] **Step 2: Add `getPeer()` to `PeerManager`**

In `src/p2p/peers.ts`, add alongside `getLivePeers()` / `getAllPeers()`:

```ts
getPeer(nodeId: string): PeerInfo | undefined {
    return this.peers.get(nodeId);
}
```

- [ ] **Step 3: Add `attestorIdentity` field and `setAttestorIdentity()` to `OmegaGateway`**

In `src/gateway/server.ts`, inside `OmegaGateway` class (near other private fields like `private peerManager`):

```ts
private attestorIdentity: AttestorIdentity | null = null;

setAttestorIdentity(identity: AttestorIdentity): void {
    this.attestorIdentity = identity;
}
```

Add the import at the top of `server.ts`:

```ts
import type { AttestorIdentity } from '../p2p/identity.js';
```

- [ ] **Step 4: Add `requirePeerAuth()` function in `server.ts`**

Add `requirePeerAuth()` immediately after `requireNodeAuth()` (around line 178). It needs access to `peerManager` and `attestorIdentity` — since it's used as a closure inside route handlers that have `this`, define it as a private method on `OmegaGateway`, or implement as a standalone function that accepts peerManager and identity as arguments. The cleanest approach given the existing pattern (requireNodeAuth is also a standalone function) is to make it an async function that takes them as params:

```ts
import { createHash } from 'crypto';
import { signVerify } from '@ton/crypto';
import { peerRequestMessage } from '../p2p/identity.js';

async function requirePeerAuth(req: any, res: any, peerManager: PeerManager | null, identity: AttestorIdentity | null): Promise<boolean> {
    const nodeId = req.headers['x-gstd-node-id'] as string | undefined;
    const tsStr  = req.headers['x-gstd-node-ts']  as string | undefined;
    const sigHex = req.headers['x-gstd-node-sig'] as string | undefined;

    if (!nodeId || !tsStr || !sigHex) {
        res.status(401).json({ error: 'Peer auth headers required: X-GSTD-Node-{Id,Ts,Sig}' });
        return false;
    }

    const timestamp = parseInt(tsStr, 10);
    if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) {
        res.status(401).json({ error: 'Timestamp out of range (replay protection, ±60s)' });
        return false;
    }

    const peer = peerManager?.getPeer(nodeId);
    if (!peer) {
        res.status(401).json({ error: 'Unknown peer node' });
        return false;
    }

    if (!peer.pubkeyHex) {
        res.status(401).json({ error: 'Peer has not announced its public key yet' });
        return false;
    }

    const msg    = peerRequestMessage(nodeId, timestamp);
    const pubkey = Buffer.from(peer.pubkeyHex, 'hex');
    const sig    = Buffer.from(sigHex, 'hex');
    const valid  = await signVerify(sig, msg, pubkey);
    if (!valid) {
        res.status(401).json({ error: 'Signature verification failed' });
        return false;
    }

    return true;
}
```

Note: `createHash` is already used in the file or can be imported from `'crypto'`. The `peerRequestMessage` import and `signVerify` import need to be added to the top of `server.ts`.

- [ ] **Step 5: Swap `/api/resources/request` from `requireNodeAuth` to `requirePeerAuth`**

Find (line ~2244):
```ts
this.app.post('/api/resources/request', async (req, res) => {
    if (!requireNodeAuth(req, res)) return;
```

Replace with:
```ts
this.app.post('/api/resources/request', async (req, res) => {
    if (!await requirePeerAuth(req, res, this.peerManager, this.attestorIdentity)) return;
```

- [ ] **Step 6: Load identity at startup in `index.ts` and thread it to node + gateway**

In `src/index.ts`, add import near the top (alongside other p2p imports):

```ts
import { loadOrCreateAttestorIdentity } from './p2p/identity.js';
```

At the very beginning of the `main()` function body (before the `loadConfig()` call or immediately after — whichever is clearest), add:

```ts
const identity = loadOrCreateAttestorIdentity();
```

Then, after `p2pNode` is created (line ~440) and before `p2pNode.start()` (line ~448), call:

```ts
p2pNode.setIdentity(identity);
```

After `gateway` is initialized (it's created very early, near line 210 based on code structure — check the actual line), call:

```ts
gateway.setAttestorIdentity(identity);
```

Also do the same in `retryMeshInBackground()` — but `retryMeshInBackground()` creates no p2pNode or gateway; it only starts the already-created node, so no change needed there. The identity is set on `p2pNode` before `retryMeshInBackground` is called, so heartbeats from retried starts will also include `pubkeyHex`.

Add a startup log so the operator can confirm identity loaded:

```ts
console.log(`    ✓ Attestor identity loaded (pubkey: ${identity.pubkeyHex.slice(0, 16)}...)`);
```

Place this right after `const identity = loadOrCreateAttestorIdentity();`.

- [ ] **Step 7: Type-check**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /home/bot/gstdbot && git add src/p2p/identity.ts src/p2p/peers.ts src/gateway/server.ts src/index.ts && git commit -m "feat(auth): add requirePeerAuth and signPeerRequest — peer Ed25519 auth for /api/resources/request"
```

---

### Task 4: Tests

**Files:**
- Modify: `src/p2p/peers.test.ts`
- Create: `src/p2p/identity.test.ts`

**Interfaces:**
- Consumes: `PeerManager.recordOutcome()`, `PeerManager.getBestPeer()` (Task 1); `signPeerRequest()`, `peerRequestMessage()` (Task 3); `requirePeerAuth` verification logic (Task 3)

- [ ] **Step 1: Write failing quality-scoring tests (add to `peers.test.ts`)**

Append a new `describe` block at the end of `src/p2p/peers.test.ts`:

```ts
describe('PeerManager quality scoring', () => {
    let pm: PeerManager;

    beforeEach(() => {
        rmSync(PEERS_FILE, { force: true });
        pm = new PeerManager({
            nodeId: 'self-node',
            url: 'https://self.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 0,
            tasksHandled: 0,
            source: 'http-gossip',
        });
        // Seed a peer with a verified latency so getBestPeer() considers it
        pm.registerPeer('peer-q', 'https://peer-q.example.com', ['llama3.2:3b']);
        // Simulate a successful ping to get latencyMs below UNVERIFIED_LATENCY_MS
        const peer = pm.getAllPeers().find(p => p.nodeId === 'peer-q')!;
        peer.latencyMs = 100;
    });

    it('fresh peer (< 5 attempts) is not penalized regardless of failures', () => {
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best?.nodeId).toBe('peer-q'); // still selected — too few attempts to penalize
    });

    it('peer with 5+ attempts and >30% failure rate gets quality penalty but stays selectable', () => {
        // 3 failures + 2 successes = 60% failure rate → -500 penalty
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', true);
        pm.recordOutcome('peer-q', true);
        // Add a second peer with no quality history to confirm penalized peer loses in head-to-head
        pm.registerPeer('peer-r', 'https://peer-r.example.com', ['llama3.2:3b']);
        const peerR = pm.getAllPeers().find(p => p.nodeId === 'peer-r')!;
        peerR.latencyMs = 100; // same latency, so quality penalty is the deciding factor
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best?.nodeId).toBe('peer-r'); // unpenalized peer wins
    });

    it('peer with 3 consecutive failures is excluded from getBestPeer results', () => {
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best).toBeNull();
    });

    it('successful response resets consecutiveFails to 0 and allows re-selection', () => {
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        expect(pm.getBestPeer('llama3.2:3b')).toBeNull();
        pm.recordOutcome('peer-q', true); // recovers
        expect(pm.getBestPeer('llama3.2:3b')?.nodeId).toBe('peer-q');
    });

    it('quality state is per-nodeId and does not affect other peers', () => {
        pm.registerPeer('peer-s', 'https://peer-s.example.com', ['llama3.2:3b']);
        const peerS = pm.getAllPeers().find(p => p.nodeId === 'peer-s')!;
        peerS.latencyMs = 100;
        // Poison peer-q, peer-s should be unaffected
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best?.nodeId).toBe('peer-s');
    });
});
```

- [ ] **Step 2: Run the new tests to verify they fail (before implementation is already done in Task 1)**

```bash
cd /home/bot/gstdbot && npx vitest run src/p2p/peers.test.ts 2>&1 | tail -20
```

Expected: Tests should PASS since Task 1 already implemented the logic. If they fail, the implementation has a bug — fix it before proceeding.

- [ ] **Step 3: Write failing identity tests — create `src/p2p/identity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { signVerify } from '@ton/crypto';
import { loadOrCreateAttestorIdentity, signWithIdentity } from './identity.js';
import { signPeerRequest, peerRequestMessage } from './identity.js';

describe('signPeerRequest', () => {
    const identity = loadOrCreateAttestorIdentity();
    const nodeId = 'test-node-abc123';

    it('produces three correctly-named headers', () => {
        const headers = signPeerRequest(identity, nodeId);
        expect(headers).toHaveProperty('X-GSTD-Node-Id');
        expect(headers).toHaveProperty('X-GSTD-Node-Ts');
        expect(headers).toHaveProperty('X-GSTD-Node-Sig');
    });

    it('signature verifies correctly with signVerify against peerRequestMessage hash', async () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);
        const msg    = peerRequestMessage(nodeId, timestamp);
        const pubkey = Buffer.from(identity.pubkeyHex, 'hex');
        const sig    = Buffer.from(headers['X-GSTD-Node-Sig'], 'hex');
        const valid  = await signVerify(sig, msg, pubkey);
        expect(valid).toBe(true);
    });

    it('stale timestamp (>60s old) should be detected as out-of-range', () => {
        const staleTs = Date.now() - 70_000; // 70 seconds ago
        const drift = Math.abs(Date.now() - staleTs);
        expect(drift).toBeGreaterThan(60_000);
    });

    it('wrong nodeId in message produces an invalid signature', async () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);
        // Verify against a different nodeId's message hash
        const wrongMsg = peerRequestMessage('different-node-id', timestamp);
        const pubkey   = Buffer.from(identity.pubkeyHex, 'hex');
        const sig      = Buffer.from(headers['X-GSTD-Node-Sig'], 'hex');
        const valid    = await signVerify(sig, wrongMsg, pubkey);
        expect(valid).toBe(false);
    });

    it('round-trip: signPeerRequest headers pass requirePeerAuth-equivalent verification', async () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);

        // Replicate the verification logic from requirePeerAuth
        const tsFromHeader = parseInt(headers['X-GSTD-Node-Ts'], 10);
        expect(Math.abs(Date.now() - tsFromHeader)).toBeLessThan(60_000);

        const msg    = peerRequestMessage(headers['X-GSTD-Node-Id'], tsFromHeader);
        const pubkey = Buffer.from(identity.pubkeyHex, 'hex');
        const sig    = Buffer.from(headers['X-GSTD-Node-Sig'], 'hex');
        const valid  = await signVerify(sig, msg, pubkey);
        expect(valid).toBe(true);
    });
});
```

- [ ] **Step 4: Run identity tests**

```bash
cd /home/bot/gstdbot && npx vitest run src/p2p/identity.test.ts 2>&1 | tail -20
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /home/bot/gstdbot && npx vitest run 2>&1 | tail -20
```

Expected: All tests pass, no failures.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot && git add src/p2p/peers.test.ts src/p2p/identity.test.ts && git commit -m "test(p2p): quality scoring unit tests + signPeerRequest round-trip tests"
```

---

### Task 5: Live verification

**Files:** None — verification only.

- [ ] **Step 1: TypeScript clean**

```bash
cd /home/bot/gstdbot && npx tsc --noEmit --skipLibCheck 2>&1
```

Expected: No output (zero errors).

- [ ] **Step 2: Full test suite clean**

```bash
cd /home/bot/gstdbot && npx vitest run 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 3: Restart live node via pm2**

```bash
pm2 restart gstdbot
```

- [ ] **Step 4: Check pm2 log for identity startup line**

```bash
pm2 logs gstdbot --lines 40 --nostream 2>&1 | grep -i "attestor\|identity\|pubkey"
```

Expected output should include something like:
```
    ✓ Attestor identity loaded (pubkey: <16 hex chars>...)
```

- [ ] **Step 5: Confirm `POST /api/resources/request` now returns 401 without peer-auth headers**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/api/resources/request -H "Content-Type: application/json" -d '{}'
```

Expected: `401`

Old behavior (pre-task) was: `401` when no dashboard token was provided (requireNodeAuth). New behavior is still `401` but for a different reason (missing peer-auth headers). If the node happens to have a valid session token in the test, both would have returned different errors — but a bare request with no auth headers will be 401 in both cases. To confirm it's the NEW middleware running, check the error body:

```bash
curl -s -X POST http://localhost:8080/api/resources/request -H "Content-Type: application/json" -d '{}' | python3 -m json.tool
```

Expected: `{"error": "Peer auth headers required: X-GSTD-Node-{Id,Ts,Sig}"}` (not the old "Authentication required — log in via the dashboard PIN first")

- [ ] **Step 6: Final commit if any fixes were needed during live verification**

```bash
cd /home/bot/gstdbot && git add -p && git commit -m "fix: live verification corrections"
```

(Only if fixes were needed. If all clean, skip this step.)
