# Node UI Mode Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Simple / Advanced / Developer mode switching to the GSTD node dashboard, hiding power-user and experimental pages from default (Simple) view.

**Architecture:** Single-file change to `web/dashboard.html`. Mode stored in `localStorage`. CSS attribute selectors hide elements above the current mode. `showPage()` guards against direct navigation to hidden pages. A mode-switcher chip in the sidebar lets users switch instantly.

**Tech Stack:** Vanilla HTML/CSS/JS — no build step, no test framework. Verification is done with a live browser against the running node (pm2 gstdbot, port 8080).

**Spec:** `docs/superpowers/specs/2026-08-27-node-ui-mode-split-design.md`

## Global Constraints

- Single file only: `web/dashboard.html`. No server changes, no new files.
- Mode key in localStorage: `gstd_ui_mode` (exact string).
- Mode values: `'simple'` | `'advanced'` | `'developer'` (lowercase strings, exact).
- Default when no localStorage entry: `'simple'`.
- Page-to-mode mapping (exact): home/chat/models/wallet/settings → simple; ipfs/blockchain/api → advanced; validators → developer.
- No existing dashboard routes, endpoints, or auth logic may change.
- Empty peer table, missing API data, or offline node must never crash the mode system.
- `data-min-mode` attribute values match mode strings exactly: `"simple"`, `"advanced"`, `"developer"`.

---

### Task 1: CSS rules + JS mode system

**Files:**
- Modify: `web/dashboard.html` — CSS block (inside `<style>`) and JS section

**Interfaces:**
- Produces:
  - `MODES: string[]` — `['simple', 'advanced', 'developer']`, index = rank
  - `PAGE_MIN_MODE: Record<string, string>` — page name → minimum mode string
  - `_curPage: string` — module-level variable, current active page name, init `'home'`
  - `getMode(): string` — reads `localStorage.getItem('gstd_ui_mode') || 'simple'`
  - `setMode(m: string): void` — writes localStorage, calls `applyMode(m)`
  - `applyMode(m: string): void` — sets `body.dataset.mode`, syncs `.mode-btn.active`, redirects if `_curPage`'s min mode > `m`
  - `showPage(name)` — same signature, gains mode guard at top and `_curPage = name` assignment

- [ ] **Step 1: Add CSS mode-visibility rule**

Find the closing `}` of the `@media(max-width:768px)` block (the block that contains `.grid-2,.grid-3,.grid-4{grid-template-columns:1fr 1fr}` and the sidebar collapse rules). Insert the following **after** that closing `}` and before the `/* ── Quick Actions */` comment:

```css
  /* ── Mode Visibility ─────────────────────────────────────────────────── */
  body[data-mode="simple"] [data-min-mode="advanced"],
  body[data-mode="simple"] [data-min-mode="developer"],
  body[data-mode="advanced"] [data-min-mode="developer"] { display:none }
```

- [ ] **Step 2: Add `.mode-switcher` and `.mode-btn` CSS**

Immediately after the mode-visibility rule from Step 1, add:

```css
  /* ── Mode Switcher ───────────────────────────────────────────────────── */
  .mode-switcher{display:flex;margin:12px 16px 4px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:3px;gap:2px}
  .mode-btn{flex:1;padding:5px 4px;border:none;background:none;color:var(--muted);font-size:10px;font-weight:600;border-radius:6px;cursor:pointer;font-family:inherit;transition:all 0.15s;text-transform:uppercase;letter-spacing:0.04em}
  .mode-btn:hover{color:var(--text)}
  .mode-btn.active{background:rgba(139,92,246,0.25);color:var(--accent)}
```

- [ ] **Step 3: Hide mode-switcher on mobile**

Find the mobile `@media(max-width:768px)` rule that contains this line:

```
.sidebar .nav-section-label,.sidebar .nav-item span:not(.nav-icon),.logo-name,.logo-status,.node-id-badge{display:none}
```

Append `.sidebar .mode-switcher` to that selector, making it:

```css
    .sidebar .nav-section-label,.sidebar .nav-item span:not(.nav-icon),.logo-name,.logo-status,.node-id-badge,.sidebar .mode-switcher{display:none}
```

- [ ] **Step 4: Fix quick-grid for variable button count**

Find the `.quick-grid` rule inside the `/* ── Quick Actions */` block:

```css
  .quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
```

Change `repeat(4,1fr)` to `repeat(auto-fit,minmax(120px,1fr))` so the grid auto-adjusts when the API & Apps button is hidden in Simple mode:

```css
  .quick-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px}
```

- [ ] **Step 5: Add JS mode constants and _curPage variable**

Find the JS section. Locate the `// ── Navigation` comment (just above `function showPage`). Insert the following **before** that comment:

```js
// ── Mode system ────────────────────────────────────────────────────────
const MODES = ['simple', 'advanced', 'developer'];
const PAGE_MIN_MODE = {
  home:'simple', chat:'simple', models:'simple', wallet:'simple', settings:'simple',
  ipfs:'advanced', blockchain:'advanced', api:'advanced',
  validators:'developer',
};
let _curPage = 'home';
function getMode(){ return localStorage.getItem('gstd_ui_mode') || 'simple'; }
function setMode(m){ localStorage.setItem('gstd_ui_mode', m); applyMode(m); }
function applyMode(m){
  document.body.dataset.mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  const minMode = PAGE_MIN_MODE[_curPage] || 'simple';
  if (MODES.indexOf(minMode) > MODES.indexOf(m)) showPage('home');
}
```

- [ ] **Step 6: Update onAuth to call applyMode on startup**

Find:
```js
function onAuth(){ showPage('home'); checkUpdBanner(); }
```

Replace with:
```js
function onAuth(){ applyMode(getMode()); showPage('home'); checkUpdBanner(); }
```

(`applyMode` before `showPage` so `body.dataset.mode` is set before the nav renders.)

- [ ] **Step 7: Add mode guard and _curPage tracking to showPage**

Find the `showPage` function:
```js
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
```

Replace with:
```js
function showPage(name){
  const _minMode = PAGE_MIN_MODE[name] || 'simple';
  if (MODES.indexOf(_minMode) > MODES.indexOf(getMode())) { showPage('home'); return; }
  _curPage = name;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
```

- [ ] **Step 8: Commit Task 1**

```bash
git add web/dashboard.html
git commit -m "feat: add UI mode system (CSS+JS, no HTML wiring yet)"
```

Expected: commit succeeds. No visual change yet — `body.dataset.mode` won't be set until Task 2 wires `onAuth`.

---

### Task 2: HTML wiring — attributes, mode-switcher markup

**Files:**
- Modify: `web/dashboard.html` — HTML body only (nav, sidebar footer, home quick-grid)

**Interfaces:**
- Consumes (from Task 1): `setMode(m)`, `MODES`, `PAGE_MIN_MODE`, `_curPage`, `applyMode(m)`, `getMode()`
- Produces: fully working mode split visible in the browser

- [ ] **Step 1: Add data-min-mode to IPFS nav item**

Find:
```html
    <div class="nav-item" onclick="showPage('ipfs')"><span class="nav-icon">&#x1F4E6;</span><span>IPFS</span></div>
```

Replace with:
```html
    <div class="nav-item" data-min-mode="advanced" onclick="showPage('ipfs')"><span class="nav-icon">&#x1F4E6;</span><span>IPFS</span></div>
```

- [ ] **Step 2: Add data-min-mode to Validators nav item**

Find:
```html
    <div class="nav-item" onclick="showPage('validators')"><span class="nav-icon">&#x26D3;</span><span>Validators</span></div>
```

Replace with:
```html
    <div class="nav-item" data-min-mode="developer" onclick="showPage('validators')"><span class="nav-icon">&#x26D3;</span><span>Validators</span></div>
```

- [ ] **Step 3: Add data-min-mode to Blockchain nav item**

Find:
```html
    <div class="nav-item" onclick="showPage('blockchain')"><span class="nav-icon">&#x26D3;&#xFE0F;</span><span>Blockchain</span></div>
```

Replace with:
```html
    <div class="nav-item" data-min-mode="advanced" onclick="showPage('blockchain')"><span class="nav-icon">&#x26D3;&#xFE0F;</span><span>Blockchain</span></div>
```

- [ ] **Step 4: Add data-min-mode to API & Apps nav item**

Find:
```html
    <div class="nav-item" onclick="showPage('api')"><span class="nav-icon">&#x1F50C;</span><span>API &amp; Apps</span></div>
```

Replace with:
```html
    <div class="nav-item" data-min-mode="advanced" onclick="showPage('api')"><span class="nav-icon">&#x1F50C;</span><span>API &amp; Apps</span></div>
```

- [ ] **Step 5: Add data-min-mode to "Storage & Network" section label**

Find:
```html
    <div class="nav-section-label">Storage &amp; Network</div>
```

Replace with:
```html
    <div class="nav-section-label" data-min-mode="advanced">Storage &amp; Network</div>
```

(The label appears in Advanced mode because IPFS is advanced. Validators is developer but shares this section — the label stays visible in Advanced showing only IPFS.)

- [ ] **Step 6: Add data-min-mode to "Developer" section label**

Find:
```html
    <div class="nav-section-label">Developer</div>
```

Replace with:
```html
    <div class="nav-section-label" data-min-mode="advanced">Developer</div>
```

(API & Apps is advanced, so this label appears in Advanced+.)

- [ ] **Step 7: Add mode-switcher HTML to sidebar**

Find the closing `</nav>` tag inside `.sidebar` (the one right after the last `</div>` of the nav items, before `<div class="sidebar-footer">`):

```html
  </nav>
  <div class="sidebar-footer">
```

Insert the mode-switcher between them:

```html
  </nav>
  <div class="mode-switcher" id="mode-switcher">
    <button class="mode-btn" data-mode="simple"    onclick="setMode('simple')">Simple</button>
    <button class="mode-btn" data-mode="advanced"  onclick="setMode('advanced')">Advanced</button>
    <button class="mode-btn" data-mode="developer" onclick="setMode('developer')">Dev</button>
  </div>
  <div class="sidebar-footer">
```

- [ ] **Step 8: Hide API & Apps quick-button in Simple mode**

Find the Home quick-button for App Store (it links to `showPage('api')`):

```html
      <div class="quick-btn" onclick="showPage('api')">
        <span class="qi">🛒</span>
        <div class="ql">App Store</div>
        <div class="qs" id="qa-apps">Browse apps</div>
      </div>
```

Add `data-min-mode="advanced"` to the div:

```html
      <div class="quick-btn" data-min-mode="advanced" onclick="showPage('api')">
        <span class="qi">🛒</span>
        <div class="ql">App Store</div>
        <div class="qs" id="qa-apps">Browse apps</div>
      </div>
```

- [ ] **Step 9: Verify in browser — Simple mode (default)**

The node dashboard runs at `http://localhost:8080`. Open it in a browser (or use curl to confirm the file is served). After authenticating with PIN:

Expected in Simple mode (first visit, no localStorage):
- Sidebar shows: Home, AI section (Models, Chat), Economy section (Wallet), System section (Settings)
- Sidebar does NOT show: "Storage & Network" section label, IPFS, Validators, "Developer" section label, API & Apps, Blockchain
- Home quick-grid shows 3 buttons: Chat, Pull a Model, My Wallet (App Store button hidden)
- Mode switcher visible in sidebar: "Simple" button active (accent color)

Verify by opening browser devtools console and running:
```js
localStorage.getItem('gstd_ui_mode') // should be null or 'simple'
document.body.dataset.mode           // should be 'simple'
```

- [ ] **Step 10: Verify — switch to Advanced**

Click "Advanced" in the mode-switcher chip.

Expected:
- IPFS, Blockchain, API & Apps nav items appear
- "Storage & Network" and "Developer" section labels appear
- Validators nav item still hidden
- Home quick-grid shows 4 buttons (App Store reappears)
- "Advanced" button is now highlighted in mode-switcher

Verify:
```js
localStorage.getItem('gstd_ui_mode') // 'advanced'
document.body.dataset.mode           // 'advanced'
```

- [ ] **Step 11: Verify — switch to Developer**

Click "Dev" in the mode-switcher.

Expected:
- Validators nav item appears
- All pages accessible

- [ ] **Step 12: Verify — redirect guard**

In browser console (while in Simple mode — switch back first):
```js
setMode('simple'); showPage('validators');
```

Expected: redirects to Home page (validators is developer-only, Simple mode doesn't allow it).

- [ ] **Step 13: Verify — mode persists on reload**

Set mode to Advanced, then refresh the page (re-authenticate with PIN).

Expected: Advanced mode is active immediately after auth (mode-switcher shows "Advanced" highlighted, IPFS/Blockchain/API nav items visible from the start).

- [ ] **Step 14: Commit Task 2**

```bash
git add web/dashboard.html
git commit -m "feat: wire UI mode split — nav attributes, mode-switcher, simple default"
```

- [ ] **Step 15: Push to GitHub**

```bash
git push
```

Expected: push succeeds. CI runs TypeScript check (unchanged) and tests (unchanged).
