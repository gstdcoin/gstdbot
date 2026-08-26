# Dashboard Visual Redesign — Design

**Repo:** gstdbot
**Scope:** Sub-project G of the current work arc. Independent of sub-project F (full functional audit) — this is purely visual/UX, not a functional-correctness pass, though the two will touch the same file (`web/dashboard.html`) and should land in either order without conflict since F fixes JS data-wiring while G restyles CSS/markup structure.

## Problem

`web/dashboard.html` (1658 lines, single-page app, 9 tabs: Home, Models, Chat, IPFS, Validators, Wallet, Blockchain, API & Apps, Settings) already has a real design foundation — a dark theme (`--bg:#030014`), a violet/cyan accent pair (`--accent:#8b5cf6`, cyan gradients), Inter typography, gradient-text branding. It is not visually broken. But it was built incrementally across many features and fix passes (including this session's own dashboard-reliability-fix, which touched correctness, not polish) rather than designed as a system, and it shows: inconsistent component styling per-tab, uneven spacing rhythm, thin/missing empty and loading states, and no evidence of a deliberate information hierarchy within the denser tabs (Settings, Blockchain). The user wants a real design pass — "very beautiful, convenient, understandable, functional" — while keeping the existing structure and theme (confirmed: restyle in place, not a rebuild).

## Goal

A dashboard that:
1. Looks and feels like one coherent product across all 9 tabs, not 9 separately-styled pages sharing a stylesheet.
2. Has a real, consistent design system: a small fixed set of spacing values, type scale, component patterns (card, badge, button, table, empty-state, loading-state) reused everywhere rather than redefined per-tab.
3. Handles every UI state a real operator will hit — not just the happy path: empty (no models installed yet, no peers found, no earnings history), loading (data not yet fetched), and error (a fetch failed) — each tab currently has uneven or missing coverage of these.
4. Stays fully within the existing dark violet/cyan identity — no palette replacement, no framework swap (still hand-written CSS + vanilla JS, matching the existing file's approach, no build step introduced).
5. Remains genuinely functional after the pass — every interactive element this file currently wires up (buttons, forms, tab switches, SSE streams) keeps working exactly as before; this sub-project changes appearance and structure, not behavior. (Sub-project F is the one fixing behavior; if this pass discovers a functional bug while restyling, it gets fixed too, but finding bugs is not this sub-project's job.)

## Design system (the concrete deliverable this spec locks in)

- **Spacing scale:** a fixed set (e.g. 4/8/12/16/24/32/48px) replacing today's ad-hoc pixel values scattered through the inline `<style>` block.
- **Type scale:** a small number of font-size/weight pairs (e.g. display, heading, body, label, mono/code) instead of one-off sizes per element.
- **Color usage rules:** `--accent` reserved for primary actions and active states (already true in places, inconsistent in others); a defined semantic set for status (success/warning/error/info) reusing existing or minimally-extended CSS variables, not new one-off colors per tab.
- **Component library (CSS classes, not JS components — matching the existing vanilla approach):** card, stat-tile, badge (status variants), button (primary/secondary/danger), table, empty-state, loading-skeleton or spinner, toast/inline-alert for action feedback. Every tab draws from this set rather than inventing its own card/button markup.
- **Layout rhythm:** consistent section spacing and grid behavior within and across tabs, including a real pass on how the denser tabs (Settings, Blockchain, API & Apps) organize their information — grouping related controls, reducing visual noise, without changing what those controls do.
- **States:** every data-driven section gets an explicit empty state (with a short explanatory line, not a blank area) and a loading state (skeleton or spinner, not a flash of "0" or "undefined" while the first fetch is in flight — the exact kind of half-finished-looking moment that reads as "broken" even when the JS is correct).
- **Responsive behavior:** verify and fix as needed for narrower viewports (the dashboard is also opened from a Telegram mini-app / mobile browser per the node's own feature set) — this file should already have some responsive handling; the audit confirms it actually holds up rather than assuming.

## Approach

Restyle-in-place, tab by tab, each tab's markup/CSS brought onto the shared design system above, in an order that lets the system get established early and then just gets applied (not redesigned) on later tabs:
1. Establish the design system itself first — spacing/type scale as CSS custom properties, the shared component classes — proven out on the Home tab (the first thing any operator sees, and already a reasonable cross-section of card/stat/badge/list patterns).
2. Apply the established system to the remaining 8 tabs, each as its own reviewable unit, fixing that tab's specific empty/loading-state gaps and layout-density issues as it goes.
3. A final pass for cross-tab consistency and responsive verification.

## Out of scope

- Any behavioral/data-wiring change (sub-project F's job).
- A framework or build-tooling change (no React/Vue/Tailwind build step — stays a single static HTML file with inline CSS/JS, matching how this file is served today).
- New features/tabs not already present.
- Backend changes, except where a state (e.g. a genuinely missing "is this loading yet" signal) requires the frontend to know something the API doesn't currently expose cheaply — flag any such case rather than inventing a workaround, since that would cross into sub-project F's territory.

## Testing

Visual/manual verification: the dev server (`npm run dev`, dashboard at `localhost:8080`) checked in a browser for each tab after its pass — golden path plus at least one empty/loading/error state per tab where applicable, per this session's CLAUDE.md guidance to actually exercise UI changes rather than claim success from code-reading alone. No automated visual regression tooling introduced (out of scope, no existing precedent in this repo).
