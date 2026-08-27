# Signed Remote Commands & Update Integrity — Design

**Sub-project H**  
**Date:** 2026-08-27  
**Status:** Approved for implementation

---

## Problem

The GSTD node receives commands from the central platform in two ways:

1. **Heartbeat response** (`data.commands[]` in `PlatformLink`) — platform pushes commands to the node alongside heartbeat ACKs. Currently no auth or integrity check: any party that can produce a heartbeat response can inject arbitrary commands.
2. **Operator-triggered update routes** (`/api/update`, `/api/node/update`) — PIN-session-protected, so *who* is calling is established, but *what* is being pulled is not: the node blindly trusts whatever commit is on the git remote branch.

The prior audit cycle closed all *missing-auth* instances (PIN gates everywhere). This sub-project closes the orthogonal gap: **integrity** — is this specific command/artifact one the platform operator actually issued, unmodified?

---

## Scope

**In scope (gstdbot only):**
- New `src/lib/platform-auth.ts` — baked-in platform pubkey + pure verification functions
- Gate `data.commands[]` in `platform-link.ts` — fail-closed (unsigned/invalid → drop)
- Gate `/api/update` and `/api/node/update` in `server.ts` — fail-open with `PLATFORM_SIGNING_ENFORCED` env var
- Unit tests for all new functions

**Out of scope (gstdai — documented as handoff):**
- Generating the signing private key (done once during this sub-project, private key handed to gstdai)
- Signing heartbeat commands on the platform side
- Signing release manifests on the platform side
- Setting `PLATFORM_SIGNING_ENFORCED=true` in production

---

## Architecture

### New file: `src/lib/platform-auth.ts`

Pure library — no imports from the rest of the codebase, no I/O, no side effects. Testable in isolation.

Exports:
- `PLATFORM_PUBKEY_HEX: string` — 64-char hex Ed25519 public key, hardcoded as a source constant. Generated offline during this sub-project; the corresponding private key seed goes to the gstdai secrets vault. Rotating the key requires a new release.
- `PlatformCommand` interface
- `UpdateManifest` interface
- `verifyPlatformCommand(cmd: PlatformCommand): boolean`
- `verifyUpdateManifest(manifest: UpdateManifest): boolean`
- `isStaleCommand(timestamp: number, maxSkewMs?: number): boolean`

Uses `signVerify` from `@ton/crypto` and `createHash` from Node `crypto` — both already in the dependency tree.

### Modified: `src/core/platform-link.ts`

The heartbeat handler's `data.commands[]` loop gains a verification gate (fail-closed):

```
for each cmd in data.commands:
  if no sig field         → log warn "unsigned command type=<type>, skipping"  → continue
  if isStaleCommand(ts)   → log warn "stale command type=<type>, skipping"     → continue
  if !verifyPlatformCommand(cmd) → log warn "bad sig command type=<type>"      → continue
  emit('command', cmd)    ← only reachable if all checks pass
```

The gate is fail-closed because the command channel currently has **no subscribers** in `server.ts` or `index.ts` — closing it costs zero operational impact.

### Modified: `src/gateway/server.ts`

Both `/api/update` (POST, full update) and `/api/node/update` (POST, lightweight alias) gain an optional `manifest` body field.

Gate logic (applied before git operations):

```
manifest present?
  YES:
    isStaleCommand(manifest.timestamp)?  → 400 { error: "manifest timestamp stale" }
    !verifyUpdateManifest(manifest)?     → 403 { error: "manifest signature invalid" }
    → proceed with git pull
    → after pull: git rev-parse HEAD ≠ manifest.commit (full 40-char SHA exact match)?
        → rollback to originalHash + npm install
        → 500 { error: "pulled commit <actual> does not match manifest <expected>, rolled back" }
    → continue (build, restart)

  NO:
    PLATFORM_SIGNING_ENFORCED === 'true'?  → 403 { error: "signed manifest required" }
    else                                   → log warn "update without signed manifest (permissive mode)"
                                           → proceed as today (existing behavior)
```

---

## Data Shapes

### PlatformCommand

```ts
interface PlatformCommand {
    type:      string;                       // "update" | "restart" | "configure" | ...
    payload?:  Record<string, unknown>;      // type-specific parameters
    timestamp: number;                       // ms since epoch
    sig:       string;                       // hex Ed25519 signature
}
```

Message signed: `sha256("${type}:${JSON.stringify(payload ?? {})}:${timestamp}")`

The platform controls payload serialization. Using `JSON.stringify(payload ?? {})` is deterministic when the platform produces it and gstdbot verifies it with the same serializer — both Node.js environments, same V8 JSON implementation.

### UpdateManifest

```ts
interface UpdateManifest {
    commit:    string;   // full 40-char SHA of the intended HEAD after pull
    branch:    string;   // e.g. "main"
    version:   string;   // package.json semver string, e.g. "1.4.2"
    timestamp: number;   // ms since epoch
    sig:       string;   // hex Ed25519 signature
}
```

Message signed: `sha256("${commit}:${branch}:${version}:${timestamp}")`

---

## Verification Functions

### `verifyPlatformCommand(cmd: PlatformCommand): boolean`

```
if PLATFORM_PUBKEY_HEX is empty or not 64 chars → return false
try:
  msg = sha256("${cmd.type}:${JSON.stringify(cmd.payload ?? {})}:${cmd.timestamp}")
  return signVerify(msg, Buffer.from(cmd.sig, 'hex'), Buffer.from(PLATFORM_PUBKEY_HEX, 'hex'))
catch → return false
```

### `verifyUpdateManifest(manifest: UpdateManifest): boolean`

```
if PLATFORM_PUBKEY_HEX is empty or not 64 chars → return false
try:
  msg = sha256("${manifest.commit}:${manifest.branch}:${manifest.version}:${manifest.timestamp}")
  return signVerify(msg, Buffer.from(manifest.sig, 'hex'), Buffer.from(PLATFORM_PUBKEY_HEX, 'hex'))
catch → return false
```

### `isStaleCommand(timestamp: number, maxSkewMs = 60_000): boolean`

```
return Math.abs(Date.now() - timestamp) > maxSkewMs
```

Identical pattern to `isStaleTimestamp` in `src/p2p/identity.ts`. Replay window: ±60 s.

---

## Keypair Generation

During implementation, a one-time Node.js script generates the platform keypair:

```ts
import { randomBytes } from 'crypto';
import { keyPairFromSeed } from '@ton/crypto';
const seed = randomBytes(32);
const kp   = keyPairFromSeed(seed);
console.log('SEED_HEX (private — store in gstdai vault, DO NOT COMMIT):', seed.toString('hex'));
console.log('PUBKEY_HEX (commit to src/lib/platform-auth.ts):', kp.publicKey.toString('hex'));
```

The private key seed is displayed once, handed to the gstdai operator, and never written to disk in this repo. Only the public key is committed.

---

## Error Handling

- `verifyPlatformCommand` and `verifyUpdateManifest` never throw — all `@ton/crypto` errors caught, return `false`. Callers see only boolean.
- Command gate logs every rejection with `type` so the operator sees what was dropped and why.
- Update gate returns structured JSON errors (`error` field) so the dashboard can surface them.
- Commit-mismatch rollback reuses the existing rollback pattern in `/api/update` (reset to `originalHash` + `npm install --legacy-peer-deps`).

---

## Testing

### `src/lib/platform-auth.test.ts` (new, pure unit)

`verifyPlatformCommand`:
- Valid sig from correct keypair → `true`
- Tampered payload → `false`
- Wrong keypair sig → `false`
- Stale timestamp (>60 s) → `isStaleCommand` returns `true`
- Malformed sig hex (odd-length string) → `false` (no throw)
- `PLATFORM_PUBKEY_HEX` set to empty string → `false`

`verifyUpdateManifest` — same matrix with manifest fields.

`isStaleCommand`:
- Timestamp within window → `false`
- Timestamp exactly at boundary + 1 ms → `true`
- Future timestamp beyond window → `true`

### `src/core/platform-link.test.ts` (extend existing)

Mock `emit`, drive the command loop:
- Unsigned command (no `sig`) → `emit` not called
- Stale timestamp → `emit` not called
- Invalid sig → `emit` not called
- Valid signed command → `emit('command', cmd)` called exactly once

### `src/gateway/server.ts` tests (extend existing)

- POST `/api/update` with no manifest, env var unset → 200, warn logged
- POST `/api/update` with no manifest, `PLATFORM_SIGNING_ENFORCED=true` → 403
- POST `/api/update` with valid manifest → proceeds (mocked git)
- POST `/api/update` with stale manifest timestamp → 400
- POST `/api/update` with invalid manifest sig → 403

---

## gstdai Handoff

To complete the integrity chain, gstdai must:

1. **Store** the platform private key seed in its secrets vault (provided during this sub-project's implementation task).
2. **Sign heartbeat commands**: for each command added to `data.commands[]`, compute  
   `sig = Buffer.from(sign(sha256("${type}:${JSON.stringify(payload ?? {})}:${timestamp}"), seed)).toString('hex')`
3. **Sign releases**: when triggering a node update (either via a heartbeat command of type `"release"` or a direct API call to the node's `/api/update`), include an `UpdateManifest` signed as  
   `sig = Buffer.from(sign(sha256("${commit}:${branch}:${version}:${timestamp}"), seed)).toString('hex')`
4. **Enable enforcement** by setting `PLATFORM_SIGNING_ENFORCED=true` in the node's environment once all platform-side signing is live.

The private key uses the same Ed25519 primitives as `@ton/crypto`'s `sign()` function — the signing call is a one-liner in any Node.js environment with the package installed.

---

## Global Constraints

- TypeScript strict mode — no `any` escapes in new code
- `node_modules/.bin/tsc --skipLibCheck` for type checks (not `npx tsc`)
- No new runtime dependencies — `@ton/crypto` and Node `crypto` are already present
- `PLATFORM_PUBKEY_HEX` is a compile-time constant, not an env var — the threat model requires it to be auditable in source and not overridable at runtime
- `PLATFORM_SIGNING_ENFORCED` is the only env var added — boolean string `"true"` enables fail-closed on updates
