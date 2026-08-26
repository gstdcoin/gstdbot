# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dashboard where all 9 tabs share one real design system (spacing/type scale, loading/empty/alert states) instead of ad-hoc per-tab styling, while keeping the existing dark violet/cyan identity, structure, and every current behavior exactly as-is.

**Architecture:** `web/dashboard.html` already has a real component library in its `<style>` block (`.card`, `.stat-card`, `.badge-*`, `.btn-*`, `.empty`, `.tbl`, `.v-card`, `.mc`, `.app-card`) reused fairly consistently across tabs — this is a refinement pass, not a rebuild. Task 1 adds what's genuinely missing (a spacing scale, a type scale, a loading-skeleton pattern, an inline-alert/feedback component) as new CSS custom properties and classes, proven out on the Home tab. Tasks 2-9 apply the established system to the remaining 8 tabs, each fixing that tab's specific gaps (raw spacing/font-size values not using the new tokens, missing loading/empty states, one-off inline styles that duplicate an existing shared class). Task 10 does a final cross-tab consistency and responsive check.

**Tech Stack:** Single static HTML file, inline CSS + vanilla JS, no build step, no framework — matches the existing file exactly.

**Spec:** `docs/superpowers/specs/2026-08-26-dashboard-redesign-design.md`

## Global Constraints

- No behavioral change: every button, form, tab switch, and SSE/fetch call in `web/dashboard.html` must work exactly as before after every task. This plan changes appearance and structure only.
- No new build tooling, no framework, no external CSS/JS dependency — stays a single file with inline `<style>`/`<script>`, matching current delivery.
- Keep the existing palette (`--bg`, `--accent`, `--accent2`, `--cyan`, `--green`, `--red`, `--yellow`, `--text`, `--muted`) — extend with new tokens, never replace these.
- Verify each task's changed tab in an actual browser (`npm run dev`, dashboard at `localhost:8080`) before marking it done — golden path plus at least one empty/loading state where applicable, per this repo's CLAUDE.md guidance against claiming UI success from code-reading alone.
- `node_modules/.bin/tsc --noEmit` and `npx vitest run` must stay clean after every task (this file isn't type-checked or unit-tested itself, but a task must never break the backend build it ships alongside).

---

### Task 1: Design system foundation — spacing/type scale, skeleton, alert — proven on Home tab

**Files:**
- Modify: `web/dashboard.html:9-23` (the `:root` block)
- Modify: `web/dashboard.html:180-199` (existing `.empty` and utility classes — extend, don't replace)
- Modify: `web/dashboard.html:334-433` (Home tab markup — apply the new system)

**Interfaces:**
- Produces (every later task in this plan consumes these): new CSS custom properties `--space-1` (4px) through `--space-6` (48px); new type-scale properties `--text-xs` (11px) through `--text-2xl` (26px); new classes `.skeleton` (shimmer loading placeholder), `.skeleton-text`, `.skeleton-card` (sized variants); new class `.alert` with modifiers `.alert-success`, `.alert-error`, `.alert-info` (inline action-feedback component — replaces any one-off feedback markup found in later tabs).

- [ ] **Step 1: Add the spacing and type scale as new CSS custom properties.**

In `web/dashboard.html`, inside the existing `:root{...}` block (currently lines 9-23), add these new properties without removing any existing one:

```css
  :root{
    --bg:#030014;
    --sidebar-bg:rgba(8,4,28,0.97);
    --card-bg:rgba(15,10,40,0.8);
    --border:rgba(139,92,246,0.15);
    --accent:#8b5cf6;
    --accent2:#7c3aed;
    --cyan:#06b6d4;
    --green:#22c55e;
    --red:#ef4444;
    --yellow:#f59e0b;
    --text:#e2e8f0;
    --muted:#64748b;
    --sidebar-w:240px;
    /* Spacing scale — use these instead of raw px in new/changed rules */
    --space-1:4px;
    --space-2:8px;
    --space-3:12px;
    --space-4:16px;
    --space-5:24px;
    --space-6:32px;
    --space-7:48px;
    /* Type scale — use these instead of raw font-size px in new/changed rules */
    --text-xs:11px;
    --text-sm:12px;
    --text-base:13px;
    --text-md:14px;
    --text-lg:18px;
    --text-xl:22px;
    --text-2xl:26px;
  }
```

Do not go back and rewrite every existing raw pixel value in the file to use these tokens — that's a mechanical, low-value, high-diff-noise change with no visual effect, out of scope. New/changed CSS written by THIS plan (Task 1 onward) should use the tokens; existing untouched CSS stays as-is until a task genuinely needs to touch that rule anyway.

- [ ] **Step 2: Add a loading-skeleton component.**

Add this new CSS block right after the existing `.empty{...}` rule block (currently ending around line 183, `.empty p{font-size:12px}`):

```css
  .skeleton{position:relative;overflow:hidden;background:rgba(255,255,255,0.05);border-radius:6px}
  .skeleton::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(139,92,246,0.12),transparent);animation:skeleton-shimmer 1.4s infinite}
  @keyframes skeleton-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
  .skeleton-text{height:14px;width:60%;margin-bottom:6px}
  .skeleton-text:last-child{margin-bottom:0;width:40%}
  .skeleton-card{height:80px;border-radius:14px}
```

- [ ] **Step 3: Add an inline alert/feedback component.**

Add this new CSS block right after the skeleton rules from Step 2:

```css
  .alert{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-radius:10px;font-size:var(--text-base);margin-bottom:var(--space-4)}
  .alert-success{background:rgba(34,197,94,0.12);color:var(--green);border:1px solid rgba(34,197,94,0.3)}
  .alert-error{background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.3)}
  .alert-info{background:rgba(6,182,212,0.12);color:var(--cyan);border:1px solid rgba(6,182,212,0.3)}
```

- [ ] **Step 4: Apply the skeleton pattern to the Home tab's initial-load state.**

Read the current Home tab markup (`web/dashboard.html:334-433`) and the JS that populates it (search `web/dashboard.html`'s `<script>` block for the function that fills `#h-cpu`, `#h-ram`, `#h-disk`, `#h-uptime`, `#h-gstd`, `#h-models`, `#h-pins`, `#h-peers`, `#h-addr`, `#h-earn`, `#h-log` — likely a `refreshHome()` or `loadHome()`-named function). Currently these elements show a static `—` or `"Loading..."` string until the first fetch resolves. Change this to:
- Give each `.stat-val` element (and the `#h-log` container) a `skeleton-text` / `skeleton-card` sibling or initial class that's visible before data arrives, removed/hidden once the real value is set by the existing JS update logic. Keep the exact same element `id`s the JS already targets (`h-cpu`, `h-ram`, etc.) — you are changing what's shown before the JS runs, not the JS's own update logic or the ids it queries.
- Concretely: wrap or precede each stat value with a `<span class="skeleton skeleton-text" data-skel-for="h-cpu"></span>` sibling, hidden by the existing update function when it sets real content (add one small helper in the `<script>` block, e.g. a `hideSkeleton(id)` function called at the start of whichever function currently sets `document.getElementById('h-cpu').textContent = ...`, that hides the matching `[data-skel-for="h-cpu"]` element — read the actual current update function first to place this correctly, its exact current name and structure isn't guessed here on purpose since you're about to read it).
- Do the same for the Activity Log's `"Loading..."` row (line 431) — real skeleton rows instead of static text, replaced once `h-log` is actually populated.

- [ ] **Step 5: Verify in browser.** `npm run dev`, open `localhost:8080`, confirm: Home tab shows skeleton placeholders briefly on load (you may need to throttle network in devtools or add a temporary artificial delay to observe it, then remove the delay), then real data replaces them exactly as before, no layout jump, no console errors, no change to any value shown once loaded.

- [ ] **Step 6: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean** (this task doesn't touch backend TS, this is a safety check only).

- [ ] **Step 7: Commit.**

```bash
git add web/dashboard.html
git commit -m "feat(dashboard): add spacing/type scale tokens, skeleton loading + alert components, apply to Home tab"
```

---

### Task 2: Apply design system to Models tab

**Files:** Modify `web/dashboard.html:436-490` (Models page markup) and its corresponding JS update functions in the `<script>` block.

**Interfaces:** Consumes Task 1's `--space-*`, `--text-*` tokens, `.skeleton`/`.skeleton-text`/`.skeleton-card`, `.alert`/`.alert-success`/`.alert-error`/`.alert-info`.

- [ ] **Step 1: Read the current Models tab markup and its JS update/action functions** (search for `loadModels`, model-pull/remove handlers — this tab was rewired in the earlier dashboard-reliability-fix sub-project this session, e.g. `mods.installed` not `mods.models`, `/api/ollama/models/pull` — read the CURRENT state, don't assume that session's summary is still accurate against the live file).
- [ ] **Step 2: Apply loading state.** The model grid (`.model-grid`/`.mc` cards) and any status readout should show `.skeleton-card` placeholders before the first fetch resolves, same pattern as Task 1's Home tab example.
- [ ] **Step 3: Apply alert component.** If this tab has any existing one-off "install succeeded"/"install failed" feedback markup (inline color-changed text, a manually-styled div, etc.), replace it with `.alert-success`/`.alert-error`. If it currently has no action-feedback UI at all for install/remove actions (silent success/failure), add one using `.alert` — a real operator needs to see whether a model pull succeeded, not just infer it from the list refreshing.
- [ ] **Step 4: Confirm empty state.** If zero models are installed, verify a real `.empty` state renders (not a blank grid) — this tab may already have one; if not, add one following the existing `.empty` pattern (`web/dashboard.html:180-183`) with a short explanatory line and a call-to-action pointing at pulling a model.
- [ ] **Step 5: Verify in browser** — golden path (models list, pull, remove) and the empty/loading states.
- [ ] **Step 6: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 7: Commit** as `feat(dashboard): apply design system to Models tab`.

---

### Task 3: Apply design system to Chat tab

**Files:** Modify `web/dashboard.html:491-513` (Chat page markup) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current Chat tab markup and its JS** (message send/receive, the `.chat-box`/`.chat-msgs`/`.msg` classes already exist and are chat-specific — keep them, this tab is mostly about states around them, not a redesign of the message bubbles themselves).
- [ ] **Step 2: Apply loading/typing state review.** The existing `.msg-bot.typing` class already exists — verify it's actually used correctly for an in-flight response (a real typing indicator, not just italic text with no animation) and improve it using the Task 1 skeleton pattern's shimmer technique if it currently has no visual motion.
- [ ] **Step 3: Apply alert component** for a failed message send (network error, backend error) if no such feedback currently exists — silently failing to send a chat message with no visible error is exactly the kind of "broken-feeling" gap this plan targets.
- [ ] **Step 4: Verify in browser** — send a message, confirm typing/loading indicator, and (if you can simulate it, e.g. by briefly stopping the dev server mid-request) confirm the error alert appears.
- [ ] **Step 5: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 6: Commit** as `feat(dashboard): apply design system to Chat tab`.

---

### Task 4: Apply design system to IPFS tab

**Files:** Modify `web/dashboard.html:514-560` (IPFS page markup) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current IPFS tab markup and JS** (pin list, add/get/pin/unpin actions — rewired in dashboard-reliability-fix this session, `d.pin_list` not `d.pins`; read current live state, don't assume).
- [ ] **Step 2: Apply loading state** to the pin list before first fetch resolves.
- [ ] **Step 3: Apply empty state** if zero pins exist (verify one exists and matches the shared `.empty` pattern; add if missing).
- [ ] **Step 4: Apply alert component** for add/pin/unpin action feedback if none currently exists.
- [ ] **Step 5: Verify in browser** — golden path plus empty state (if you can get to zero pins safely) or at minimum confirm the empty-state markup renders correctly when manually toggled via devtools.
- [ ] **Step 6: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 7: Commit** as `feat(dashboard): apply design system to IPFS tab`.

---

### Task 5: Apply design system to Validators tab

**Files:** Modify `web/dashboard.html:561-570` (Validators page markup — this is a very short static shell, most content is likely rendered by JS into it; read the JS to find the real markup being generated) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current Validators tab's static markup AND the JS function that populates it** (this tab's HTML shell is only ~10 lines, meaning most of the actual card/list markup is built in JS via template strings — find that function, likely named something like `loadValidators` or `renderValidators`, and read the template string it builds).
- [ ] **Step 2: Apply the design system to the JS-generated markup**, not just the static shell — the `.v-card`/`.v-icon` classes already exist for this tab, verify the generated cards actually use them consistently (some JS-templated markup drifts from the CSS classes meant for it over time), and apply `.skeleton-card` for the loading state before the validator list is fetched.
- [ ] **Step 3: Apply empty state** if zero validators are configured/running.
- [ ] **Step 4: Verify in browser** — golden path and loading/empty states.
- [ ] **Step 5: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 6: Commit** as `feat(dashboard): apply design system to Validators tab`.

---

### Task 6: Apply design system to Wallet tab

**Files:** Modify `web/dashboard.html:571-621` (Wallet page markup) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current Wallet tab markup and JS** (this tab was extensively reworked in dashboard-reliability-fix this session — `e.description`, `w-rate` wired to `d.swarm?.effectiveRate`, `claimRewards()` — read current live state; note there is a known, previously-parked cosmetic bug in this tab's Reward Rate "—" fallback logic, real but low-severity and explicitly out of scope for THIS plan — do not attempt to fix it here unless your visual pass naturally touches that exact line, in which case fixing it as a drive-by is fine but not required).
- [ ] **Step 2: Apply loading state** to earnings history and stat values before first fetch.
- [ ] **Step 3: Apply alert component** to `claimRewards()`'s result feedback if it currently just refreshes silently or uses ad-hoc feedback markup instead of a consistent alert.
- [ ] **Step 4: Apply empty state** for zero earnings history (verify one exists and matches the shared pattern).
- [ ] **Step 5: Verify in browser** — golden path, loading, empty, and claim-rewards feedback.
- [ ] **Step 6: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 7: Commit** as `feat(dashboard): apply design system to Wallet tab`.

---

### Task 7: Apply design system to API & Apps tab

**Files:** Modify `web/dashboard.html:622-679` (API & Apps page markup) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current API & Apps tab markup and JS** (the App Store grid — `.app-cat-wrap`/`.app-card`/`.app-store-grid` classes already exist and look well-developed; this tab is the NaaS Docker apps feature per `README.md`).
- [ ] **Step 2: Apply loading state** to the app grid before the catalog/install-status fetch resolves.
- [ ] **Step 3: Apply alert component** to install/uninstall/start/stop action feedback if not already consistent — check `#pull-overlay`/`.pull-box`/`.pull-log` (an existing modal-style progress UI for model pulls, may be reused or may be Models-tab-only; if this tab has its own separate ad-hoc progress feedback for app installs, either reuse the same pattern or make it use `.alert` for simple success/fail cases, keeping the existing progress-log modal for genuinely long-running installs — use judgment, note your reasoning in the report).
- [ ] **Step 4: Verify in browser** — golden path (browse catalog, install/start/stop an app if safe to do so without disrupting the live dev environment — prefer a lightweight/no-op app if one exists, otherwise verify via code + a dry look at the network tab rather than actually installing something heavy).
- [ ] **Step 5: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 6: Commit** as `feat(dashboard): apply design system to API & Apps tab`.

---

### Task 8: Apply design system to Blockchain tab

**Files:** Modify `web/dashboard.html:680-735` (Blockchain page markup) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current Blockchain tab markup and JS.** Per the spec, this is one of the "denser" tabs the redesign specifically calls out for better information grouping — read it fully before touching anything, and form a concrete view of what's crowded before restructuring (don't restructure blind).
- [ ] **Step 2: Apply spacing/grouping improvements.** Using `--space-*` tokens and the existing `.grid-2`/`.grid-3`/`.grid-4`/`.card` patterns, group related contract/chain information more clearly (e.g. related `.contract-row` entries under one `.card` with a clear `.card-title`, rather than a flat unstructured list, if that's what you find) — this is a real layout-organization judgment call specific to what this tab actually contains; make it and explain your grouping decision in the report.
- [ ] **Step 3: Apply loading state** to contract/chain data before first fetch.
- [ ] **Step 4: Verify in browser** — golden path, and confirm the regrouping didn't hide or remove any information that was previously visible (same data, better organized, not less data).
- [ ] **Step 5: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 6: Commit** as `feat(dashboard): apply design system + improve information grouping on Blockchain tab`.

---

### Task 9: Apply design system to Settings tab

**Files:** Modify `web/dashboard.html:736-812` (Settings page markup) and its JS.

**Interfaces:** Consumes Task 1's tokens/components.

- [ ] **Step 1: Read the current Settings tab markup and JS.** Also one of the "denser" tabs per the spec (PIN change, update-check banner/fields, Telegram link badge, node config — all reworked or added during dashboard-reliability-fix this session; read current live state). Group related settings sections clearly (e.g. Security/PIN, Updates, Telegram, Node Config as visually distinct `.card` sections if they aren't already) using `--space-*` tokens.
- [ ] **Step 2: Apply alert component** to the PIN-change flow's success/failure feedback and any other settings action (e.g. Telegram link) that currently lacks clear inline feedback.
- [ ] **Step 3: Verify in browser** — golden path for each settings action, confirm PIN change still actually works end-to-end (this is a real auth-affecting flow — verify it, don't just eyeball the markup).
- [ ] **Step 4: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 5: Commit** as `feat(dashboard): apply design system + improve information grouping on Settings tab`.

---

### Task 10: Cross-tab consistency and responsive verification

**Files:** `web/dashboard.html` — fixes only where Step 1 finds real inconsistency; otherwise report-only.

**Interfaces:** Consumes: the state of all 9 tabs after Tasks 1-9.

- [ ] **Step 1: Cross-tab visual consistency pass.** Open every tab in the browser (`npm run dev`, `localhost:8080`) in sequence. Check: do cards, badges, buttons, spacing look consistent tab-to-tab (not just within each tab)? Does any tab still have a raw pixel value that should now be a `--space-*`/`--text-*` token given Tasks 1-9's precedent? Fix what you find — this is the pass that catches drift between 9 separately-executed tasks.
- [ ] **Step 2: Responsive verification.** Using browser devtools' device toolbar (or resizing the window), check every tab at a narrow viewport (e.g. 375px width, matching a phone opened via the Telegram mini-app per `README.md`'s stated mobile feature). The existing `@media(max-width:768px)` rule (`web/dashboard.html:206-213`) collapses the sidebar to icons-only and adjusts grids — confirm this still holds for every tab after Tasks 1-9's changes, and fix any tab where content now overflows, overlaps, or becomes unreadable at that width.
- [ ] **Step 3: Full regression check.** Click through every nav item, confirm every tab still loads and every button/action from before this plan still works — this plan changed appearance/structure only, so a real behavioral regression here is a bug in one of Tasks 1-9, not something new to design; fix it if found (small, targeted fix; if it's larger, note it clearly in the report instead of a rushed fix).
- [ ] **Step 4: `node_modules/.bin/tsc --noEmit` and `npx vitest run` clean.**
- [ ] **Step 5: Commit** any fixes as `fix(dashboard): cross-tab consistency + responsive fixes`. If Steps 1-3 found nothing, no commit needed — note "no changes needed, verified clean" in the report.
