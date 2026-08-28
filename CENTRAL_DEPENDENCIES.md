# GSTD — Central Platform Dependencies
**Date:** 2026-08-28  
**Target:** platform.gstdtoken.com → OPTIONAL by Phase 4

Classification:
- **CRITICAL** — node cannot function without this call
- **OPTIONAL** — node works but loses a feature
- **LEGACY** — call targets endpoints that no longer exist or are not needed
- **MONITORING** — informational only, safe to remove

---

## Summary

| Category | Count | Files |
|----------|-------|-------|
| CRITICAL | 5 | platform-link.ts, uptime_daemon.ts, swarm/agent.ts, index.ts |
| OPTIONAL | 12 | dashboard, telegram, cli, peers bootstrap fallback |
| LEGACY | 14 | revenue, wallet queries, bridge, marketplace, storage |
| MONITORING | 3 | dashboard rewards, diagnostics |
| **Total** | **34** | |

---

## CRITICAL — Remove from Critical Path in Phase 4

### 1. `src/core/platform-link.ts` — heartbeat + command polling
**Role:** The node continuously heartbeats to platform.gstdtoken.com and polls for platform commands (update, restart, etc.)  
**Impact if offline:** Node still runs but loses ability to receive platform-signed commands. Already has 402/500 error handling.  
**Phase 4 action:** Feature-flag with `GSTD_PLATFORM_ENABLED=false`; commands must be receivable via P2P instead.

### 2. `src/naas/uptime_daemon.ts` — registration + heartbeat
**Lines:** 19, 124, 216  
**Role:** Registers the node at startup (`POST /api/v1/nodes/register`) and heartbeats every 8 min (`POST /api/v1/nodes/heartbeat`).  
**Impact if offline:** Node is not listed on platform dashboard; NaaS earnings not credited.  
**Phase 4 action:** Move behind `GSTD_NAAS_ENABLED` flag. P2P discovery replaces registration.

### 3. `src/swarm/agent.ts` — task polling
**Line:** 407 (command execution via `executeRemoteCommand`)  
**Role:** Polls platform for tasks, receives commands (restart, stop, update, health_check).  
**Impact if offline:** No tasks received via central path.  
**Phase 4 action:** P2P task routing replaces this. Keep as fallback behind flag.

### 4. `src/index.ts:255,372,399` — swarmUrl / apiUrl defaults
**Role:** Platform URL baked into `GatewayConfig` as default.  
**Phase 4 action:** Default becomes empty string or local-only mode; P2P is default.

### 5. `src/gateway/server.ts:533` — update endpoint
**Role:** `/api/update` fetches and applies updates using git; calls platform URL for changelog.  
**Impact if offline:** Update flow still works (git pull from GitHub directly).  
**Phase 4 action:** Update via signed manifest (already has platform-auth.ts for this). Remove platform URL dependency.

---

## OPTIONAL — Degrade Gracefully, Lower Priority

| File | Line | Use | Action |
|------|------|-----|--------|
| `src/dashboard/server.ts` | 195,207 | Node stats from platform | Replace with local P2P stats |
| `src/dashboard/server.ts` | 238,249,260,293 | Rewards display | Move behind NaaS flag |
| `src/channels/telegram.ts` | 297,366,368,561,1509 | Links in messages | Update to new URLs or P2P endpoint |
| `src/cli/index.ts` | 58,60,213,276,418,781 | CLI swarm commands | Add `--platform-url` flag, default to local node |
| `src/p2p/peers.ts` | 135-137 | Bootstrap fallback to platform | Already has P2P fallback; remove platform call |
| `src/gateway/router.ts` | 467 | Market price from platform | Optional, remove or cache |
| `src/tools/quality-eval.ts` | 86 | NeuralRouter via platform | OPTIONAL; behind flag |
| `src/node-lite/index.ts` | 24 | Standalone node polls platform | Move behind flag |

---

## LEGACY — Remove or Replace (Phase 1+)

| File | Line | Use | Action |
|------|------|-----|--------|
| `src/revenue/engine.ts` | 61 | Revenue API calls | Replace with on-chain queries (TON) |
| `src/wallet/manager.ts` | 325 | Wallet rewards query | Replace with local ledger + TON |
| `src/wallet/wallet.ts` | 38 | Balance/earnings API | Replace with TON RPC |
| `src/blockchain/token.ts` | 72 | Token price/info | Use STON.fi or TON directly |
| `src/blockchain/bridge.ts` | 67 | Bridge API | Deferred module; stays behind flag |
| `src/naas/revenue_flywheel.ts` | 14 | Multi-chain earnings | EXPERIMENTAL; behind flag |
| `src/naas/orchestrator.ts` | 20 | NaaS orchestration API | EXPERIMENTAL; behind flag |
| `src/compute/marketplace.ts` | 72 | GPU marketplace API | EXPERIMENTAL; behind flag |
| `src/apps/manager.ts` | 964 | App registry | EXPERIMENTAL; behind flag |
| `src/storage/vault.ts` | 56 | Encrypted storage API | EXPERIMENTAL; behind flag |
| `src/naas/rpc_proxy.ts` | 54 | RPC charge endpoint | EXPERIMENTAL; behind flag |

---

## MONITORING — Safe to Remove

| File | Line | Use |
|------|------|-----|
| `src/gateway/server.ts` | 1680 | Unified monitor fetch |
| `src/gateway/server.ts` | 2666 | Second monitor fetch |
| `src/core/diagnostics.ts` | 169 | GSTD_SWARM_URL in error hint |

---

## Feature Flags to Add (Phase 4)

```typescript
// .env / environment variables
GSTD_PLATFORM_ENABLED=false    // disable central heartbeat + command polling
GSTD_NAAS_ENABLED=false        // disable NaaS uptime daemon
GSTD_P2P_ROUTING=true          // use P2P task routing (Phase 4 default)

// Feature flag check pattern
if (process.env.GSTD_PLATFORM_ENABLED !== 'false') {
    // start platform-link, uptime_daemon
}
```

---

## Files That Can Operate With No Platform

Once flags are added, the following modules work with zero central dependencies:

```
src/gateway/server.ts       ← local inference + admin
src/gateway/router.ts       ← local model routing (Ollama)
src/p2p/node.ts             ← P2P discovery
src/p2p/attestation.ts      ← result signing
src/p2p/quorum-coordinator.ts ← multi-node verification
src/wallet/wallet.ts        ← TON direct (RPC)
src/channels/telegram.ts    ← local AI (no platform needed)
src/lib/model-registry.ts   ← local manifest
src/lib/demand-tracker.ts   ← local demand
```
