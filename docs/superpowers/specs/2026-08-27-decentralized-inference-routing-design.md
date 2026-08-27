# Decentralized Inference Routing — Design Spec (Sub-project C)

**Date:** 2026-08-27
**Status:** Approved for implementation

## Goal

Make inference routing between GSTD nodes smarter and self-sufficient without any central server:

1. **Quality scoring** — `getBestPeer()` currently selects on latency + uptime but has no feedback on response quality. A fast peer serving garbage wins over a slower peer with good responses. Fix: track per-peer success/failure outcomes locally and factor into scoring.

2. **Peer-to-peer auth** — Routes meant to be called by other nodes (e.g. `POST /api/resources/request`) are currently gated behind the dashboard operator's PIN (`requireNodeAuth`), which peer nodes cannot have. Fix: a `requirePeerAuth()` middleware that verifies the caller is a known, signed peer using the existing Ed25519 attestor identity.

## Architecture

### What already exists (do not rebuild)

- `src/p2p/peers.ts` — `PeerManager` with `getBestPeer()` / `forwardToPeer()`, latency-based scoring, `PeerInfo.source` tracking, UNVERIFIED_LATENCY_MS gate. `forwardToPeer()` is the only outgoing inference call site.
- `src/p2p/identity.ts` — `AttestorIdentity` (Ed25519 keypair, auto-generated on first run, persisted to `~/.config/gstdbot/attestor-identity.json`). Currently loaded lazily in `swarm/agent.ts` only.
- `src/p2p/node.ts` — libp2p heartbeat protocol already carries `httpUrl` (sub-project B). `pubkeyHex` follows the same pattern.
- `src/gateway/server.ts` — `requireNodeAuth()` middleware (dashboard-PIN-based). `requirePeerAuth()` is added alongside it, not replacing it for dashboard routes.
- `src/index.ts` — P2P bridge wiring (the `heartbeat:received` listener that calls `peerManager.registerPeer()`).

### New components

**`PeerQuality` — in-memory quality state (added to `PeerManager`):**
```ts
interface PeerQuality {
    successes: number;
    failures: number;
    consecutiveFails: number;
}
private quality = new Map<string, PeerQuality>();
```
Not persisted — resets on restart. A fresh peer starts unscored (not penalized).

**`recordOutcome(nodeId, success)` — called by `forwardToPeer()` after each attempt:**
- On success: `consecutiveFails = 0`, `successes++`
- On failure: `consecutiveFails++`, `failures++`

**Updated `getBestPeer()` scoring:**

Current formula (lines 251–253):
```ts
const score = (hasModel ? 1000 : 0)
    + Math.max(0, 2000 - p.latencyMs)
    + Math.min(p.uptime / 3600, 100);
```

New formula adds a quality factor:
```ts
const q = this.quality.get(p.nodeId);
const total = (q?.successes ?? 0) + (q?.failures ?? 0);
const failRate = total >= 5 ? (q!.failures / total) : 0; // unscored = neutral
const qualityPenalty = failRate > 0.3 ? 500 : 0;

const score = (hasModel ? 1000 : 0)
    + Math.max(0, 2000 - p.latencyMs)
    + Math.min(p.uptime / 3600, 100)
    - qualityPenalty;
```

New filter before scoring (alongside the UNVERIFIED_LATENCY_MS filter):
```ts
.filter(p => (this.quality.get(p.nodeId)?.consecutiveFails ?? 0) < 3)
```

Thresholds rationale:
- **5 attempts** before penalizing: avoids punishing a peer on its first failure (transient errors happen).
- **30% failure rate**: a peer failing 1-in-3 requests is reliably bad; below that, normal noise.
- **3 consecutive fails**: a peer that has failed 3 in a row is currently down; exclude it until it succeeds once.
- **500 point penalty**: large enough to always lose to a latency-equal unpenalized peer (whose latency bonus is ≤ 2000), but not negative (keeps it sortable).

**`pubkeyHex` in heartbeats:**

`HeartbeatSchema` (in `node.ts`) gains:
```ts
pubkeyHex: z.string().length(64).optional(), // 32-byte Ed25519 public key, hex
```

Both `broadcastHeartbeat()` and `sendHeartbeatTo()` include `pubkeyHex: this.identity?.pubkeyHex`. `GstdP2PNode` gets a `setIdentity(identity: AttestorIdentity): void` setter — the identity is optional (node still functions without it, just doesn't announce a pubkey).

`PeerInfo` gains:
```ts
pubkeyHex?: string;
```

The bridge in `index.ts` is updated:
```ts
p2pNode.on('heartbeat:received', (data: any) => {
    if (!data.httpUrl) return;
    const pm = gateway?.getPeerManager?.() ?? null;
    pm?.registerPeer(data.nodeId, data.httpUrl, data.capabilities || [], 'p2p-mesh', false, data.pubkeyHex);
});
```

`registerPeer()` gains a 6th optional parameter `pubkeyHex?: string` and stores it in `PeerInfo`.

**`requirePeerAuth()` — new middleware in `server.ts`:**

Verifies three request headers:
- `X-GSTD-Node-Id` — the calling node's `nodeId`
- `X-GSTD-Node-Ts` — Unix timestamp in milliseconds (string)
- `X-GSTD-Node-Sig` — hex Ed25519 signature of `sha256(nodeId + ':' + timestamp)`

Verification steps:
1. All three headers present → else 401
2. Timestamp within ±60 seconds of server time → else 401 (replay protection)
3. `nodeId` is in `peerManager.getPeer(nodeId)` → else 401 (unknown peer). `getPeer(nodeId: string): PeerInfo | undefined` is a new method added to `PeerManager` (currently only `getLivePeers()` / `getAllPeers()` exist — this is a simple lookup: `return this.peers.get(nodeId)`).
4. `peer.pubkeyHex` is set → else 401 (peer hasn't announced its identity yet)
5. Signature verifies against the message hash using `signVerify` from `@ton/crypto` → else 401

Signature scheme:
```ts
import { createHash } from 'crypto';
import { signVerify } from '@ton/crypto';

function peerRequestMessage(nodeId: string, timestamp: number): Buffer {
    return createHash('sha256').update(`${nodeId}:${timestamp}`).digest();
}
```

Applied to `POST /api/resources/request` — replaces `requireNodeAuth`. The dashboard-operator routes (`/api/resources/config` GET/POST) keep `requireNodeAuth`.

**`signPeerRequest(identity, nodeId, timestamp)` — outgoing signing helper:**

```ts
export function signPeerRequest(
    identity: AttestorIdentity,
    nodeId: string,
    timestamp: number = Date.now()
): Record<string, string> {
    const msg = createHash('sha256').update(`${nodeId}:${timestamp}`).digest();
    const sig = signWithIdentity(identity, msg);
    return {
        'X-GSTD-Node-Id':  nodeId,
        'X-GSTD-Node-Ts':  String(timestamp),
        'X-GSTD-Node-Sig': sig.toString('hex'),
    };
}
```

Lives in `src/p2p/identity.ts`. Used whenever a node makes an HTTP call to another node's peer-auth-gated route. The plan wires it into a test (to verify the round-trip); production callers will use it as resource-sharing is implemented in future sub-projects.

**Identity threading in `index.ts`:**

```ts
// Load once at startup, before P2P and gateway init
const identity = loadOrCreateAttestorIdentity();
// ...
p2pNode.setIdentity(identity);
gateway.setAttestorIdentity(identity);
```

`GatewayServer` gains a `setAttestorIdentity(identity: AttestorIdentity): void` setter that stores it for use by `requirePeerAuth()`.

### Data flow: inference request (updated)

```
POST /v1/chat/completions
  → router.ts: try local Ollama
      → success: return
      → fail: PeerManager.getBestPeer(model)
          → filter: lastSeen < TTL, url != self, latencyMs < UNVERIFIED, consecutiveFails < 3
          → score: capability(1000) + latency(≤2000) + uptime(≤100) - qualityPenalty(0 or 500)
          → forwardToPeer(best)
              → fetch peer.url/v1/ollama/completions
              → on success: recordOutcome(nodeId, true)
              → on failure: recordOutcome(nodeId, false); return null
              → router falls back to "no peers" message
```

### Data flow: peer resource request (new, enabled by this sub-project)

```
POST /api/resources/request
  (from another node, not the dashboard)
  → requirePeerAuth(): verify X-GSTD-Node-{Id,Ts,Sig}
      → fail: 401
      → pass: rs.handleRequest(body)
```

The calling node prepares:
```ts
const headers = signPeerRequest(myIdentity, myNodeId);
fetch(`${peerUrl}/api/resources/request`, { method: 'POST', headers, body: ... });
```

## Single-node survivability

All changes degrade gracefully to a no-op with zero peers:
- `getBestPeer()` returns null (unchanged behavior) — quality scoring and consecutive-fail filter only apply to known peers.
- No identity configured: `requirePeerAuth()` rejects unknown peers (correct — if a node has no peers, no peer should be calling it either).
- `pubkeyHex` is optional in heartbeats — nodes without `identity` configured still participate in the mesh.

## Error handling

- `forwardToPeer()` already catches fetch errors and returns null; `recordOutcome(nodeId, false)` is called in the catch block.
- `requirePeerAuth()` always returns a response (401 variants) on failure — never throws.
- `signPeerRequest()` signing is synchronous and cannot fail (Ed25519 always succeeds given a valid key).
- Identity load (`loadOrCreateAttestorIdentity()`) either returns an identity or throws a filesystem error — if it throws, the node fails to start, which is correct (corrupted identity is a critical state).

## Testing

**Unit tests (`src/p2p/peers.test.ts` — extend existing file):**

1. Fresh peer (< 5 attempts) is not penalized regardless of failures
2. Peer with 5+ attempts and 40% failure rate gets -500 penalty
3. Peer with 3 consecutive failures is filtered from `getBestPeer()` results
4. Successful response resets `consecutiveFails` to 0
5. Quality state is per-nodeId and does not affect other peers

**Unit tests (`src/p2p/identity.test.ts` — new file):**

1. `signPeerRequest()` produces three correctly-named headers
2. Signature produced by `signPeerRequest()` verifies correctly with `signVerify` against the same `peerRequestMessage` hash
3. Stale timestamp (>60s) is rejected by verification logic (test the verification helper directly)
4. Wrong nodeId in message produces an invalid signature (verification returns false)

**Integration test (in `src/p2p/identity.test.ts`):**

5. Round-trip: `signPeerRequest(identity, nodeId)` → headers → `requirePeerAuth`-equivalent verification logic → passes

**`npx vitest run` and `tsc --noEmit` must stay clean after every task.**

## Global Constraints

- Single-node survivability: a node with zero peers must boot and serve local inference with no error.
- No new external dependencies beyond what's already in `package.json` (`@ton/crypto` for `signVerify` is already present).
- No behavioral change to existing dashboard routes — `requireNodeAuth` is not touched on any dashboard-operator route.
- Every change to `getBestPeer()` scoring must not break the case where the peer table is empty (returns null gracefully).
- `pubkeyHex` is optional everywhere — nodes without an identity file still participate in the mesh, just without peer-auth capability.
- Logging: log when a peer is excluded by the consecutive-fail filter (`[Peers] Excluding ${nodeId}: ${consecutiveFails} consecutive failures`), so an operator can see the quality system acting.
