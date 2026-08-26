# Full Functional Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every one of the 149 routes registered in `src/gateway/server.ts` ends this plan verified working (real caller, matching shapes), fixed (caller existed, something was broken), or confirmed dead (no caller found anywhere, reported not deleted).

**Architecture:** No new files. One task per domain group of routes (13 tasks), each self-contained: find real callers, compare actual response shape against actual caller field access, fix mismatches, live-curl safe read-only routes against the running node, flag dead routes without deleting them. A final consolidation task collects dead-route findings and re-verifies shared infrastructure wasn't touched inconsistently across tasks.

**Tech Stack:** TypeScript/Node.js (Express gateway), vanilla JS/HTML frontend (`web/dashboard.html`), vitest for tests, `curl` for live verification.

**Spec:** `docs/superpowers/specs/2026-08-26-full-functional-audit-design.md`

## Global Constraints

- `node_modules/.bin/tsc --noEmit` and `npx vitest run` must stay clean after every task.
- No route's external contract (calls originating from the `gstd-a2a` Python SDK or the `gstdai` platform) may be changed without the task explicitly flagging the cross-repo impact in its report — never silently patch only gstdbot's side of an external contract.
- Dead-route findings (no caller found anywhere) are reported in the task's report file, never auto-deleted.
- The live production pm2 node on this Pi (process name `gstdbot`, port 8080) may be used for read-only `curl` checks only. Never restart it, stop it, or invoke any side-effecting endpoint against it (installs, uninstalls, wallet operations, PIN/auth changes, system commands, blockchain writes, model pulls/deletes).
- Sibling repos already cloned locally for cross-repo caller checks: `/home/bot/gstdai`, `/home/bot/gstd-a2a`, `/home/bot/gstdweb`.

## Shared Audit Methodology (applies to every domain task below — do not skip any step)

For every route listed in your task:

1. **Find every caller.** Grep, in this order, stopping once you find a real caller (but note if you found more than one):
   - `web/dashboard.html` (frontend JS `fetch(...)` calls)
   - `src/channels/telegram.ts`, `src/channels/miniapp.ts`
   - Any other internal caller under `src/**` (a route calling another route's logic directly, a cron/scheduler call)
   - `/home/bot/gstdai/**`, `/home/bot/gstd-a2a/**`, `/home/bot/gstdweb/**` (external callers — these are separate real repos already cloned locally)
   - `README.md` / `docs/**` in this repo for a documented external API contract (e.g. the OpenAI-compatible `/v1/chat/completions` promise)
   - No caller found anywhere = dead route. Report it in your task report under "Confirmed dead routes" with the exact grep commands you ran and their empty results as evidence. Do not delete it. Do not skip shape verification for it (there's nothing to compare against — just report it dead and move to the next route).

2. **Compare shapes.** For a route with a real caller: read the handler's actual `res.json({...})` (or equivalent) construction in `src/gateway/server.ts`, and read the caller's actual field access at the call site (not a TypeScript type annotation without runtime validation — the real code path). Fix any mismatch: wrong field name, wrong URL path, wrong HTTP method, wrong response shape (array vs object, nested vs flat), a field the caller reads that the handler never sends, a field the handler sends that doesn't match what the caller checks (e.g. truthy-checks a field that's always `0` or always present, defeating an intended conditional).

3. **Live-curl safe routes.** For GET routes with no side effects (status reads, list reads, config reads — most GETs in this codebase), curl the running node directly: `curl -s http://localhost:8080/api/whatever | head -c 2000`. Check `src/gateway/server.ts`'s auth middleware (search for `requireNodeAuth`, `authSessions`, PIN-check logic near the top of the `setupNodeOS()` method) to see whether a route needs a session token for a local curl or is open. If a GET route needs auth you don't have (no PIN configured in this session, no session token), note that in your report rather than skipping the shape-comparison step — code-reading verification of the response-construction code is still required even when live-curl isn't possible.

4. **Never invoke side-effecting routes live.** Anything that installs/uninstalls, restarts/stops, touches a wallet, changes PIN/auth, runs a system command, writes to blockchain/validator state, or pulls/deletes a model — code-review only. State this explicitly in your report for each such route ("not live-tested: side-effecting, verified via code review only").

5. **Check for duplicate route registrations.** Run `grep -n "app\.\(get\|post\|put\|delete\|patch\)('YOUR_ROUTE_PATH'" src/gateway/server.ts` for each route path in your domain against the WHOLE file (not just your domain's line range) — Express dispatches to the first matching registration only; a second registration of the same method+path is silently dead code. Report any duplicate found (fix it: the working one keeps its logic, the dead duplicate gets removed unless you determine from reading it that it actually contains the CORRECT/intended behavior and the first one is the one that's stale — use judgment, explain your reasoning in the report either way).

**Report file:** name it `.superpowers/sdd/2026-08-26-full-functional-audit/task-N-report.md` (the workspace script creates this directory). Structure: one subsection per route, verdict (✅ verified / 🔧 fixed / 💀 confirmed dead), evidence, and — for fixed routes — the diff you made.

---

### Task 1: Auth & System Security domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (18):**
```
1134  POST   /api/auth/setup
1155  POST   /api/auth/login
1181  GET    /api/auth/check
1196  POST   /api/auth/logout
1206  POST   /api/auth/change-pin
1262  POST   /api/auth/reset-pin-request
1293  POST   /api/auth/reset-pin-confirm
2281  GET    /api/security/status
2385  POST   /api/auth/wallet
2414  GET    /api/ssl/status
2428  POST   /api/ssl/setup
2460  GET    /api/dns/status
2473  POST   /api/dns/setup
2686  POST   /api/system/reinstall
2720  POST   /api/system/reset
2746  GET    /api/system/ssh
2758  POST   /api/system/ssh/harden
2775  POST   /api/system/update-os
```

**Interfaces:** None consumed from other tasks. Produces: nothing other tasks depend on (auth middleware itself — `requireNodeAuth`, `authSessions`, `hashPin`/`pinHash`/`pinConfigured`/`pinFile` — is pre-existing shared infrastructure from the dashboard-reliability-fix sub-project; if you find and fix a bug IN that shared middleware itself rather than in one of these 18 routes, flag it clearly in your report as "shared infrastructure change" so the controller can check it against every other domain task).

- [ ] **Step 1: Apply the Shared Audit Methodology above to all 18 routes.** Almost every route here except `/api/auth/check`, `/api/security/status`, `/api/ssl/status`, `/api/dns/status`, `/api/system/ssh` is side-effecting (setup/login/logout/PIN change/reset/SSL setup/DNS setup/reinstall/reset/harden/OS update) — code-review only for those, live-curl only the 5 read-only GETs listed.
- [ ] **Step 2: Run `node_modules/.bin/tsc --noEmit` and `npx vitest run`.** Both clean.
- [ ] **Step 3: Commit** any fixes with message `fix(audit): <what you fixed> [auth domain]`. If nothing needed fixing, still commit the report file addition if your workspace tooling tracks it, otherwise just note "no code changes" in your final report.

---

### Task 2: Node Core Status/Config/Lifecycle domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (26):**
```
 430  GET    /api/check-update
 477  POST   /api/update
1402  POST   /api/update/component
1484  GET    /api/node/status
1553  GET    /api/node/log
1556  GET    /api/node/tasks
1702  GET    /api/node/my-nodes
1803  POST   /api/node/control
1834  POST   /api/node/restart
1841  POST   /api/node/stop
1848  POST   /api/node/update
1865  GET    /api/node/dln
1873  POST   /api/node/dln
2253  GET    /api/node/settings
2265  GET    /api/node/config
2607  GET    /api/diagnostics/run
3881  GET    /api/node/diagnostics
3900  GET    /api/node/models/health
3908  GET    /api/node/usage
3913  GET    /api/node/usage/recent
3919  GET    /api/node/scheduler
3924  POST   /api/node/scheduler/:id/run
3930  GET    /api/node/events
3936  GET    /api/node/ws/clients
3944  GET    /api/node/platform
3949  GET    /api/node/overview
3985  GET    /api/node/naas
4050  GET    /api/node/fund
4205  GET    /api/node/hardware
4257  GET    /api/node/rating
4282  GET    /api/node/resources
```
(Note: that's 30 lines listed — a few of these route PATHS repeat under different METHODs at the same conceptual endpoint, e.g. `/api/node/dln` GET+POST; count them as pairs. Verify each line independently regardless.)

**Interfaces:** None consumed. Produces: nothing other tasks directly depend on, but `/api/node/status` is the single most-called route in the whole file (dashboard polls it repeatedly) — if you find a shape bug here, note in your report that other domain tasks' dashboard-side verification may have been reading a field FROM this route's response that you're changing, so double-check nothing else in `web/dashboard.html` reads the same field you're touching before changing its shape.

- [ ] **Step 1: Apply the Shared Audit Methodology to all routes above.** Side-effecting (code-review only, never live-invoke): `/api/update`, `/api/update/component`, `/api/node/control`, `/api/node/restart`, `/api/node/stop`, `/api/node/update`, POST `/api/node/dln`, `/api/node/scheduler/:id/run`. Everything else is a read — live-curl it.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** fixes as `fix(audit): <what> [node-core domain]`.

---

### Task 3: Wallet & Earnings domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (17):**
```
 743  GET    /api/fees
 758  GET    /api/fees/treasury
 770  GET    /api/fees/events
1565  GET    /api/node/earnings
1581  GET    /api/node/wallet
1624  POST   /api/node/bind-wallet
1673  POST   /api/node/unbind-wallet
1723  GET    /api/node/rewards
1750  GET    /api/node/pending-rewards
1769  POST   /api/node/claim-rewards
1942  GET    /api/wallet/live
2319  POST   /api/wallet/link-external
2347  POST   /api/wallet/claim
3117  GET    /api/rewards/balance
3131  POST   /api/rewards/claim
```
(That's 15 explicitly listed; `/api/fees*` grouping brings the total near the spec's ~13 estimate — audit exactly these 15.)

**Interfaces:** None consumed. This domain shares the "wallet balance / rewards" concept across several routes (`/api/node/wallet`, `/api/wallet/live`, `/api/node/rewards`, `/api/rewards/balance`) that may be doing overlapping or redundant work — if you find two routes that appear to serve the same purpose with different field names, don't just fix shape mismatches in isolation; note the overlap explicitly in your report as a finding for the controller (this may be intentional versioning, or may be exactly the kind of "eighth copy of the same list" duplication pattern flagged in this project's memory from a sibling project's audit — surface it, don't silently pick one to fix).

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting (code-review only): `/api/node/bind-wallet`, `/api/node/unbind-wallet`, `/api/node/claim-rewards`, `/api/wallet/link-external`, `/api/wallet/claim`, `/api/rewards/claim`. Everything else is a read.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [wallet domain]`.

---

### Task 4: Models, Chat & Inference domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (19):**
```
 588  POST   /v1/ollama/completions
 775  POST   /v1/chat/completions
 850  GET    /v1/models
 868  GET    /v1/sovereignty
 941  GET    /v1/skills
 951  GET    /v1/swarm/status
 989  POST   /api/v1/chat
1014  POST   /api/v1/free-api/key
1048  POST   /api/v1/free-api/chat
2154  POST   /v1/dashboard/chat
2174  GET    /api/chat/history
2290  GET    /api/swarm/orchestrator
2298  GET    /api/swarm/models
2512  GET    /api/swarm/network
4111  GET    /api/ollama/models
4131  POST   /api/ollama/models/pull
4178  DELETE /api/ollama/models/:name
```

**Interfaces:** None consumed. `/v1/chat/completions` and `/v1/ollama/completions` are documented in `README.md` as OpenAI-compatible external contract endpoints — check the README's exact documented request/response shape against the actual handler code; a mismatch here is a documented-contract break, which is a bigger deal than an internal one (still fix it here, but call it out prominently in your report).

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting or resource-intensive (code-review only, do not live-invoke): `/api/ollama/models/pull` (downloads a model), `DELETE /api/ollama/models/:name` (deletes a model). Chat/completions endpoints (`/v1/chat/completions`, `/v1/ollama/completions`, `/api/v1/chat`, `/v1/dashboard/chat`, `/api/v1/free-api/chat`) are technically side-effect-free but consume real inference resources on the live node — code-review only for these too, do not invoke live. Everything else (models list, chat history, swarm status/models/network/orchestrator, skills, sovereignty) is a safe read — live-curl it.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [models/chat domain]`.

---

### Task 5: Apps (NaaS Docker) domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (11):**
```
1459  GET    /apps/:appId
1931  GET    /api/apps/progress
1936  GET    /api/apps/progress/:appId
1975  GET    /api/apps/available
1985  POST   /api/apps/install
2023  POST   /api/apps/uninstall
2029  POST   /api/apps/start
2035  POST   /api/apps/stop
2041  POST   /api/apps/update
2054  GET    /api/apps/status
2076  POST   /api/apps/install-all
2091  POST   /api/apps/install-all-free
```
(12 listed; audit all of them — this is the "NaaS: auto-deploys blockchain nodes via Docker" feature per `README.md`.)

**Interfaces:** None consumed.

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting (code-review only): `install`, `uninstall`, `start`, `stop`, `update`, `install-all`, `install-all-free`. Read-only: `progress`, `progress/:appId`, `available`, `status`, and `/apps/:appId` (likely serves a static page or app-specific view — check what it actually does).
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [apps domain]`.

---

### Task 6: IPFS / Storage domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (6):**
```
 661  GET    /api/storage
 684  POST   /api/storage/add
 701  GET    /api/storage/get/:cid
 717  POST   /api/storage/pin
 732  DELETE /api/storage/pin/:cid
4314  GET    /api/vaults
```

**Interfaces:** None consumed. This domain was partly touched by the dashboard-reliability-fix sub-project earlier this session (IPFS tab fixes: `/api/storage/add`, `/api/storage/get/:cid`, `/api/storage/pin`/`DELETE` were specifically wired up then) — verify those fixes are actually still correct now (re-verify, don't just assume prior work holds), and extend the same rigor to `/api/storage` (the pin-list GET) and `/api/vaults` which weren't part of that earlier pass.

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting (code-review only): `/api/storage/add`, `/api/storage/pin` (POST), `/api/storage/pin/:cid` (DELETE). Read-only: `/api/storage`, `/api/storage/get/:cid`, `/api/vaults` — live-curl these (note `/api/storage/get/:cid` needs a real CID to test against; check the running node's actual pinned CIDs first via the `/api/storage` list route, use a real one if any exist, otherwise code-review only and note why).
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [ipfs/storage domain]`.

---

### Task 7: Peers / Mesh / Network domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (5):**
```
 613  GET    /api/peers
 632  POST   /api/peers/heartbeat
 651  POST   /api/peers/register
3290  GET    /api/links
4319  GET    /api/oracle/stats
```

**Interfaces:** None consumed, but this domain overlaps heavily with the just-completed decentralized-discovery sub-project (`PeerManager`, `getPeerManager()`, the `source` field added to `/api/peers`'s response in that sub-project's final-review fix round, commit `9ff8061`). Read `src/p2p/peers.ts` current state before auditing — do not re-litigate decisions already made and reviewed in that sub-project (the `touch` parameter on `registerPeer`, the central-registry fallback gating, etc. are settled); your job here is only to verify the HTTP route layer (`/api/peers`, `/api/peers/heartbeat`, `/api/peers/register`) correctly exposes what `PeerManager` already does, and that `/api/links` and `/api/oracle/stats` (unrelated to `PeerManager`, check what they actually are) are correctly wired.

- [ ] **Step 1: Apply the Shared Audit Methodology.** `/api/peers/heartbeat` and `/api/peers/register` are called by OTHER gstdbot nodes (external callers, from this node's perspective) — check their shape against what `src/p2p/peers.ts`'s own `getSelfPayload()`/`registerPeer` call pattern sends when THIS node calls ANOTHER node's same endpoints (i.e., verify the wire format is self-consistent — a node's outgoing heartbeat POST body must match what this incoming handler expects). `/api/peers`, `/api/links`, `/api/oracle/stats` are safe reads — live-curl them.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean** (this domain touches files with real test coverage from the decentralized-discovery sub-project — `src/p2p/peers.test.ts` — make sure you don't break any of its 5 existing tests).
- [ ] **Step 3: Commit** as `fix(audit): <what> [peers/mesh domain]`.

---

### Task 8: Validators & Blockchain domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (13):**
```
2307  GET    /api/premium/status
2843  POST   /api/validator/register
2865  GET    /api/validator/list
2875  POST   /api/validator/stake
2892  POST   /api/validator/unstake
3074  POST   /api/enterprise/provision
3099  GET    /api/enterprise/status
3149  GET    /api/premium/tiers
4071  GET    /api/validators
4076  POST   /api/validators/:chain/toggle
4085  POST   /api/validators/:chain/install
```
(11 listed, close to the ~9 estimate.)

**Interfaces:** None consumed. This domain was partly touched by dashboard-reliability-fix (`Validators` tab: `v.state.*` nested fields, `POST /api/validators/:chain/toggle` fixed then) — re-verify those fixes still hold, and note that `/api/validator/*` (singular) and `/api/validators*` (plural) are TWO DIFFERENT route families with similar names — do not assume they're duplicates or related without checking; verify each independently and flag clearly in your report whether they overlap in purpose (this looks exactly like the kind of naming collision that causes real confusion — confirm or rule it out with evidence).

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting (code-review only): `register`, `stake`, `unstake`, `enterprise/provision`, `toggle`, `install`. Read-only: `premium/status`, `validator/list`, `enterprise/status`, `premium/tiers`, `/api/validators` — live-curl these.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [validators/blockchain domain]`.

---

### Task 9: Tasks / Compute Marketplace domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (5):**
```
3189  POST   /api/tasks/create
3210  GET    /api/tasks/list
3229  POST   /api/tasks/claim
3247  POST   /api/tasks/submit
3263  POST   /api/tasks/verify
```

**Interfaces:** None consumed. Distinct from `/api/node/tasks` (Task 2, this node's own local task-queue view) — these are the compute marketplace's create/list/claim/submit/verify lifecycle for tasks potentially distributed across multiple nodes; check `src/compute/marketplace.ts` (touched by the resilience-fix sub-project earlier this session — `pollJobs()` gated on `platformHealth.shouldAttempt()`) for the real implementation these routes call into.

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting (code-review only): `create`, `claim`, `submit`, `verify`. Read-only: `list` — live-curl it.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [tasks/marketplace domain]`.

---

### Task 10: Training / Federated Learning + Memory domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (16):**
```
2106  POST   /api/memory/store
2119  POST   /api/memory/recall     <- FIRST registration, this one is live
2131  GET    /api/memory/stats
2142  GET    /api/training/status
2912  POST   /api/training/start
2938  GET    /api/training/jobs
2948  POST   /api/training/contribute
2968  POST   /api/training/gradient
2988  POST   /api/training/peer/register
3007  POST   /api/training/peer/load
3017  GET    /api/training/leaderboard
3025  GET    /api/training/health
3033  GET    /api/training/models
3050  GET    /api/training/jobs/:id
3063  POST   /api/training/route
4309  POST   /api/memory/recall     <- SECOND, DUPLICATE, CONFIRMED DEAD registration
```

**Interfaces:** None consumed.

**Already-confirmed finding — fix this first, it's not something to rediscover:** `POST /api/memory/recall` is registered TWICE, at `server.ts:2119` and `server.ts:4309`. Express only ever dispatches to the FIRST matching registration (`:2119`); the handler at `:4309` is permanently unreachable dead code. Read both handler bodies. If they're functionally identical, delete the dead one at `:4309` and note the removal in your report. If they DIFFER (the one at `:4309` does something different/better), that's a more serious finding — the "correct" behavior has never actually run in production — read both carefully, determine which is intended (check git blame / commit history for context on which was added later and why), keep the correct one at the working position, remove the other, and flag this prominently in your report since it means production behavior for this endpoint may have been wrong for as long as the duplicate existed.

- [ ] **Step 1: Fix the confirmed `/api/memory/recall` duplicate per the instructions above.**
- [ ] **Step 2: Apply the Shared Audit Methodology to the remaining 14 routes.** Side-effecting (code-review only): `memory/store`, `training/start`, `training/contribute`, `training/gradient`, `training/peer/register`, `training/peer/load`, `training/route`. Read-only: `memory/stats`, `training/status`, `training/jobs`, `training/leaderboard`, `training/health`, `training/models`, `training/jobs/:id` — live-curl these. (`memory/recall` itself, once de-duplicated, is a read triggered by a query — check whether it's safe to live-curl with a sample query or needs code-review only depending on what it does.)
- [ ] **Step 3: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 4: Commit** as `fix(audit): remove dead duplicate /api/memory/recall registration + audit training/memory domain [training/memory domain]`.

---

### Task 11: Resources / Traffic Relay domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (6):**
```
2183  GET    /api/resources/status
2194  GET    /api/resources/available
2200  GET    /api/resources/meter
2208  GET    /api/resources/pricing
2216  POST   /api/resources/request
2558  GET    /api/resources/config
2587  POST   /api/resources/config
```
(7 listed, close to ~5 estimate.)

**Interfaces:** None consumed. This is the `TrafficRelay`/`ResourceSharing` feature (`src/coverage/relay.ts`, `src/network/resources.ts` per `README.md`'s architecture list) — check those source files for the real implementation.

- [ ] **Step 1: Apply the Shared Audit Methodology.** Side-effecting (code-review only): `resources/request`, `resources/config` (POST). Read-only: `status`, `available`, `meter`, `pricing`, `config` (GET) — live-curl these.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [resources/relay domain]`.

---

### Task 12: Telegram / Remote Access domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (5):**
```
1247  POST   /api/telegram/link
1257  GET    /api/telegram/status
1321  POST   /api/telegram/webhook
2228  GET    /api/remote/status
2239  GET    /api/remote/info
```

**Interfaces:** None consumed. `/api/telegram/webhook` is called by Telegram's own servers (an external, unauthenticated-by-design caller you cannot grep for locally) — verify it against Telegram's Bot API webhook payload shape (check `src/channels/telegram.ts` for how the bot itself is set up, which tells you what shape Telegram will actually POST) rather than looking for an internal caller (there won't be one; that's expected and correct for a webhook, not a dead-route finding).

- [ ] **Step 1: Apply the Shared Audit Methodology,** with the `/api/telegram/webhook` exception noted above. Side-effecting (code-review only): `telegram/link`. Read-only: `telegram/status`, `remote/status`, `remote/info` — live-curl these. `telegram/webhook` — code-review only (external, unauthenticated caller, do not simulate live).
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [telegram/remote domain]`.

---

### Task 13: Root / Health / Misc domain

**Files:** Modify `src/gateway/server.ts` and/or `web/dashboard.html` as findings require.

**Routes (2):**
```
 409  GET    /health
1474  GET    /
```

**Interfaces:** None consumed. Small domain — `/health` is likely a liveness-probe endpoint (check if anything external, e.g. a monitoring script or pm2 config, actually polls it) and `/` likely serves the dashboard HTML itself or a landing response.

- [ ] **Step 1: Apply the Shared Audit Methodology to both routes.** Both are safe reads — live-curl them.
- [ ] **Step 2: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 3: Commit** as `fix(audit): <what> [root/health domain]` (or note "no changes needed" if both check out clean).

---

### Task 14: Consolidation pass

**Files:** No new source changes expected unless the cross-check below finds an inconsistency; report file only otherwise.

**Interfaces:** Consumes: all 13 prior tasks' report files (`.superpowers/sdd/2026-08-26-full-functional-audit/task-{1..13}-report.md`).

- [ ] **Step 1: Read all 13 task reports.** Collect every "Confirmed dead routes" entry from each into one consolidated list in this task's own report — this is the deliverable the controller presents to the user for a keep/remove decision. Include the route, which task found it dead, and the exact evidence (what was grepped, that it came up empty).
- [ ] **Step 2: Check shared-infrastructure consistency.** Several routes across different domains share underlying infrastructure: the auth middleware (`requireNodeAuth`, `authSessions`, PIN logic — Task 1's domain but touched implicitly by any route requiring auth), `platformHealth` (the circuit breaker from the resilience-fix sub-project, gating several domains' outbound calls), and `PeerManager` (Task 7's domain, but referenced by Task 3's wallet/rewards routes if they touch peer-forwarded data). Grep each of these three symbols across the WHOLE `src/gateway/server.ts` and `src/lib/platform-health.ts` / `src/p2p/peers.ts` to confirm no two of the 13 domain tasks made incompatible changes to shared logic (e.g., one task changing an auth check's status-code convention that another domain's routes now violate). If you find an inconsistency, fix it directly (small, mechanical) and note it in this task's report.
- [ ] **Step 3: Full clean verification.** Run `node_modules/.bin/tsc --noEmit` and `npx vitest run` one final time across the fully-merged state of all 13 domain tasks' commits. Both must be clean.
- [ ] **Step 4: Write the consolidated report** (`.superpowers/sdd/2026-08-26-full-functional-audit/task-14-report.md`) with three sections: "Fixed" (count + one-line summary per fix across all 13 tasks, pulled from their reports), "Confirmed dead" (the consolidated list from Step 1, for the user's decision), "Verified clean" (routes checked with no issue found).
- [ ] **Step 5: Commit** any fixes from Step 2 as `fix(audit): resolve cross-domain shared-infrastructure inconsistency [consolidation]`. If Step 2 found nothing, no commit needed — the report file alone (gitignored, per this session's established `.superpowers/sdd/` pattern) is the deliverable.
