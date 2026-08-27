# Node UI Mode Split — Design Spec

**Status:** Approved  
**Date:** 2026-08-27  
**Sub-project:** E

---

## Problem

The GSTD node dashboard shows every page — IPFS pinning, validators,
blockchain stats, developer API snippets — to every user equally. Most
node operators are here to: run inference, earn GSTD, and see their
wallet. The power-user and experimental pages create visual clutter and
set false expectations (validators require 16-32 GB dedicated servers;
IPFS is experimental; fine-tuning controls are in early access).

The ROADMAP explicitly deferred this until the dashboard redesign (sub-project A)
landed and produced a stable baseline. That baseline is now in place.

---

## Goal

Default new (and existing) nodes to a **Simple** view showing only core
pages. Users who want more can switch to **Advanced** or **Developer**
in one click. The mode is remembered in localStorage; there are no
server changes.

---

## Mode Definitions

| Mode | Pages visible | Audience |
|------|--------------|----------|
| **Simple** (default) | Home, Chat, Models, Wallet, Settings | Operators who run inference and earn |
| **Advanced** | + IPFS, Blockchain, API & Apps | Power users connecting tools, watching on-chain stats |
| **Developer** | + Validators | Builders running validator stacks |

Rules:
- Higher modes include all lower-mode pages (cumulative, not exclusive).
- The default mode for first-time visitors is **Simple**.
- Mode is stored in `localStorage` under key `gstd_ui_mode`.
- A page requested via `showPage()` while below its required mode silently redirects to Home — no error, no modal.
- Home quick-buttons that link to advanced/developer pages are hidden in Simple mode.

---

## Architecture

### 1. Mode storage

```js
const MODES = ['simple', 'advanced', 'developer'];
function getMode()  { return localStorage.getItem('gstd_ui_mode') || 'simple'; }
function setMode(m) { localStorage.setItem('gstd_ui_mode', m); applyMode(m); }
```

### 2. Page minimum-mode table

Encoded as a JS object (not HTML attributes — avoids DOM scraping):

```js
const PAGE_MIN_MODE = {
  home:       'simple',
  chat:       'simple',
  models:     'simple',
  wallet:     'simple',
  settings:   'simple',
  ipfs:       'advanced',
  blockchain: 'advanced',
  api:        'advanced',
  validators: 'developer',
};
```

### 3. `applyMode(mode)`

Called on page load and whenever mode changes:

1. Set `document.body.dataset.mode = mode` (drives all CSS).
2. Re-run `showPage(currentPage)` — if current page is now above the mode,
   redirect to Home.
3. Sync the mode-switcher chip to the active button.

### 4. `showPage()` guard

At the top of the existing `showPage(name)` function, before any other logic:

```js
const minMode = PAGE_MIN_MODE[name] || 'simple';
if (MODES.indexOf(minMode) > MODES.indexOf(getMode())) {
  showPage('home');
  return;
}
```

### 5. CSS visibility

Nav items get a `data-min-mode` HTML attribute. CSS hides them when the body mode
is below the item's minimum:

```css
/* Hide advanced nav items in simple mode */
body[data-mode="simple"] .nav-item[data-min-mode="advanced"],
body[data-mode="simple"] .nav-item[data-min-mode="developer"],
body[data-mode="simple"] .nav-section-label[data-min-mode="advanced"] {
  display: none;
}

/* Hide developer nav items in simple and advanced modes */
body[data-mode="simple"]   .nav-item[data-min-mode="developer"],
body[data-mode="advanced"] .nav-item[data-min-mode="developer"],
body[data-mode="simple"]   .nav-section-label[data-min-mode="developer"],
body[data-mode="advanced"] .nav-section-label[data-min-mode="developer"] {
  display: none;
}
```

### 6. Mode-switcher chip

A small fixed element in the sidebar footer, below the nav:

```
[ Simple  Advanced  Developer ]
```

Three pill buttons. Active button is highlighted (accent color). Clicking switches
mode immediately. No confirmation, no reload.

HTML goes at the bottom of `<nav class="sidebar-nav">`, before `</nav>`:

```html
<div class="mode-switcher" id="mode-switcher">
  <button class="mode-btn active" data-mode="simple"   onclick="setMode('simple')">Simple</button>
  <button class="mode-btn"        data-mode="advanced" onclick="setMode('advanced')">Advanced</button>
  <button class="mode-btn"        data-mode="developer" onclick="setMode('developer')">Dev</button>
</div>
```

### 7. Home quick-buttons

The four quick-buttons on Home link to Chat, Models, Wallet, and API & Apps.
The "API & Apps" button is advanced-only — hide it in Simple mode:

```html
<div class="quick-btn" onclick="showPage('api')" data-min-mode="advanced">...</div>
```

CSS:
```css
body[data-mode="simple"] [data-min-mode="advanced"] { display: none; }
```

### 8. Nav section labels

The sidebar currently has section labels: "Overview", "AI", "Storage & Network",
"Economy", "Developer", "System". The "Storage & Network" and "Developer" labels
should be hidden when all their items are hidden.

Assign `data-min-mode` to each section label matching the minimum mode of the
lowest-mode item in that section:

- "Storage & Network" → `data-min-mode="advanced"` (IPFS and Validators)
- "Developer" → `data-min-mode="advanced"` (API & Apps)

---

## Sidebar collapsed state (mobile)

The existing CSS collapses the sidebar on narrow viewports (hides text, shows only icons).
The mode-switcher must also collapse — show nothing (it's not usable icon-only).
Already handled by the mobile collapse rule if the mode-switcher is inside `.sidebar-nav`.

---

## Testing

1. Fresh visit (no localStorage): mode is `simple`; IPFS, Validators, Blockchain,
   API & Apps nav items absent; mode-switcher shows Simple active.
2. Switch to Advanced: IPFS, Blockchain, API & Apps appear; Validators absent.
3. Switch to Developer: Validators appear; all pages accessible.
4. Direct call to `showPage('validators')` in Simple mode: redirects to Home.
5. Mode persists on page reload (localStorage).
6. Switching back to Simple while on IPFS page: redirects to Home.

---

## Files touched

| File | Change |
|------|--------|
| `web/dashboard.html` | Add `data-min-mode` to nav items + section labels; add mode-switcher HTML; add CSS rules; add JS constants + functions; update `showPage()`; update Home quick-buttons; call `applyMode()` on startup |

No server-side changes. No new files.

---

## Non-goals

- No per-user mode stored on the server.
- No "locked" modes — any user can switch freely.
- No feature flags or backend gating.
- No changes to any server endpoint or auth logic.
- No renaming or removing any existing page.
