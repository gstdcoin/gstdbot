# GSTD Node OS — Repository Audit
**Date:** 2026-08-28  
**Spec:** GSTD Protocol v0.1  
**Auditor:** Claude Code

---

## 1. Repository Overview

| Metric | Value |
|--------|-------|
| Source files | 72 `.ts` files in `src/` |
| Total lines (src) | ~26,900 |
| Largest file | `src/gateway/server.ts` — 4,784 lines |
| Test files | 9 (126 test cases) |
| Node version | 20.x |
| Primary language | TypeScript |
| P2P library | libp2p@3.1.6 |
| Current version | 3.5.0 |

---

## 2. Existing Components — Status

### ✅ Working and Worth Keeping

| Module | File | Status | Notes |
|--------|------|--------|-------|
| P2P node (libp2p) | `src/p2p/node.ts` | Working | WebSocket + TCP transport, KAD-DHT, mDNS |
| Node identity (Ed25519) | `src/p2p/identity.ts` | Working | Sign/verify, pubkey derivation |
| Persistent peerId | `src/p2p/p2p-identity.ts` | Working | Saved to `~/.config/gstdbot/p2p-identity.json` |
| Peer bootstrap | `src/p2p/peers.ts` | Working | GitHub seeds + platform fallback |
| Quorum attestation | `src/p2p/attestation.ts` | Working | Ed25519 multi-node result signing |
| Quorum coordinator | `src/p2p/quorum-coordinator.ts` | Working | 2-of-3 consensus for task results |
| Platform command auth | `src/lib/platform-auth.ts` | Working | Verifies signed platform commands |
| Gateway HTTP server | `src/gateway/server.ts` | Working | Dashboard, inference API, admin |
| Gateway router | `src/gateway/router.ts` | Working | Local Ollama → model routing |
| TON wallet | `src/wallet/wallet.ts` | Working | V4 contract, balance, sends |
| TON wallet manager | `src/wallet/manager.ts` | Working | In-memory key, earnings tracking |
| Model registry | `src/lib/model-registry.ts` | Working | Hash/license/requirements manifest |
| Demand tracker | `src/lib/demand-tracker.ts` | Working | Per-model request scoring |
| Platform health | `src/lib/platform-health.ts` | Working | Circuit breaker for central API |
| Usage tracker | `src/core/usage-tracker.ts` | Working | Per-user request accounting |
| Event bus | `src/core/event-bus.ts` | Working | Internal event routing |
| Telegram bot | `src/channels/telegram.ts` | Working | grammy, user AI, commands |
| Mini app | `src/channels/miniapp.ts` | Working | Telegram webapp bridge |
| Diagnostics | `src/core/diagnostics.ts` | Working | Self-check at startup |
| Auto-update | `src/index.ts:606-693` | Working | git pull + tsc + rollback |

### ⚠️ Exists but Requires Review

| Module | File | Issue |
|--------|------|-------|
| Swarm agent | `src/swarm/agent.ts` | Polls central API for tasks; remote command without local auth |
| Platform link | `src/core/platform-link.ts` | Heartbeat + central command loop — must become optional |
| NaaS daemon | `src/naas/uptime_daemon.ts` | Registers/heartbeats to central platform — must become optional |
| Remote access | `src/network/remote.ts` | Token-based SSH/tunnel management — needs audit |
| App manager | `src/apps/manager.ts` | Docker app execution from central registry |
| Node lite | `src/node-lite/index.ts` | Standalone entry point, polls central |

### 🔴 Experimental / Move Behind Flag

| Module | Files | Reason |
|--------|-------|--------|
| NaaS | `src/naas/` (7 files) | Unproven, attacks surface |
| Bridge | `src/blockchain/bridge.ts` | Deferred by design |
| Federated training | `src/training/` (6 files) | Complex, not P2P-native yet |
| Collective memory | `src/memory/collective.ts` | Unverified distributed design |
| Multi-chain validators | `src/validators/manager.ts` | Downloads + runs external binaries |
| Compute marketplace | `src/compute/marketplace.ts` | Docker execution without sandbox |
| Skills marketplace | `src/skills/marketplace.ts` | Downloads + installs external code |
| Revenue flywheel | `src/naas/revenue_flywheel.ts` | Multi-chain, not core |

### ❌ Dead / Remove

| File | Reason |
|------|--------|
| `src/coverage/relay.ts` | Relay stub — no real implementation |
| `src/odysseus/adapter.ts` | Unused adapter |
| `src/odysseus/detector.ts` | Unused |

---

## 3. Task Routing — Current vs Target

### Current path (all tasks)
```
User/Telegram
    ↓
platform.gstdtoken.com (central KV)
    ↓
core/platform-link.ts ← polls every ~5 min
    ↓
swarm/agent.ts (task execution)
    ↓
Ollama (inference)
    ↓
result → central platform
```

### P2P code that exists but is NOT in the task path
```
P2P node (libp2p)          — peer discovery only
Quorum coordinator         — co-execution verification only
Attestation                — result signing only
```

**The P2P layer does not carry tasks. It is only used for quorum attestation.**

### Target path (Phase 4+)
```
User/Telegram
    ↓
Any GSTD gateway node
    ↓
P2P routing (capabilities match)
    ↓
Executing node (Ollama)
    ↓
Signed result → quorum verification
    ↓
Settlement record (TON)
```

---

## 4. Test Coverage

| File | Cases | What it tests |
|------|-------|---------------|
| `src/swarm/agent.test.ts` | ~40 | Agent lifecycle, quorum, task execution |
| `src/p2p/identity.test.ts` | ~15 | Ed25519 sign/verify, key derivation |
| `src/p2p/peers.test.ts` | ~15 | Bootstrap peer parsing/selection |
| `src/lib/platform-auth.test.ts` | ~20 | Command signature verification |
| `src/lib/platform-health.test.ts` | ~10 | Circuit breaker behavior |
| `src/core/platform-link.test.ts` | ~10 | Heartbeat + command dispatch |
| `src/lib/model-registry.test.ts` | ~8 | Manifest hash/license checks |
| `src/lib/demand-tracker.test.ts` | ~5 | Demand scoring |
| `src/naas/rpc_proxy.test.ts` | ~3 | RPC proxy basics |
| `tests/p2p-quorum-live.ts` | manual | Live quorum test script |

**Missing tests:** task routing, sandbox enforcement, replay protection, peer failure recovery, result verification, TON settlement.

---

## 5. Phase Roadmap — Scope Assessment

The spec covers 9 phases. Each must be a separate implementation cycle.

| Phase | Scope | Estimated complexity |
|-------|-------|---------------------|
| 0 | Audit (this document) | Done |
| 1 | Node Core: identity, capabilities, secure messaging | Medium |
| 2 | Task Protocol: P2P routing, canonical task format, signed results | High |
| 3 | Verification: classes, reputation, failure handling | High |
| 4 | Decentralize: platform API → optional/disabled | Medium |
| 5 | Pi Alpha: multi-node test without central platform | Medium |
| 6 | TON Settlement: verified work → on-chain | High |
| 7 | Telegram: interface over protocol | Medium |
| 8 | Website: public dashboard | Low |
| 9 | Advanced: NaaS, federated, storage, bridge | High |
