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

## Now / Next (concrete, scoped to what this repo can actually execute)

Given real constraints (one Pi for testing, no GPU budget, limited session
budget), the next work is deliberately narrow — a handful of concrete,
self-contained fixes, not a re-run of the full audit or a rewrite:

1. **RPC proxy fail-closed** (`src/naas/rpc_proxy.ts`): when the platform
   payment-check API is unreachable, the proxy currently allows the request for
   free rather than rejecting it — a real, if currently low-traffic (NaaS is
   disabled by default), economic hole. Fix: fail closed (503/402), not open.
2. **Model-routing transparency** (`src/gateway/router.ts`): when a requested
   model is silently mapped to a different local model, surface both
   `requested_model` and `actual_model` in the response rather than silently
   substituting. Small, honest, cheap.
3. **Dashboard redesign execution**: the 10-task plan is already written
   (`docs/superpowers/plans/2026-08-26-dashboard-redesign.md`) but not yet run.

## Deliberately deferred (not because they're unimportant — because they're not next)

- **Signed remote commands / signed updates.** The chat's single most important
  security recommendation: the platform should never be able to make a node run
  an arbitrary command or install an unsigned binary; commands and update
  artifacts should carry a signature the node verifies against a baked-in
  public key before acting. This repo's audit already closed every *missing
  auth* instance of remote-command routes this cycle — but auth (is the caller
  who they claim) is a different property than integrity (is this specific
  command one the platform operator actually issued, unmodified). Doing this
  properly means changes on the platform side (`gstdai`) too, not just here —
  it's a real cross-repo project, not a one-file patch, so it's named here and
  deliberately not started this cycle rather than attempted half-finished.
- **Node UI mode split (Simple/Advanced/Developer), hiding non-core
  functionality by default.** A good idea, bigger than the already-scoped
  dashboard-redesign plan (which is a visual/consistency pass, not a
  feature-visibility redesign). Worth its own spec once the redesign plan
  lands and there's a stable baseline to build the mode split on top of.
- **Model Registry with manifest/hash/license verification and demand-based
  scoring.** A real, well-reasoned idea from the analysis, but it's a new
  subsystem, not a fix — needs its own brainstorming → spec → plan cycle, and
  isn't blocking anything currently broken.
- **GSTD Passport / XP system / Telegram growth mechanics.** These are
  `gstdai`/`gstdweb`/Telegram-bot-repo concerns, not `gstdbot`. Noted here for
  continuity across the ecosystem, not actioned in this repo.
- **Wallet/node-identity process separation** (separate `gstd-agent` /
  `gstd-worker` / `gstd-updater` processes, wallet signing isolated from the
  main node process). A real architectural improvement the analysis raises,
  but a multi-week restructuring, not something to start opportunistically
  alongside smaller fixes. Tracked here so it isn't forgotten, not scheduled.

## What not to do (explicit, so it isn't re-litigated)

- Do not build a GSTD-native blockchain, consensus, or VM. TON is the
  settlement layer; keep it that way.
- Do not expand NaaS chain coverage before the RPC fail-open bug above is
  fixed and one chain (whichever is easiest to test on the Pi) is proven
  end-to-end.
- Do not resume work on `gstd-bridge` from this repo or spend this repo's
  audit/security budget on it — it's a separate, already-flagged-deferred
  project.
- Do not add more AI models to the default catalog without a real reason
  (demand, a gap in size tiers) — the analysis's core warning ("don't build a
  network for useless models") applies directly to this repo's Ollama model
  list.
