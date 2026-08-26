# Full Functional Audit — Design

**Repo:** gstdbot
**Scope:** Sub-project F of the current work arc (follows the resilience-fix, dashboard-reliability-fix, and decentralized-discovery sub-projects already shipped this cycle). This covers the ENTIRE gateway API surface — not just what the dashboard calls (that was dashboard-reliability-fix's deliberately narrower scope) — plus anything else in the node's runtime that can silently fail. Companion sub-project G (dashboard visual redesign) is separate and does not depend on this one completing first.

## Problem

The user asked for a full functional verification with "no non-working parts" — no scope qualifier. `src/gateway/server.ts` (4590 lines) registers 149 distinct Express routes. Dashboard-reliability-fix earlier this session audited only the subset the dashboard UI actually calls, and found a consistent bug pattern: backend and frontend silently drifting apart on field names, response shapes, and endpoint paths (e.g. `mods.installed` vs `mods.models`, `/api/ollama/models/pull` vs `/api/ollama/pull`, `d.pin_list` vs `d.pins`). There is no reason to believe that pattern is confined to dashboard-visible routes — most of the 149 routes have callers OTHER than the dashboard (the Telegram bot, the mobile miniapp, the `gstd-a2a` Python SDK, the `gstdai` platform calling back into the node, external API consumers per `README.md`'s documented `/v1/chat/completions` OpenAI-compatible endpoint, or the node's own internal cron/scheduler), and those integration points have had zero systematic verification this session.

One concrete example already found just by reading the route list while scoping this spec: `POST /api/memory/recall` is registered twice — `server.ts:2119` and `server.ts:4309`. Express dispatches to the first match only; the handler at `:4309` is permanently unreachable dead code, silently. This is exactly the class of bug this audit exists to find — not a hypothetical.

## Goal

Every one of the 149 routes ends the audit in one of three known states, each handled differently:
1. **Verified working** — a real caller exists (in this repo, in a sibling repo, or is a documented external contract), and the request/response shapes genuinely match on both ends.
2. **Fixed** — a real caller exists but something was broken (field mismatch, wrong path, dead branch, unreachable duplicate registration, swallowed error that should surface, etc.) — fixed and re-verified.
3. **Confirmed dead, left alone or explicitly flagged** — no caller exists anywhere findable. Not every dead route needs deleting (some are pre-provisioned for features shipping later, e.g. sub-projects C/D/E's future needs) — but every dead route gets a decision recorded (keep as-is with a note, or remove), not silent ambiguity. Deletion is NOT default behavior — a route can be legitimately unused today and still intentional; removing working code the audit doesn't fully understand the purpose of is exactly the kind of "add scope beyond the task" the process should avoid. Default to flagging, not deleting, unless the audit can show with real evidence (e.g., grep across every sibling repo) that a route is genuinely vestigial (references a removed feature, an old field name, a discontinued flow).

No route gets a "looks fine" verdict without evidence — a route inspected only by reading its own handler in isolation, with no check of who calls it or whether the shapes match, is not verified.

## Approach

### 1. Domain grouping

149 routes grouped into 13 domains by what they do, each independently auditable (few cross-domain interface dependencies — this is mostly a breadth problem, not a depth problem, unlike the decentralized-discovery sub-project):

| Domain | Route prefix examples | Approx. count |
|---|---|---|
| Auth & system security | `/api/auth/*`, `/api/security/status`, `/api/ssl/*`, `/api/system/*`, `/api/dns/*` | ~17 |
| Node core status/config/lifecycle | `/api/node/status`, `/config`, `/settings`, `/overview`, `/hardware`, `/log`, `/diagnostics`, `/events`, `/ws/clients`, `/usage*`, `/scheduler*`, `/platform`, `/naas`, `/models/health`, `/check-update`, `/api/update*`, `/node/update`, `/restart`, `/stop`, `/control`, `/fund`, `/dln`, `/my-nodes`, `/rating`, `/resources` | ~26 |
| Wallet & earnings | `/api/node/wallet`, `/earnings`, `/rewards`, `/pending-rewards`, `/claim-rewards`, `/bind-wallet`, `/unbind-wallet`, `/api/wallet/*`, `/api/auth/wallet`, `/api/rewards/*` | ~13 |
| Models, chat, inference | `/api/ollama/models*`, `/v1/models`, `/v1/chat/completions`, `/v1/ollama/completions`, `/v1/dashboard/chat`, `/api/v1/chat`, `/api/v1/free-api/*`, `/api/chat/history`, `/v1/skills`, `/v1/sovereignty`, `/v1/swarm/status`, `/api/swarm/*` | ~13 |
| Apps (NaaS Docker) | `/api/apps/*` | ~9 |
| IPFS / storage | `/api/storage*`, `/api/vaults` | ~6 |
| Peers / mesh / network | `/api/peers*`, `/api/links`, `/api/oracle/stats` | ~5 |
| Validators & blockchain | `/api/validator/*`, `/api/validators*`, `/api/enterprise/*`, `/api/premium/*` | ~9 |
| Tasks / compute marketplace | `/api/tasks/*` | ~4 |
| Training / federated learning | `/api/training/*`, `/api/memory/*` | ~13 |
| Resources / traffic relay | `/api/resources/*` | ~5 |
| Telegram / remote access | `/api/telegram/*`, `/api/remote/*` | ~5 |
| Root / health / misc | `/`, `/health`, `/apps/:appId` | ~3 |

### 2. Per-route verification method (in priority order, cheapest first)

1. **Find every caller.** `grep` across: this repo's `web/dashboard.html`, `src/channels/telegram.ts`, `src/channels/miniapp.ts`, any other internal caller (`src/**`); then the sibling repos already cloned locally (`gstdai`, `gstd-a2a`, `gstdweb`) for anyone hitting this node's API from outside; then check `README.md`/`docs/` for a documented external contract (e.g. the OpenAI-compatible `/v1/chat/completions` promise). No caller found anywhere = dead-code path, handle per the Goal section above, skip shape verification (nothing to compare against).
2. **Compare shapes.** For a route with a real caller, read the handler's actual response construction and the caller's actual field access — not the caller's TYPE ANNOTATIONS if any exist without runtime validation, the actual code path. This is the check that caught nearly everything in dashboard-reliability-fix.
3. **Live-test where safe.** For read-only / idempotent GETs (status, list, config-read endpoints — the majority of the 149), actually curl them against the running node (`http://localhost:8080`, this Pi's live instance is already running and authenticated for local requests) and confirm real 200s with sane data, not just code-reading. For anything with a side effect (installs, restarts, wallet operations, blockchain writes, PIN changes, system commands) — code-review only, never invoke live; note in the report that live verification wasn't possible and why.
4. **Duplicate/unreachable registrations.** Explicitly grep for repeated route strings across the whole file (the `/api/memory/recall` case) — cheap, mechanical, and already proven to catch a real bug.

### 3. Execution model

Dispatched the same way the repo-docs audits (previous turn) and dashboard-reliability-fix (earlier this session) were: one subagent per domain group, running in parallel, each auditing AND fixing what it finds within its own domain (not just reporting) since these are mostly independent, bounded, mechanical-once-diagnosed fixes — matching this session's established pattern rather than a slower audit-then-separate-fix-pass split. Each domain agent commits its own fixes with a clear message. A controller-level pass afterward does: (a) a final cross-domain review for anything that touches shared code (e.g. `platformHealth`, `PeerManager`, auth middleware — a handful of routes in different domains share these), (b) consolidates the "confirmed dead" list for the user's decision, (c) the same test-verification discipline (tsc + vitest) as every other sub-project this session.

## Out of scope

- The dashboard's own visual/UX quality — that's sub-project G, entirely separate.
- Implementing new functionality for a dead route found to be a stub for a not-yet-built feature (e.g., something clearly reserved for sub-project C/D/E) — flag and leave alone, don't build ahead of plan.
- Changing the API contract for routes with real EXTERNAL callers (gstd-a2a SDK, gstdai platform) without flagging the cross-repo impact first — a shape mismatch between this node and an external caller might need the fix on the OTHER side, not here; the audit records which side the fix belongs on rather than always patching gstdbot.

## Testing

Same bar as every other sub-project this session: `tsc --noEmit` and `npx vitest run` clean after all fixes, plus the domain-specific live-curl checks described above where safe. No plan task may skip verification in favor of "looks right."
