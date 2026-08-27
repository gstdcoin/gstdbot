# Signed Remote Commands & Update Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ed25519 signature verification for platform-originated commands and update manifests, gating the heartbeat command channel (fail-closed) and the self-update routes (fail-open with `PLATFORM_SIGNING_ENFORCED` env var).

**Architecture:** A new pure library `src/lib/platform-auth.ts` owns the baked-in platform public key and all verification logic; `platform-link.ts` imports it to gate the `data.commands[]` loop (fail-closed) before emitting events; `server.ts` imports it to gate `/api/update` and `/api/node/update` (fail-open) before running git. All crypto reuses `@ton/crypto`'s `signVerify` — already in the dependency tree. No new runtime dependencies.

**Tech Stack:** TypeScript, Node.js 20, `@ton/crypto` (Ed25519 — already installed), `vitest`

**Spec:** `docs/superpowers/specs/2026-08-27-signed-commands-design.md`

## Global Constraints

- TypeScript strict mode — no `any` escapes in new code (cast to `unknown` first if needed)
- Type-check command: `node_modules/.bin/tsc --skipLibCheck` (never `npx tsc` — OOM on Pi)
- Test command: `node_modules/.bin/vitest run` (never `npx vitest`)
- No new runtime dependencies — `@ton/crypto` and Node `crypto` are already present
- `PLATFORM_PUBKEY_HEX` is a compile-time source constant — not an env var, not a config file
- `PLATFORM_SIGNING_ENFORCED` is the only env var added — string `"true"` enables fail-closed on updates
- Replay window: ±60 000 ms (matches `isStaleTimestamp` in `src/p2p/identity.ts`)
- Working directory for all shell commands: `/home/bot/gstdbot`

---

### Task 1: `src/lib/platform-auth.ts` — Ed25519 verification library + keypair generation

**Files:**
- Create: `src/lib/platform-auth.ts`
- Create: `src/lib/platform-auth.test.ts`

**Interfaces — Produces (used by Tasks 2 and 3):**
```ts
export const PLATFORM_PUBKEY_HEX: string                                          // 64 hex chars
export interface PlatformCommand { type: string; payload?: Record<string,unknown>; timestamp: number; sig: string; }
export interface UpdateManifest  { commit: string; branch: string; version: string; timestamp: number; sig: string; }
export function verifyPlatformCommand(cmd: PlatformCommand, pubkeyHex?: string): boolean
export function verifyUpdateManifest(manifest: UpdateManifest, pubkeyHex?: string): boolean
export function isStaleCommand(timestamp: number, maxSkewMs?: number): boolean
```

- [ ] **Step 1: Generate the platform keypair**

Run this from `/home/bot/gstdbot` to produce the keypair. The script uses `@ton/crypto` which is already installed:

```bash
node --input-type=module <<'EOF'
import { randomBytes } from 'crypto';
import { keyPairFromSeed } from '@ton/crypto';
const seed = randomBytes(32);
const kp   = keyPairFromSeed(seed);
console.log('\n=== GSTD PLATFORM KEYPAIR ===');
console.log('SEED_HEX (private — give to gstdai operator, DO NOT COMMIT):');
console.log(seed.toString('hex'));
console.log('\nPUBKEY_HEX (64 chars — paste into PLATFORM_PUBKEY_HEX below):');
console.log(kp.publicKey.toString('hex'));
console.log('=============================\n');
EOF
```

Copy the `PUBKEY_HEX` line (64 hex characters). You will substitute it in Step 4. The `SEED_HEX` is sensitive — hand it to the gstdai operator and do not save it to any file in this repo.

- [ ] **Step 2: Write the test file (TDD — imports will fail until Step 4)**

Create `src/lib/platform-auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { keyPairFromSeed, sign } from '@ton/crypto';
import { randomBytes, createHash } from 'crypto';
import {
    verifyPlatformCommand,
    verifyUpdateManifest,
    isStaleCommand,
    type PlatformCommand,
    type UpdateManifest,
} from './platform-auth.js';

// Fresh test keypair — NOT the production platform key.
// Tests pass this as the optional second argument to override the baked-in constant.
const testSeed      = randomBytes(32);
const testKp        = keyPairFromSeed(testSeed);
const testPubkeyHex = testKp.publicKey.toString('hex');

function signCmd(type: string, payload: Record<string, unknown> | undefined, ts: number): string {
    const msg = createHash('sha256')
        .update(`${type}:${JSON.stringify(payload ?? {})}:${ts}`)
        .digest();
    return Buffer.from(sign(msg, testKp.secretKey)).toString('hex');
}

function signMft(commit: string, branch: string, version: string, ts: number): string {
    const msg = createHash('sha256')
        .update(`${commit}:${branch}:${version}:${ts}`)
        .digest();
    return Buffer.from(sign(msg, testKp.secretKey)).toString('hex');
}

// ─── verifyPlatformCommand ────────────────────────────────────────

describe('verifyPlatformCommand', () => {
    it('returns true for a valid signed command (no payload)', () => {
        const ts  = Date.now();
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: signCmd('restart', undefined, ts) };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(true);
    });

    it('returns true for a valid signed command with payload', () => {
        const ts  = Date.now();
        const cmd: PlatformCommand = {
            type: 'configure', payload: { key: 'value' }, timestamp: ts,
            sig: signCmd('configure', { key: 'value' }, ts),
        };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(true);
    });

    it('returns false when payload is tampered after signing', () => {
        const ts  = Date.now();
        const sig = signCmd('configure', { key: 'original' }, ts);
        const cmd: PlatformCommand = { type: 'configure', payload: { key: 'tampered' }, timestamp: ts, sig };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(false);
    });

    it('returns false when sig is from a different keypair', () => {
        const otherKp  = keyPairFromSeed(randomBytes(32));
        const ts       = Date.now();
        const msg      = createHash('sha256').update(`restart:{}:${ts}`).digest();
        const wrongSig = Buffer.from(sign(msg, otherKp.secretKey)).toString('hex');
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: wrongSig };
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(false);
    });

    it('returns false for malformed sig hex without throwing', () => {
        const cmd: PlatformCommand = { type: 'restart', timestamp: Date.now(), sig: 'not-valid-hex!!' };
        expect(() => verifyPlatformCommand(cmd, testPubkeyHex)).not.toThrow();
        expect(verifyPlatformCommand(cmd, testPubkeyHex)).toBe(false);
    });

    it('returns false when pubkeyHex is empty string', () => {
        const ts  = Date.now();
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: signCmd('restart', undefined, ts) };
        expect(verifyPlatformCommand(cmd, '')).toBe(false);
    });

    it('returns false when default pubkey (production) is used with a test-key sig', () => {
        // Production PLATFORM_PUBKEY_HEX ≠ testPubkeyHex → verification must fail
        const ts  = Date.now();
        const cmd: PlatformCommand = { type: 'restart', timestamp: ts, sig: signCmd('restart', undefined, ts) };
        expect(verifyPlatformCommand(cmd)).toBe(false);
    });
});

// ─── verifyUpdateManifest ─────────────────────────────────────────

describe('verifyUpdateManifest', () => {
    it('returns true for a valid signed manifest', () => {
        const ts = Date.now();
        const m: UpdateManifest = {
            commit: 'a'.repeat(40), branch: 'main', version: '1.4.2', timestamp: ts,
            sig: signMft('a'.repeat(40), 'main', '1.4.2', ts),
        };
        expect(verifyUpdateManifest(m, testPubkeyHex)).toBe(true);
    });

    it('returns false when commit is tampered after signing', () => {
        const ts  = Date.now();
        const sig = signMft('a'.repeat(40), 'main', '1.4.2', ts);
        const m: UpdateManifest = { commit: 'b'.repeat(40), branch: 'main', version: '1.4.2', timestamp: ts, sig };
        expect(verifyUpdateManifest(m, testPubkeyHex)).toBe(false);
    });

    it('returns false for malformed sig without throwing', () => {
        const m: UpdateManifest = { commit: 'a'.repeat(40), branch: 'main', version: '1.0.0', timestamp: Date.now(), sig: 'bad' };
        expect(() => verifyUpdateManifest(m, testPubkeyHex)).not.toThrow();
        expect(verifyUpdateManifest(m, testPubkeyHex)).toBe(false);
    });

    it('returns false when pubkeyHex is empty string', () => {
        const ts = Date.now();
        const m: UpdateManifest = {
            commit: 'a'.repeat(40), branch: 'main', version: '1.0.0', timestamp: ts,
            sig: signMft('a'.repeat(40), 'main', '1.0.0', ts),
        };
        expect(verifyUpdateManifest(m, '')).toBe(false);
    });
});

// ─── isStaleCommand ───────────────────────────────────────────────

describe('isStaleCommand', () => {
    it('returns false for a fresh timestamp', () => {
        expect(isStaleCommand(Date.now())).toBe(false);
    });

    it('returns false for timestamp 59 999 ms in the past', () => {
        expect(isStaleCommand(Date.now() - 59_999)).toBe(false);
    });

    it('returns true for timestamp 60 001 ms in the past', () => {
        expect(isStaleCommand(Date.now() - 60_001)).toBe(true);
    });

    it('returns true for a timestamp 60 001 ms in the future', () => {
        expect(isStaleCommand(Date.now() + 60_001)).toBe(true);
    });

    it('respects a custom maxSkewMs', () => {
        expect(isStaleCommand(Date.now() - 5_001, 5_000)).toBe(true);
        expect(isStaleCommand(Date.now() - 4_999, 5_000)).toBe(false);
    });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
node_modules/.bin/vitest run src/lib/platform-auth.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './platform-auth.js'`. That is correct.

- [ ] **Step 4: Create `src/lib/platform-auth.ts`**

Replace `PASTE_64_CHAR_PUBKEY_HEX_FROM_STEP_1_HERE` with the 64-character hex pubkey you copied in Step 1:

```ts
import { signVerify } from '@ton/crypto';
import { createHash } from 'crypto';

/**
 * Ed25519 public key of the GSTD platform operator — baked into source so
 * it is auditable in every PR and cannot be overridden at runtime.
 * To rotate: generate a new keypair, commit the new pubkey, ship a release.
 * The matching private key seed lives in the gstdai secrets vault.
 */
export const PLATFORM_PUBKEY_HEX = 'PASTE_64_CHAR_PUBKEY_HEX_FROM_STEP_1_HERE';

export interface PlatformCommand {
    type:     string;
    payload?: Record<string, unknown>;
    timestamp: number;
    sig:      string;
}

export interface UpdateManifest {
    commit:   string;   // full 40-char SHA of the intended HEAD after git pull
    branch:   string;
    version:  string;
    timestamp: number;
    sig:      string;
}

function commandMessage(type: string, payload: Record<string, unknown> | undefined, timestamp: number): Buffer {
    return createHash('sha256')
        .update(`${type}:${JSON.stringify(payload ?? {})}:${timestamp}`)
        .digest();
}

function manifestMessage(m: Omit<UpdateManifest, 'sig'>): Buffer {
    return createHash('sha256')
        .update(`${m.commit}:${m.branch}:${m.version}:${m.timestamp}`)
        .digest();
}

/**
 * Returns true if the command's signature is valid.
 * Pass a test keypair's pubkeyHex as the second argument in tests;
 * omit it in production code to use the baked-in PLATFORM_PUBKEY_HEX.
 */
export function verifyPlatformCommand(cmd: PlatformCommand, pubkeyHex = PLATFORM_PUBKEY_HEX): boolean {
    if (!pubkeyHex || pubkeyHex.length !== 64) return false;
    try {
        const msg = commandMessage(cmd.type, cmd.payload, cmd.timestamp);
        return signVerify(msg, Buffer.from(cmd.sig, 'hex'), Buffer.from(pubkeyHex, 'hex'));
    } catch {
        return false;
    }
}

/**
 * Returns true if the update manifest's signature is valid.
 * Pass a test keypair's pubkeyHex as the second argument in tests.
 */
export function verifyUpdateManifest(manifest: UpdateManifest, pubkeyHex = PLATFORM_PUBKEY_HEX): boolean {
    if (!pubkeyHex || pubkeyHex.length !== 64) return false;
    try {
        const msg = manifestMessage(manifest);
        return signVerify(msg, Buffer.from(manifest.sig, 'hex'), Buffer.from(pubkeyHex, 'hex'));
    } catch {
        return false;
    }
}

/** Returns true if the timestamp is outside the ±maxSkewMs replay-protection window. */
export function isStaleCommand(timestamp: number, maxSkewMs = 60_000): boolean {
    return Math.abs(Date.now() - timestamp) > maxSkewMs;
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
node_modules/.bin/vitest run src/lib/platform-auth.test.ts 2>&1 | tail -20
```

Expected: all tests PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/platform-auth.ts src/lib/platform-auth.test.ts
git commit -m "feat: add platform-auth library — Ed25519 command/manifest verification (sub-project H)"
```

---

### Task 2: Gate `data.commands[]` in `platform-link.ts` (fail-closed)

**Files:**
- Modify: `src/core/platform-link.ts`
- Create: `src/core/platform-link.test.ts`

**Interfaces:**
- Consumes from Task 1: `verifyPlatformCommand(cmd, pubkeyHex?): boolean`, `isStaleCommand(ts): boolean`, `PlatformCommand`
- Produces: `PlatformLink._processCommands(commands, verifyFn?)` — internal method, named with underscore prefix to signal test-accessibility

The gate is extracted into `_processCommands(commands, verifyFn?)` with an injectable verify function so tests can pass a controlled mock without module mocking. Production calls pass no `verifyFn` (defaults to the real `verifyPlatformCommand`).

The `PlatformLink` constructor signature is:
```ts
new PlatformLink({ platformUrl: string, nodeId: string, walletAddress: string, version: string })
```

- [ ] **Step 1: Write the failing test**

Create `src/core/platform-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformLink } from './platform-link.js';

function makePL(): PlatformLink {
    return new PlatformLink({
        platformUrl:   'http://localhost:9999',
        nodeId:        'test-node-id',
        walletAddress: 'EQtest',
        version:       '0.0.0',
    });
}

describe('PlatformLink._processCommands gate', () => {
    it('does not emit when sig field is missing', () => {
        const pl = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));

        (pl as any)._processCommands([{ type: 'restart', timestamp: Date.now() }]);

        expect(received).toHaveLength(0);
    });

    it('does not emit when timestamp is stale (>60 s old)', () => {
        const pl = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));

        (pl as any)._processCommands([
            { type: 'restart', timestamp: Date.now() - 70_000, sig: 'anysig' },
        ]);

        expect(received).toHaveLength(0);
    });

    it('does not emit when verifyFn returns false', () => {
        const pl         = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));
        const alwaysFail = () => false;

        (pl as any)._processCommands(
            [{ type: 'restart', timestamp: Date.now(), sig: 'badsig' }],
            alwaysFail,
        );

        expect(received).toHaveLength(0);
    });

    it('emits the command exactly once when verifyFn returns true', () => {
        const pl         = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));
        const alwaysPass = () => true;

        const cmd = { type: 'restart', timestamp: Date.now(), sig: 'validsig' };
        (pl as any)._processCommands([cmd], alwaysPass);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(cmd);
    });

    it('passes only valid commands from a mixed batch', () => {
        const pl         = makePL();
        const received: unknown[] = [];
        pl.on('command', (c) => received.push(c));
        // Accept only the command whose sig === 'good'
        const selective  = (cmd: { sig?: string }) => cmd.sig === 'good';
        const ts = Date.now();

        (pl as any)._processCommands([
            { type: 'a', timestamp: ts, sig: 'good' },
            { type: 'b', timestamp: ts, sig: 'bad'  },
            { type: 'c', timestamp: ts              },   // no sig — dropped before verifyFn
        ], selective);

        expect(received).toHaveLength(1);
        expect((received[0] as any).type).toBe('a');
    });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
node_modules/.bin/vitest run src/core/platform-link.test.ts 2>&1 | tail -15
```

Expected: FAIL — `pl._processCommands is not a function`.

- [ ] **Step 3: Add the import to `platform-link.ts`**

The current import block in `src/core/platform-link.ts` (lines 14–17):
```ts
import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
```

Add one line after `import { homedir } from 'os';`:
```ts
import { verifyPlatformCommand, isStaleCommand, type PlatformCommand } from '../lib/platform-auth.js';
```

- [ ] **Step 4: Replace the command loop in `sendHeartbeat` and add `_processCommands`**

In `sendHeartbeat` (around line 174), replace the current command loop:

```ts
// REMOVE this block:
            // Handle platform commands
            if (data.commands?.length > 0) {
                for (const cmd of data.commands) {
                    this.emit('command', cmd);
                }
            }

// REPLACE WITH:
            if (data.commands?.length > 0) {
                this._processCommands(data.commands as unknown[]);
            }
```

Add `_processCommands` as a new method in the `PlatformLink` class. Place it right after the closing brace of `sendHeartbeat` (around line 190):

```ts
    _processCommands(
        commands: unknown[],
        verifyFn: (cmd: PlatformCommand) => boolean = verifyPlatformCommand,
    ): void {
        for (const raw of commands) {
            const cmd = raw as Partial<PlatformCommand>;
            if (!cmd.sig) {
                console.warn(`[platform-auth] command '${cmd.type ?? '?'}' rejected — unsigned`);
                continue;
            }
            if (isStaleCommand(cmd.timestamp ?? 0)) {
                console.warn(`[platform-auth] command '${cmd.type ?? '?'}' rejected — stale timestamp`);
                continue;
            }
            if (!verifyFn(cmd as PlatformCommand)) {
                console.warn(`[platform-auth] command '${cmd.type ?? '?'}' rejected — invalid signature`);
                continue;
            }
            this.emit('command', raw);
        }
    }
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
node_modules/.bin/vitest run src/core/platform-link.test.ts 2>&1 | tail -15
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/platform-link.ts src/core/platform-link.test.ts
git commit -m "feat: gate platform command channel with Ed25519 verification (fail-closed)"
```

---

### Task 3: Gate `/api/update` and `/api/node/update` in `server.ts`

**Files:**
- Modify: `src/gateway/server.ts`

**Interfaces:**
- Consumes from Task 1: `verifyUpdateManifest`, `isStaleCommand`, `UpdateManifest`
- No new test file — the gate decision logic lives in a local helper `checkUpdateManifest` whose correctness is already covered by `platform-auth.test.ts`. `server.ts` has no existing test infrastructure (no supertest), and adding it is out of scope for this sub-project.

The two update routes both get the same gate. `/api/update` (the full update with rollback infrastructure) also gets a post-pull commit-hash check. `/api/node/update` (the lightweight alias) gets the pre-pull gate only — it has no `originalHash` capture so no rollback path.

The `checkUpdateManifest` helper is a module-level function (not exported, not a class method) that returns a typed discriminated union — `{ ok: true }` or `{ ok: false; status: 400 | 403; error: string }`.

Current import block around lines 33–34 of `server.ts`:
```ts
import { signVerify } from '@ton/crypto';
import { peerRequestMessage, isStaleTimestamp } from '../p2p/identity.js';
```

Current `/api/update` route starts at line 517.  
Current `/api/node/update` route starts at line 1904.  
`requireNodeAuth` helper is at line 173.

- [ ] **Step 1: Add the import**

After the existing `@ton/crypto` and `identity.js` imports (around line 34), add:

```ts
import { verifyUpdateManifest, isStaleCommand, type UpdateManifest } from '../lib/platform-auth.js';
```

- [ ] **Step 2: Add `checkUpdateManifest` helper**

Add this function immediately after the `requireNodeAuth` function definition (around line 179). It must be at module scope (not inside the class):

```ts
function checkUpdateManifest(
    manifest: UpdateManifest | undefined,
    enforced: boolean,
): { ok: true } | { ok: false; status: 400 | 403; error: string } {
    if (!manifest) {
        if (enforced) return { ok: false, status: 403, error: 'Signed manifest required (PLATFORM_SIGNING_ENFORCED=true)' };
        return { ok: true };
    }
    if (isStaleCommand(manifest.timestamp)) {
        return { ok: false, status: 400, error: 'Update manifest timestamp is stale (±60s window)' };
    }
    if (!verifyUpdateManifest(manifest)) {
        return { ok: false, status: 403, error: 'Update manifest signature invalid' };
    }
    return { ok: true };
}
```

- [ ] **Step 3: Gate the `/api/update` route (full update with rollback)**

Locate the `/api/update` POST handler (line 517). It currently starts:

```ts
        this.app.post('/api/update', async (req, res) => {
            if (!requireNodeAuth(req, res)) return;
            try {
                const installDir = process.env.GSTD_INSTALL_DIR || ...
```

Insert the manifest gate immediately after `if (!requireNodeAuth(req, res)) return;` and before the `try {` block:

```ts
            // ── Manifest signature gate ───────────────────────────
            const manifest: UpdateManifest | undefined = req.body?.manifest;
            const enforced = process.env.PLATFORM_SIGNING_ENFORCED === 'true';
            const mCheck = checkUpdateManifest(manifest, enforced);
            if (!mCheck.ok) {
                return res.status(mCheck.status).json({ success: false, error: mCheck.error });
            }
            if (!manifest) {
                logActivity('Self-update requested without a signed manifest — permissive mode', 'warn');
            }
            // ─────────────────────────────────────────────────────
```

Then find the `originalHash` capture inside the same route (around line 564):
```ts
                const originalHash = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8' }).trim();
```

Add the commit-match check immediately after that line:

```ts
                // If a manifest was provided, the pulled commit must match exactly.
                if (manifest) {
                    const actualCommit = execSync('git rev-parse HEAD', { cwd: installDir, encoding: 'utf-8' }).trim();
                    if (actualCommit !== manifest.commit) {
                        execSync(`git reset --hard ${originalHash}`, { cwd: installDir, encoding: 'utf-8', timeout: 10000 });
                        execSync('npm install --legacy-peer-deps', { cwd: installDir, encoding: 'utf-8', timeout: 120000 });
                        throw new Error(
                            `Pulled commit ${actualCommit.slice(0, 8)} does not match manifest ${manifest.commit.slice(0, 8)} — rolled back`
                        );
                    }
                }
```

- [ ] **Step 4: Gate the `/api/node/update` route (lightweight alias)**

Locate the `/api/node/update` POST handler (line 1904). It currently starts:

```ts
        this.app.post('/api/node/update', async (req, res) => {
            if (!requireNodeAuth(req, res)) return;
            try {
                const cwd = join(__dirname, '../..');
```

Insert the same manifest gate immediately after `if (!requireNodeAuth(req, res)) return;`:

```ts
            // ── Manifest signature gate ───────────────────────────
            const manifest: UpdateManifest | undefined = req.body?.manifest;
            const enforced = process.env.PLATFORM_SIGNING_ENFORCED === 'true';
            const mCheck = checkUpdateManifest(manifest, enforced);
            if (!mCheck.ok) {
                return res.status(mCheck.status).json({ ok: false, error: mCheck.error });
            }
            if (!manifest) {
                logActivity('Update requested without a signed manifest — permissive mode', 'warn');
            }
            // ─────────────────────────────────────────────────────
```

Note: this route has no `originalHash` capture and no rollback path, so no post-pull commit check is added here.

- [ ] **Step 5: Type-check**

```bash
node_modules/.bin/tsc --skipLibCheck 2>&1 | head -30
```

Expected: no output (clean). If there are type errors, fix them before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/gateway/server.ts
git commit -m "feat: gate /api/update and /api/node/update with signed manifest verification"
```

---

### Task 4: Full tsc + vitest verification

**Files:** none — verification only

- [ ] **Step 1: Full type-check**

```bash
node_modules/.bin/tsc --skipLibCheck 2>&1
```

Expected: no output. If errors appear, fix them and commit the fix separately.

- [ ] **Step 2: Full test suite**

```bash
node_modules/.bin/vitest run 2>&1 | tail -30
```

Expected: all previous tests still pass, plus the new platform-auth and platform-link tests. Count: prior passing count + 12 (platform-auth) + 5 (platform-link) = total.

- [ ] **Step 3: Verify the command gate is wired**

```bash
grep -n "_processCommands\|verifyPlatformCommand\|isStaleCommand" src/core/platform-link.ts
```

Expected: 3 lines — the import, the call in `sendHeartbeat`, and the method definition.

- [ ] **Step 4: Verify the update gate is wired**

```bash
grep -n "checkUpdateManifest\|PLATFORM_SIGNING_ENFORCED\|manifest signature" src/gateway/server.ts
```

Expected: 5+ lines — the helper definition (1), two calls in the two routes (2), two warn-log lines (2).

- [ ] **Step 5: Commit only if Step 1 or 2 required fixes**

```bash
git add -p
git commit -m "fix: tsc/test cleanup for signed-commands implementation"
```

If Steps 1 and 2 were clean, skip this step entirely.
