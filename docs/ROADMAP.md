# GSTD Node Roadmap

This document reconciles three things: what's actually built and verified in this
repo today, an external strategic/technical analysis of the project (a ChatGPT
conversation the operator shared, referenced below), and a realistic path forward
given real constraints — one Raspberry Pi 4 for testing, no GPU budget, and an
AI pair-programmer (Claude Code) doing the implementation. It exists so the plan
survives between sessions instead of living only in chat history.

**Source analysis:** the operator shared an external technical review and roadmap
discussion (2026-08-27) that independently reached several conclusions matching
this repo's own audit history this cycle — most importantly: the project's real
core value is the AI node network + P2P, not the 10+ adjacent subsystems (bridge,
rendering, storage, RPC marketplace, federated learning) that currently exist as
partial implementations or scaffolds. That analysis is not reproduced verbatim
here; this document is the actionable synthesis of it plus this repo's own,
independently-verified findings.

## Where the project actually stands (verified, not aspirational)

As of the most recent full-functional-audit sub-project (13 domains, 149 routes,
see `docs/superpowers/plans/2026-08-26-full-functional-audit.md` and its ledger):

- **Real and working:** node runtime (`src/index.ts` boots ~17 subsystems), local
  Ollama-backed AI inference, the platform task-poll/heartbeat loop, the
  dashboard, Telegram bot, P2P mesh (libp2p: TCP/Noise/Yamux, mDNS + Kademlia
  DHT, just shipped this cycle — see `docs/superpowers/specs/2026-08-25-decentralized-discovery-design.md`),
  quorum/attestation scaffolding for task verification, Docker/NaaS orchestration
  (thin — mostly `docker run` with resource limits, not real production chain
  operations), LoRA fine-tuning (a real Python subprocess pipeline, not a stub).
- **Confirmed fake/simulated, not to be marketed as real:** GPU rendering
  (`processRender()` sleeps and returns a fake hash), storage (task processing
  just writes into in-memory collective memory, no erasure coding/replication/
  proof-of-storage), several routes' "signature verification" (`gstd-node-auth`,
  `gstd-premium` hardcoded salts — a hash of public data, not real cryptography;
  the one live-exploitable instance, `/api/auth/wallet`, was found and disabled
  this cycle).
- **Confirmed dangerous, now fixed:** 9 of 13 audited domains had a real
  missing-auth vulnerability on a side-effecting route; the single worst was a
  full unauthenticated admin-access bypass (`/api/auth/wallet`), live-exploited
  against the running node as proof, then fixed and deployed the same session.
  See the audit ledger for the complete list — nothing below is asking you to
  rediscover those.
- **Confirmed thin/aspirational:** the RPC marketplace (`src/naas/rpc_proxy.ts`)
  fails OPEN when the payment API is unreachable (allows the request for free
  rather than rejecting it) — a real economic bug, not yet fixed as of this
  writing (see Now/Next below). Model routing silently substitutes a different
  local model than the one requested (e.g. `openai/gpt-oss-120b` → local
  `llama3.1:70b`) with no signal to the caller — not a bug exactly, but not
  honest either.
- **Explicitly out of scope, do not build on top of:** `gstd-bridge` (cross-chain
  bridge) is its own repo, already marked `deferred/not deployed` with no real
  MPC threshold signatures and no production validators — leave it there.

## Architectural principle (locked in, per the operator's explicit direction)

> The network has no central server. The website and Telegram bot are
> interfaces. Nodes are the compute network. Contracts are the trust/settlement
> layer. If the website goes down, the network keeps working. If the Telegram
> bot goes down, nodes keep working. If one node disappears, its tasks move to
> another node.

This is *why* the decentralized-discovery work (DHT + mDNS peer discovery,
central registry demoted to last-resort fallback) was the first major
sub-project this cycle, not an afterthought. It is also why Task 7 of the
functional audit (unauthenticated peer data feeding the P2P inference-routing
trust model) was treated as seriously as the auth-bypass findings — a
P2P-first network's biggest risk isn't a missing login screen, it's letting an
unverified peer earn real routing trust.

Contracts (TON) are for token/settlement/trust, never for executing AI
inference directly — that's what the node network is for. This repo does not
and should not grow its own blockchain, consensus, or VM.

## Module status (per the chat's own suggested three-tier system)

| Module | Status | Notes |
|---|---|---|
| Node runtime, identity, heartbeat | PRODUCTION | Verified across 13 audit domains |
| AI inference (local Ollama) | PRODUCTION | Real execution path, task poll/complete loop confirmed |
| Dashboard | PRODUCTION (visual pass pending) | See `docs/superpowers/plans/2026-08-26-dashboard-redesign.md` — written, not yet executed |
| P2P mesh (DHT + mDNS) | PRODUCTION (WAN bootstrap blocked) | Needs one human-provisioned stable DNS record before real WAN bootstrap works — see the decentralized-discovery spec |
| Quorum/attestation | BETA | Best-effort, doesn't yet block the centralized `/tasks/complete` path |
| Wallet / TON Connect | PRODUCTION (this cycle's fixes deployed) | Auth-bypass and wallet-hijack routes fixed and deployed |
| NaaS / Docker orchestration | BETA, narrow scope only | Real for TON/XRPL/Bitcoin/Ethereum RPC; do not expand chain coverage until the RPC fail-open bug is fixed and one chain is proven end-to-end |
| Federated learning / LoRA | BETA | LoRA fine-tuning subprocess pipeline is real; distributed FedAvg training loop is a framework, not a running marketplace |
| Storage | EXPERIMENTAL | Do not market as Storj/Filecoin-equivalent |
| Rendering | EXPERIMENTAL (simulated) | `processRender()` is a stub; do not enable in any default build |
| Cross-chain bridge (`gstd-bridge`) | EXPERIMENTAL, separate repo | Not production, no audit budget spent here this cycle |

## Completed this cycle (2026-08-27/28)

All "Now/Next" and most deferred items from the original roadmap have been
executed and pushed. Summary of what shipped:

| Item | Commit(s) | Status |
|---|---|---|
| RPC proxy fail-closed (`src/naas/rpc_proxy.ts`) | `2e4f2fc` | ✅ Done |
| Model-routing transparency (`router.ts`, `server.ts`) | `2e4f2fc` | ✅ Done |
| Dashboard redesign (all 9 tabs, design tokens, skeletons) | `98863e7` | ✅ Done |
| Signed remote commands (Ed25519 gate, fail-closed) | `c23b4b8` | ✅ Done |
| Signed update manifests (fail-open + PLATFORM_SIGNING_ENFORCED) | `c23b4b8` | ✅ Done |
| Node UI mode split (Simple/Advanced/Developer, localStorage) | `91f88e9` | ✅ Done |
| Model Registry (static allowlist, demand tracker, heartbeat filter) | `dae15b8` | ✅ Done |
| Quorum as real gate (`canAttemptQuorum()`, `quorumGateFailed` stat) | `ed55c08` | ✅ Done |
| Node P2P discovery (DHT + mDNS, central registry last-resort) | earlier | ✅ Done |

## Now / Next

The cycle's original "Now/Next" list is fully done. Remaining concrete work:

1. **NaaS end-to-end verification** — NaaS/RPC is fail-closed and the proxy
   is wired, but no chain (TON/ETH/etc.) has been proven end-to-end on the Pi.
   Pick one chain (TON is most aligned with the token), verify the full
   payment → charge → forward → response path on a real request.
2. **WAN bootstrap DNS record** — P2P mesh works on LAN (mDNS) but WAN
   bootstrap requires one stable DNS record (a `/dns4/…/tcp/…/p2p/…` bootstrap
   multiaddr). Human-provisioned, not a code task — but blocking real multi-node
   WAN operation.

## Deliberately deferred (still not next)

- **GSTD Passport / XP system / Telegram growth mechanics.** These are
  `gstdai`/`gstdweb`/Telegram-bot-repo concerns, not `gstdbot`. Noted here for
  continuity across the ecosystem, not actioned in this repo.
- **Wallet/node-identity process separation** (separate `gstd-agent` /
  `gstd-worker` / `gstd-updater` processes, wallet signing isolated from the
  main node process). A real architectural improvement, but a multi-week
  restructuring — not something to start opportunistically. Tracked here so it
  isn't forgotten, not scheduled.

## What not to do (explicit, so it isn't re-litigated)

- Do not build a GSTD-native blockchain, consensus, or VM. TON is the
  settlement layer; keep it that way.
- Do not expand NaaS chain coverage before one chain (TON is the natural
  first candidate) is proven end-to-end on the Pi.
- Do not resume work on `gstd-bridge` from this repo or spend this repo's
  audit/security budget on it — it's a separate, already-flagged-deferred
  project.
- Do not add more AI models to the default catalog without a real reason
  (demand, a gap in size tiers) — the analysis's core warning ("don't build a
  network for useless models") applies directly to this repo's Ollama model
  list.
