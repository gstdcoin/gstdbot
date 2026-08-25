# Dashboard Reliability Fix — Design

**Repo:** gstdbot
**Scope:** Second sub-project of the "node product quality" effort (the first, dashboard-visible piece of the user's broader complaint about the node's interface and features). This fixes `web/dashboard.html`'s dashboard-facing features only — the ~150-route gateway includes many internal/platform-facing routes not surfaced in the dashboard at all, explicitly out of scope per the earlier scoping decision. Dashboard UI redesign (visual quality), true network-wide model-aware routing (sub-project C from the decentralization decomposition), and the "apps" placeholder-content problem are separate, later sub-projects.

## Problem

A three-way parallel audit of every dashboard tab (Home, Models, Chat, IPFS, Validators, Wallet, Blockchain, API, Settings) found the dashboard is not showing fake data — it's disconnected from real, working backend capabilities by a systematic pattern of field-name and route mismatches between `web/dashboard.html`'s JavaScript and `src/gateway/server.ts`'s handlers. 22 distinct broken features, one genuine crash bug, and 3 deeper architectural issues.

## Fixes

### 1. `/api/node/status` nested-vs-flat mismatch (affects 2 tabs)

The handler (`server.ts:1453-1461`) nests node identity under `node: {name, version, platform, arch, ...}` with no top-level `nodeId` field at all. Two separate call sites read it as if it were flat:
- Home tab `refreshHome()` (dashboard.html:1076-1078): `s.name`, `s.version`, `s.platform`, `s.nodeId` — all `undefined`.
- Settings tab `loadSettings()` (dashboard.html:1479-1483): `d.nodeId`, `d.version`, `d.platform`, `d.arch` — all `undefined`.

**Fix:** update both call sites to read the real nested shape: `s.node.name`, `s.node.version`, `s.node.platform`, `s.node.arch`. For `nodeId` specifically — confirmed absent from the response entirely — add it to the handler's `node: {...}` object (the node's own ID is already known server-side as `this.config.nodeId` or equivalent; read the exact accessor used elsewhere in `server.ts` for consistency) rather than inventing a new field name on the frontend for something the backend doesn't emit.

### 2. `/api/storage` field names (affects Home + IPFS tabs)

Handler (`server.ts:656-670`) returns `ipfs_peers` (not `peers`) and `pins` as a **count** (with the actual pin array under `pin_list`). Two bugs from this:
- Home tab (dashboard.html:1062): `d.pins?.length||0` and `d.peers||0` — wrong field name and wrong type, always renders 0.
- IPFS tab (dashboard.html:1268-1273): reads `d.peers` (wrong name) and does `const pins=d.pins||[]; pins.map(...)` — since `d.pins` is a number, not an array, this **throws `TypeError: pins.map is not a function`** whenever any pins exist. This is the one genuine crash in the audit, not just a display bug.

**Fix:** update both call sites to read `d.ipfs_peers` for peer count, and `d.pin_list` (the array) for the pin list, using `d.pins` (the count) only where a plain number is wanted (e.g., a summary count elsewhere, if any).

### 3. Activity log field names (Home tab)

Handler's `activityLog` entries are `{ts, msg, type}` (server.ts:116, 132). Home tab (dashboard.html:1082-1085) reads `e.timestamp`, `e.level`, `e.message` — timestamp is always blank, and the level badge always falls back to generic "Info" (losing success/warning/error coloring) since `e.level` doesn't exist and the code's `||'info'` fallback silently masks it.

**Fix:** read `e.ts`, `e.type`, `e.msg` instead of the current field names.

### 4. Models tab — the cluster most directly tied to the user's "can't load models" complaint

Four separate bugs compound into "model management looks completely broken":

- **Installed list always empty** (dashboard.html:1114): `/api/ollama/models` (server.ts:4073) returns `{installed, running, catalog, ollama_available}`; the frontend reads `mods.models||[]` — no `models` key exists, so `inst` is always `[]` regardless of what's genuinely installed on Ollama.
- **Catalog is a hardcoded fake list**: `renderCatalog` (dashboard.html:1141-1178) uses a local hardcoded `CATALOG` array of 12 models (dashboard.html:1143-1155), completely ignoring the backend's real `catalog` field (`POPULAR_MODELS`, server.ts:4060), which is fetched and silently discarded. Combined with the previous bug, every catalog card always shows "Fits"/"Low RAM," never "Installed," even for genuinely-installed models.
- **Install button 404s**: `executePull` POSTs to `/api/ollama/pull` (dashboard.html:1196); the real route is `POST /api/ollama/models/pull` (server.ts:4093). Always fails. Separately, even with the URL fixed, the backend streams Server-Sent-Events–formatted lines (`data: {...}\n\n`, server.ts:4126) while the frontend parses each line as raw JSON (`JSON.parse(line)`, dashboard.html:1203) — this would fail to parse the `data: ` prefix and silently fall into a raw-text fallback branch, so pull progress percentage would never render even after the URL is corrected. Both must be fixed together.
- **Remove button 404s**: `removeModel` calls `DELETE /api/ollama/delete` (dashboard.html:1219); the real route is `DELETE /api/ollama/models/:name` (server.ts:4140).

**Fix:** (a) read `mods.installed` instead of `mods.models`; (b) replace the hardcoded local `CATALOG` array with the backend's real `catalog` field from the same `/api/ollama/models` response, removing the now-dead local array; (c) fix the Install button's URL to `/api/ollama/models/pull`, and fix its response-stream parsing to strip the `data: ` SSE prefix before `JSON.parse`; (d) fix the Remove button's URL to `DELETE /api/ollama/models/${name}`.

This directly resolves the user's complaint: custom/arbitrary model names were never restricted to a curated list (confirmed in the audit — `doPullInput`/`startPull` already accept free text), so once these four bugs are fixed, a user can genuinely see what's installed and pull/remove any Ollama model by name, matched against real hardware fit data (which was already computing correctly, just not rendering against accurate installed-state).

### 5. IPFS tab — three dead buttons (Upload/Fetch/Unpin)

- **Upload** (dashboard.html:1283): POSTs `{content:txt}` to `/api/storage/pin`, which requires `{cid, name, owner_node}` and pins an *existing* CID (server.ts:712-724) — always fails with 400. The route that genuinely accepts raw content is `POST /api/storage/add` (server.ts:679), never called.
- **Fetch** (dashboard.html:1298): calls `GET /api/storage/fetch?cid=`; no such route exists. Real route is `GET /api/storage/get/:cid` (server.ts:696).
- **Unpin** (dashboard.html:1309): calls `DELETE /api/storage/unpin` with `{cid}` in the body; real route is `DELETE /api/storage/pin/:cid` (server.ts:727) — cid belongs in the path, not the body.

**Fix:** point each button at its real route with the real request shape: Upload → `POST /api/storage/add` with the content payload the handler actually expects (read `server.ts:679`'s exact body shape); Fetch → `GET /api/storage/get/${cid}`; Unpin → `DELETE /api/storage/pin/${cid}`.

### 6. Validators tab — near-total field mismatch plus a dead toggle

`renderValidators` (dashboard.html:1328-1361) reads `v.status`, `v.enabled`, `v.earnings_day`, `v.ram_req`, `v.disk_req`, `v.stake`, `v.synced`. The real shape (`server.ts:4033`, `validators/manager.ts:124-129`) is `v.state.status`, `v.state.enabled`, `v.earningsGstd`, `v.ramMb`, `v.diskGb`, `v.state.syncPct` — and there is no `stake` field at all (drop that row rather than inventing backend state for it). Result: the Running/Stopped badge and toggle checkbox always show "Stopped," and earnings/RAM/disk/sync always render blank, regardless of real validator state.

Separately, `toggleValidator` (dashboard.html:1365) calls `PATCH /api/validators/${id}`; the real route is `POST /api/validators/:chain/toggle` (server.ts:4038) — wrong method and wrong path, so the toggle can never start or stop a validator through the UI even though `ValidatorManager.toggle()` genuinely spawns real chain-client binaries when hit correctly.

**Fix:** update `renderValidators` to read the real nested/renamed fields listed above, remove the `stake` row entirely (no backing data exists — do not fabricate a placeholder), and fix `toggleValidator` to `POST /api/validators/${chain}/toggle`.

### 7. Wallet tab — two field/display bugs plus a trust-model clarity issue

- Earnings history "Detail" column (dashboard.html:1397) reads `e.detail||e.model`; the real field is `description` (`wallet/manager.ts:38`) — always blank. **Fix:** read `e.description`.
- "Reward Rate" stat card (`w-rate`, dashboard.html:588) is never populated by any JS anywhere — permanently shows "—". **Fix:** either wire it to real data (check whether an effective-rate figure exists elsewhere in this codebase, e.g. `SwarmAgent`'s `effectiveRate` stat surfaced via `/api/node/status`'s `swarm` object) or remove the stat card entirely if no real backing data exists — do not leave a permanently-dead UI element. Decide which at plan time based on what's actually available.
- `claimRewards` degrades silently on failure with no visible error message, and the claimable balance is never previewed before the button is clicked (the placeholder text at `w-claim-info`, dashboard.html:606, is static and never updated). **Fix:** surface the claim result (success/failure) via the existing `toast()` helper already used elsewhere in this file, and populate `w-claim-info` with the real claimable amount if `/api/wallet/live` or a similar endpoint already returns one (check at plan time) — do not fabricate a number if none exists; in that case, remove the placeholder text instead of leaving it static and misleading.

**Trust-model clarity (not a bug, a labeling gap):** the Wallet tab's earnings figures are a locally-tracked, off-chain ledger (`NodeWallet.getStats()`, optionally overridden by a platform KV lookup) — a fundamentally different source of truth than the Blockchain tab's genuinely on-chain TON balance reads. Both are legitimate numbers, but nothing on the page currently distinguishes "off-chain earnings you've accrued" from "on-chain balance you actually hold." **Fix:** add a short inline label (e.g., "Off-chain, settled periodically" near the Wallet tab's earnings figures) so a user doesn't mistake one for the other. This is a copy-only change, not a data-shape change.

### 8. Settings tab — update-check masking, Telegram badge, two dead buttons

- **Update check always says "up to date"** (dashboard.html:1497-1501, 1534-1537): `/api/check-update` (server.ts:426-470) returns snake_case `update_available`, `current_version`, `commits_behind`, `remote_hash`; the frontend reads camelCase `d.updateAvailable`, `d.latest`, `d.current` — none match, so the update-available check is always falsy even when a real update is genuinely behind. This masks an otherwise-working update mechanism (`runUpdate` itself genuinely works). **Fix:** read the real snake_case field names; for "latest version," check whether `/api/check-update`'s response includes a version string beyond `current_version` (read `server.ts:426-470` at plan time) — if it only reports "N commits behind" rather than a target version number, adjust the UI copy to say "N commits behind" instead of inventing a `latest` version string that doesn't exist server-side.
- **Telegram status badge always wrong** (dashboard.html:1506-1508): handler (`server.ts:1221-1223`) returns `{linked, telegram: {chatId, username, linkedAt}}`; frontend reads `d.connected`, `d.enabled`, `d.username`, `d.botUsername` — none match, badge always shows "Not configured" even when genuinely linked. **Fix:** read `d.linked` for the connection state and `d.telegram.username` for the display name.
- **Change PIN button 404s**: `changePin` calls `/api/auth/change-pin`, which doesn't exist anywhere in `src/` — only `/setup`, `/login`, `/check`, `/logout`, `/reset-pin-request`, `/reset-pin-confirm` exist (server.ts:1129-1257). **Fix:** determine at plan time whether "change PIN while already logged in" is meant to reuse the existing reset-PIN flow (`/reset-pin-request` + `/reset-pin-confirm`) or whether a new dedicated route needs to be added server-side — this is a real missing-feature gap, not just a frontend typo, so the plan must decide which.
- **Save Telegram token button 404s**: `saveTelegram` calls `/api/telegram/configure`, which doesn't exist anywhere in `src/`. **Fix:** same as above — determine at plan time whether linking is meant to happen exclusively via the existing bot deep-link flow (`server.ts:1202-1218`, confirmed working) and this button/form should be removed as redundant, or whether a genuine token-configuration route needs to be added. Given the deep-link flow already works, removing the redundant broken form is the simpler, YAGNI-consistent fix unless there's a reason token-based linking must also exist — default to removal unless the plan-writing investigation finds a reason not to.

## Out of scope

- Dashboard visual/UX redesign (a separate, later sub-project per the user's own 4-way decomposition).
- The "apps" placeholder-content problem (71 of 77 apps are non-functional shells) — this is a content/feature-completeness gap, not a wiring bug, and deserves its own scoped decision (build real apps vs. remove fake ones vs. relabel as "coming soon") rather than being bundled into a bug-fix pass.
- True network-wide model-aware request routing tied to token accounting (sub-project C from the earlier decentralization decomposition) — this spec only fixes the *local* node dashboard's ability to see and manage its own installed models correctly; it does not address how the wider network discovers which models are available on which nodes.
- The Blockchain tab's reliance on unauthenticated public TonCenter/TonAPI endpoints (rate-limit fragility) — noted by the audit as a real fragility but not a broken-today bug, and not part of this pass.

## Testing

This repo has vitest configured (`npm test`) but the code here is entirely browser-side JavaScript embedded in `web/dashboard.html` plus small server.ts handler adjustments — no existing test coverage pattern exists for the dashboard's inline JS, and adding a browser-test harness is out of scope for a bug-fix pass. Verification is:
- `npx tsc --skipLibCheck` clean for any `server.ts` changes (e.g., adding `nodeId` to the status response).
- `npx vitest run` clean (must not break existing coverage, including the `platform-health.test.ts` suite added in the previous sub-project).
- Manual verification against the live running node: for each fixed feature, hit the corrected endpoint directly via `curl` and confirm the response shape now matches what the corrected frontend code expects to read, and spot-check the actual rendered HTML/behavior where practical (e.g., confirm `/api/ollama/models` response's `installed` array appears correctly in a fetched page, confirm the IPFS pin-list endpoint no longer causes a `.map()` crash by constructing a request against a state with at least one pin present).
