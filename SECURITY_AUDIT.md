# GSTD Node OS — Security Audit
**Date:** 2026-08-28  
**Spec priority reference:** GSTD Protocol v0.1 §29

---

## Priority Classification

### P0 — Fix Before Any Phase 1 Work

#### 🔴 SEC-01: Remote commands received without node-local authentication

**File:** `src/swarm/agent.ts:407`, `src/swarm/agent.ts:530-563`  
**File:** `src/naas/uptime_daemon.ts:239`, `src/naas/uptime_daemon.ts:305`

**Problem:** Both `SwarmAgent` and `UptimeDaemon` receive commands from `platform.gstdtoken.com` and execute them (`restart`, `stop`, `update`, `health_check`). The commands are authenticated only by HTTPS transport — there is no node-local Ed25519 signature verification on the command payload.

`platform-auth.ts` exists and verifies signed commands but is only wired into the gateway update endpoint (`/api/update`), not into the heartbeat command loop.

**Impact:** If the platform is compromised or a MITM intercepts traffic, a node can be stopped, restarted, or force-updated with malicious code.

**Fix:** Apply `verifyPlatformCommand()` from `src/lib/platform-auth.ts` to ALL command dispatch paths in `swarm/agent.ts` and `naas/uptime_daemon.ts`. Commands without a valid signature must be rejected (fail-closed).

---

#### 🔴 SEC-02: `GSTD_WALLET_MNEMONIC` env var accepted at startup

**File:** `src/index.ts:390-391`  
```typescript
const mnemonic = process.env.GSTD_WALLET_MNEMONIC?.split(' ');
await tonConnect.init(mnemonic).catch(() => {});
```

**Problem:** Accepting a full mnemonic on the node means a compromised node = compromised wallet. A node runner should only need to register their payout **address**, not provide spending authority to the node.

**Impact:** Any process with read access to the node's environment (e.g., leaked via logs, process listing, or remote command execution) can drain the wallet.

**Fix:**  
- Remove mnemonic acceptance from the node.  
- The node needs only `GSTD_WALLET_ADDRESS` (payout address) for reporting.  
- Signing for TON settlement should happen via a separate offline key or via TON Connect (user's own wallet).  
- Until settlement is wired to TON, the node should track earnings locally without signing transactions.

---

#### 🔴 SEC-03: Task execution has no sandbox

**Files:** `src/compute/marketplace.ts:381`, `src/naas/orchestrator.ts:64`

**Problem:** Tasks that trigger Docker-based compute run with no enforced CPU/RAM/disk/timeout limits beyond what Docker's default config provides. The `security/hardening.ts` file documents sandbox patterns but they are not applied to task execution.

**Impact:** A malicious task can exhaust node resources or escape isolation.

**Fix (Phase 2):** All task execution must enforce:
```
--cpus=<limit>
--memory=<limit>
--pids-limit=<limit>
--read-only filesystem where possible
--network=none (or restricted)
--timeout
```
For inference tasks (Ollama), enforce `AbortSignal.timeout()` and per-request resource limits.

---

#### 🔴 SEC-04: Multiple update paths with different security properties

**Files:**
- `src/index.ts:606` — safest: snapshot + rollback + tsc verify
- `src/gateway/server.ts:504-649` — API-triggered update: git pull, 3 variations
- `src/swarm/agent.ts:440` — agent update: no `--include=dev` in rollback path (line 509)
- `src/naas/uptime_daemon.ts:394` — NaaS update (unverified)

**Problem:** Four separate update implementations with different safety guarantees. `swarm/agent.ts:509` rollback does `npm install` without `--include=dev`, meaning `tsc` may not be available after rollback. The gateway update API (`/api/update`) lacks authentication — any caller on the local network can trigger it.

**Fix:**
1. Single canonical update function in `src/lib/updater.ts`, called from all paths.
2. Gateway `/api/update` must require admin auth (dashboard PIN or Ed25519).
3. All update paths must use signed manifests (PLATFORM_SIGNING_ENFORCED already in platform-auth.ts).
4. Rollback path must use `npm install --include=dev` consistently.

---

### P1 — Fix Before Production / Phase 3

#### 🟡 SEC-05: `gateway/server.ts` exposes host system commands via HTTP

**Lines:** 2590-2597 (certbot/SSL), 2911-2920 (SSH hardening), 2933-2934 (apt-get upgrade)

**Problem:** The dashboard HTTP server exposes endpoints that run `sudo` commands on the host: `apt-get upgrade`, modifying `sshd_config`, `systemctl reload sshd`. These run as the node process user.

**Impact:** Anyone who can reach the dashboard port (8080) can trigger system-level operations.

**Fix:**  
- Move these behind the dashboard PIN auth (already exists for some endpoints).  
- Consider removing from the default profile entirely — see spec §24.

---

#### 🟡 SEC-06: SSH config reading exposed via API

**File:** `src/gateway/server.ts:2899-2904`  
```typescript
this.app.get('/api/system/ssh', ...
    const sshConfig = readFileSync('/etc/ssh/sshd_config', 'utf-8').split('\n');
```

**Problem:** SSH configuration is exposed over HTTP. Even if read-only, this leaks host security posture.

**Fix:** Remove from default node profile. If needed, restrict to localhost-only.

---

#### 🟡 SEC-07: Validator manager downloads and executes external binaries

**File:** `src/validators/manager.ts:344-360`  
Downloads `lite-client`, `helios`, `bitcoind` from hardcoded URLs using `curl | tar | chmod +x`.

**Problem:** No hash verification before execution. A compromised download URL serves a malicious binary.

**Fix:** Add SHA256 checksum verification before executing any downloaded binary. This module is already marked as EXPERIMENTAL and should be behind a flag.

---

#### 🟡 SEC-08: Skills marketplace installs external code without sandboxing

**File:** `src/skills/marketplace.ts:217`  
```typescript
execSync(`git clone --depth 1 ${cloneUrl} "${skillDir}"`)
```
Skills are cloned and can contain arbitrary code. The audit function (`lines:365-370`) checks for obvious patterns but cannot prevent sophisticated attacks.

**Fix:** Skills must run in sandboxed processes with resource limits. Move behind `GSTD_SKILLS_ENABLED` flag.

---

#### 🟡 SEC-09: Apps manager runs Docker containers from a central registry

**File:** `src/apps/manager.ts:1223` — `docker pull ${manifest.docker!.image}`

**Problem:** Images are pulled from whatever registry the manifest specifies. No image hash pinning.

**Fix:** Require `image@sha256:<hash>` format. Move behind `GSTD_APPS_ENABLED` flag.

---

### P2 — Phase 3+

#### 🟢 SEC-10: No replay protection on tasks

**Problem:** The current task format (central KV-based) has no `nonce` or `expires_at` field. A replayed task request could be executed multiple times.

**Fix (Phase 2):** Task format must include `task_id` (unique), `created_at`, `expires_at`, and `requester_signature`. Nodes must reject tasks with `expires_at < now` or already-seen `task_id`.

---

#### 🟢 SEC-11: P2P messages have no replay protection

**File:** `src/p2p/attestation.ts`

**Problem:** Attestation signatures cover `taskId + resultHash + nodeId + timestamp` but there is no mechanism to reject replayed attestations.

**Fix (Phase 3):** Track recently seen `(taskId, nodeId)` pairs in memory with TTL. Reject duplicates.

---

#### 🟢 SEC-12: `curl ... | bash` installation

**File:** `src/index.ts:546`, `src/channels/telegram.ts:1542`  
The install instruction uses `curl -fsSL ... | bash`.

**Problem:** No signature on the install script. Compromised GitHub or CDN serves arbitrary code.

**Fix (Phase 5/25):** Publish signed release manifests with SHA256. Install script should verify the signature before executing.

---

## What Is Already Good

| Item | File | Notes |
|------|------|-------|
| P2P identity separate from TON wallet | `p2p/p2p-identity.ts` | Ed25519 key never used for TON signing |
| Signed platform command verification | `lib/platform-auth.ts` | Ed25519 verify already implemented |
| Circuit breaker for platform calls | `lib/platform-health.ts` | Prevents cascade failures |
| Content guardian (Telegram) | `channels/guardian.ts` | Filters dangerous prompts |
| Private key never logged | `index.ts` | Only pubkey prefix is logged |
| GSTD_WALLET_ADDRESS vs mnemonic | `index.ts` | Address path exists; mnemonic is optional |
| Auto-update rollback | `index.ts:672-688` | Rolls back on tsc failure |
| Rate limiting (usage tracker) | `core/usage-tracker.ts` | Per-user request limits |

---

## Modules to Gate Behind Feature Flags (Spec §23)

| Module | Flag | Files |
|--------|------|-------|
| NaaS | `GSTD_NAAS_ENABLED` | `src/naas/*.ts` (7 files) |
| Bridge | `GSTD_BRIDGE_ENABLED` | `src/blockchain/bridge.ts` |
| Federated training | `GSTD_TRAINING_ENABLED` | `src/training/*.ts` (6 files) |
| Collective memory | `GSTD_MEMORY_ENABLED` | `src/memory/collective.ts` |
| Validators / multi-chain | `GSTD_VALIDATORS_ENABLED` | `src/validators/manager.ts` |
| GPU compute marketplace | `GSTD_COMPUTE_ENABLED` | `src/compute/marketplace.ts` |
| Skills marketplace | `GSTD_SKILLS_ENABLED` | `src/skills/marketplace.ts` |
| Apps manager | `GSTD_APPS_ENABLED` | `src/apps/manager.ts` |
| Remote access | `GSTD_REMOTE_ENABLED` | `src/network/remote.ts` |

**Default for all flags: `false`**

The node default profile (spec §24) exposes only: P2P, task protocol, verification, AI compute, health.
