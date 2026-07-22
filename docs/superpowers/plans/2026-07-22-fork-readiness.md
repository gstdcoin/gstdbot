# gstdbot Fork-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove concrete blockers that stop someone from usefully forking this repo: a 36MB binary tracked in git, CI that will fail on every fork's first push, hardcoded single-user install paths with no override, a config-path inconsistency between two service-file templates, and 4 code-level duplicates of the GSTD token address with no single source of truth.

**Architecture:** Five independent, mechanical tasks. No behavior changes to the running node's actual logic -- only how it's configured/built/installed.

**Tech Stack:** TypeScript (Node.js 20), pm2/systemd for process management, GitHub Actions for CI.

## Global Constraints

- The GSTD jetton address is `EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO` -- correct everywhere it appears; the fix is consolidation of the 4 code-level (non-display) occurrences, not correction.
- Do NOT touch `src/channels/telegram.ts`'s occurrences (lines 341, 636, 1307, 1337) or `web/dashboard.html:705` -- these are user-facing marketing/display copy (Telegram bot responses, dashboard HTML), not application logic reading a config value. Consolidating those would require a different, larger change (templating into HTML/bot-response strings) that's out of scope here.
- Do NOT change the actual node registration/heartbeat/task-loop logic anywhere in this plan -- every task here is packaging/config/build hygiene only.
- Never touch `.env` (gitignored, untracked, confirmed) or any real secret.

---

## Task 1: Stop tracking the `cloudflared` binary

**Files:**
- Delete from git: `/home/bot/gstdbot/cloudflared` (36MB, third-party Cloudflare Tunnel executable)
- Modify: `/home/bot/gstdbot/.gitignore`
- Modify: whatever install/setup script currently assumes this binary is already present (check `tunnel.sh` and `ecosystem.config.js` for references)

- [ ] **Step 1: Confirm what references this binary**

```bash
cd /home/bot/gstdbot
grep -rn "\./cloudflared\|/cloudflared\b" --include="*.sh" --include="*.js" --include="*.ts" . 2>/dev/null | grep -v node_modules
```

Read every hit's surrounding context before proceeding -- you need to know exactly how it's invoked to replace it with a download-on-first-run step correctly.

- [ ] **Step 2: Add a download step**

In whichever script currently invokes `./cloudflared` directly (based on Step 1's findings), add a check-and-download block before the invocation, e.g.:
```bash
if [ ! -f "./cloudflared" ]; then
    echo "Downloading cloudflared..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64) CF_ARCH="amd64" ;;
        aarch64|arm64) CF_ARCH="arm64" ;;
        *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o ./cloudflared
    chmod +x ./cloudflared
fi
```
(adjust exact placement/syntax to match the actual file's existing style -- read it in full first)

- [ ] **Step 3: Remove from git tracking, add to .gitignore**

```bash
cd /home/bot/gstdbot
git rm --cached cloudflared
echo "/cloudflared" >> .gitignore
rm -f cloudflared
```

- [ ] **Step 4: Verify the download step works**

```bash
cd /home/bot/gstdbot
bash -n tunnel.sh   # or whichever file you edited -- syntax check
```

(Do not actually run the download in this verification step unless you can confirm it completes quickly and cleanly -- a syntax check is sufficient; live-testing the tunnel itself is out of scope for this task.)

- [ ] **Step 5: Commit**

```bash
cd /home/bot/gstdbot
git add .gitignore tunnel.sh  # adjust to whichever file(s) you actually edited
git commit -m "$(cat <<'EOF'
chore: stop tracking cloudflared binary, download on first run

A 36MB third-party executable (Cloudflare Tunnel) was committed
directly into the repo instead of being fetched at install time --
bloats every clone substantially and isn't a reproducible/verifiable
artifact (no way to confirm it matches the upstream release it claims
to be). Now downloaded on first run if missing, matching how other
third-party binaries in this repo (lite-client, helios, bitcoind) are
already handled in src/validators/manager.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Consolidate the GSTD address into one exported constant

**Files:**
- Modify: `/home/bot/gstdbot/src/blockchain/token.ts` (already has the closest thing to a canonical spot: a `CONTRACTS` map)
- Modify: `/home/bot/gstdbot/src/blockchain/bridge.ts`
- Modify: `/home/bot/gstdbot/src/index.ts`
- Modify: `/home/bot/gstdbot/src/wallet/tonconnect.ts`

**Interfaces:**
- Produces: `CONTRACTS.GSTD_TOKEN` (already exists in `token.ts`) becomes the one place the address+env-fallback pair is defined; the other 3 files import and use it instead of redeclaring their own.

- [ ] **Step 1: Confirm current state**

```bash
cd /home/bot/gstdbot
grep -n "GSTD_JETTON_ADDRESS\|GSTD_CONTRACT_TOKEN\|EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO" src/blockchain/token.ts src/blockchain/bridge.ts src/index.ts src/wallet/tonconnect.ts
```

Confirm the brief's described lines still match (line numbers may have drifted): `token.ts` should have `GSTD_TOKEN: process.env.GSTD_CONTRACT_TOKEN || 'EQDv6...'` inside a `CONTRACTS` object; `bridge.ts`, `index.ts` (x2 sites), and `tonconnect.ts` should each independently read `process.env.GSTD_JETTON_ADDRESS || 'EQDv6...'`.

- [ ] **Step 2: Export `CONTRACTS` from `token.ts` if not already exported**

Read the file to confirm `CONTRACTS` is exported (`export const CONTRACTS = {...}` or similar). If it's not currently exported, add `export` to its declaration.

- [ ] **Step 3: Update `bridge.ts`**

Read the file to find the exact current line (`TON: 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',` inside some object, currently around line 52). Add an import at the top of the file:
```typescript
import { CONTRACTS } from './token';
```
(adjust the relative path if `bridge.ts` and `token.ts` aren't in the same directory -- verify before committing)

Replace the hardcoded literal with `CONTRACTS.GSTD_TOKEN`.

- [ ] **Step 4: Update `index.ts`**

Read the file to find both occurrences (currently lines 322 and 338: `gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',`). Add an import (adjust path to match `index.ts`'s location relative to `src/blockchain/token.ts`):
```typescript
import { CONTRACTS } from './blockchain/token';
```
Replace both occurrences of `process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO'` with `CONTRACTS.GSTD_TOKEN`.

- [ ] **Step 5: Update `tonconnect.ts`**

Read the file to find the current line (around line 55: `gstdJettonAddress: process.env.GSTD_JETTON_ADDRESS || 'EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO',`). Add an import (adjust path):
```typescript
import { CONTRACTS } from '../blockchain/token';
```
Replace the occurrence with `CONTRACTS.GSTD_TOKEN`.

- [ ] **Step 6: Verify no remaining duplication in application logic**

```bash
cd /home/bot/gstdbot
grep -rn "GSTD_JETTON_ADDRESS\|process\.env\.GSTD_CONTRACT_TOKEN" src/
```

Expected: only `src/blockchain/token.ts`'s own definition remains (reading `GSTD_CONTRACT_TOKEN`). No other file should read `GSTD_JETTON_ADDRESS` directly anymore -- if you find one, it means either a call site was missed or `GSTD_JETTON_ADDRESS` and `GSTD_CONTRACT_TOKEN` were actually two DIFFERENT env vars a caller might rely on separately; if so, STOP and report NEEDS_CONTEXT rather than assuming they're interchangeable.

- [ ] **Step 7: Typecheck and build**

```bash
cd /home/bot/gstdbot
npx tsc --noEmit
npm run build
```

Expected: no errors.

- [ ] **Step 8: Run existing tests**

```bash
cd /home/bot/gstdbot
npm test
```

Expected: same pass/fail state as before this change (this is a pure refactor, no test should newly fail).

- [ ] **Step 9: Commit**

```bash
cd /home/bot/gstdbot
git add src/blockchain/token.ts src/blockchain/bridge.ts src/index.ts src/wallet/tonconnect.ts
git commit -m "$(cat <<'EOF'
chore: consolidate GSTD token address into one exported constant

The jetton address EQDv6cYW9nNiKjN3Nwl8D6ABjUiH1gYfWVGZhfP7-9tZskTO was
independently duplicated (each with its own env-var-fallback pair) in
4 places across bridge.ts, index.ts (x2), and tonconnect.ts, despite
token.ts's CONTRACTS map already being the closest thing to a
canonical definition. All 4 now import CONTRACTS.GSTD_TOKEN instead of
redeclaring the literal -- a fork changing tokens now has one place to
edit instead of five.

Left untouched: telegram.ts's 4 occurrences and dashboard.html's 1 --
these are user-facing marketing/display copy, not application logic,
and consolidating them is a different, larger change out of this
task's scope.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix CI so forks don't get a failing Docker push job

**Files:**
- Modify: `/home/bot/gstdbot/.github/workflows/docker.yml`

- [ ] **Step 1: Read the current workflow in full**

```bash
cat /home/bot/gstdbot/.github/workflows/docker.yml
```

Confirm the current structure: triggers on `push` to `main` and on `tags: ["v*"]`, hardcodes `env.IMAGE_NAME: gstdcoin/gstd-node`, logs into `ghcr.io` using `secrets.GITHUB_TOKEN` (which forks DO have, but it only has push rights to the FORK's own package registry namespace, not `gstdcoin`'s).

- [ ] **Step 2: Guard the job to only run in the canonical repo**

Add a job-level (or step-level) condition so the build-and-push job simply doesn't run at all on a fork, rather than running and failing. Add this to the `build-and-push` job, immediately after its `runs-on:` line:
```yaml
    if: github.repository == 'gstdcoin/gstd-node'
```

(Read the file first to confirm the exact job name and structure before inserting -- the brief's line reference may have drifted. If the job is named something other than `build-and-push`, apply the `if:` to whatever the actual job key is.)

- [ ] **Step 3: Verify YAML validity**

```bash
cd /home/bot/gstdbot
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/docker.yml'))" && echo "OK: valid YAML"
```

(if `python3-yaml` isn't available, use `npx js-yaml .github/workflows/docker.yml > /dev/null && echo OK` instead -- whichever tool is actually available in this environment)

- [ ] **Step 4: Commit**

```bash
cd /home/bot/gstdbot
git add .github/workflows/docker.yml
git commit -m "$(cat <<'EOF'
fix(ci): skip Docker publish job on forks instead of failing it

IMAGE_NAME was hardcoded to gstdcoin/gstd-node -- on any fork, this
job would run on every push to main (or tag), attempt to push to a
registry namespace the fork's GITHUB_TOKEN has no rights to, and fail
as a red CI check for a workflow the fork's maintainer never asked to
run. Added a repository guard so the job simply doesn't run at all
outside the canonical repo, rather than running and failing loudly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add env-var overrides for hardcoded validator binary paths

**Files:**
- Modify: `/home/bot/gstdbot/src/validators/manager.ts`

**Interfaces:**
- Produces: 3 new (optional) env vars -- `GSTD_LITE_CLIENT_DIR`, `GSTD_HELIOS_DIR`, `GSTD_BITCOIN_DIR` -- each defaulting to the current hardcoded path, matching the existing pattern already used one line above for `GSTD_CONFIG_DIR`.

- [ ] **Step 1: Read the file to confirm current state**

```bash
cd /home/bot/gstdbot
grep -n "'/home/bot/ton-bin\|'/home/bot/helios-bin\|'/home/bot/bitcoin-bin\|GSTD_CONFIG_DIR" src/validators/manager.ts
```

Confirm the brief's described lines (192, 231, 262, 339-340, 347-348, 355-356) still match -- line numbers may have drifted.

- [ ] **Step 2: Add the 3 env-var-backed directory constants**

Near the existing `const CONFIG_DIR = process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot';` line (currently line 26), add:
```typescript
const LITE_CLIENT_DIR = process.env.GSTD_LITE_CLIENT_DIR || '/home/bot/ton-bin';
const HELIOS_DIR = process.env.GSTD_HELIOS_DIR || '/home/bot/helios-bin';
const BITCOIN_DIR = process.env.GSTD_BITCOIN_DIR || '/home/bot/bitcoin-bin';
```

- [ ] **Step 3: Replace every hardcoded occurrence with the new constants**

For each of the 3 binaries, replace every hardcoded path string with the corresponding constant, preserving the exact rest of each line. For example (lite-client, currently lines 192, 339, 340):
```typescript
const binPath = '/home/bot/ton-bin/lite-client';
```
becomes:
```typescript
const binPath = `${LITE_CLIENT_DIR}/lite-client`;
```
and:
```typescript
mkdirSync('/home/bot/ton-bin', { recursive: true });
execSync(`curl -fsSL "${url}" -o /home/bot/ton-bin/lite-client && chmod +x /home/bot/ton-bin/lite-client`, { timeout: 120000 });
```
becomes:
```typescript
mkdirSync(LITE_CLIENT_DIR, { recursive: true });
execSync(`curl -fsSL "${url}" -o ${LITE_CLIENT_DIR}/lite-client && chmod +x ${LITE_CLIENT_DIR}/lite-client`, { timeout: 120000 });
```

Apply the equivalent substitution for `HELIOS_DIR` (currently lines 231, 347-348) and `BITCOIN_DIR` (currently lines 262, 355-356) -- read each block in full before editing to preserve exact surrounding logic (the bitcoind block extracts from a `/tmp/btc-tmp` staging dir first; only the final destination path changes, not the staging logic).

- [ ] **Step 4: Verify no remaining hardcoded occurrences**

```bash
cd /home/bot/gstdbot
grep -n "'/home/bot/ton-bin\|'/home/bot/helios-bin\|'/home/bot/bitcoin-bin" src/validators/manager.ts
```

Expected: no output (all replaced with the new constants; the constants' own definitions use these strings as defaults, so if your grep pattern matches those too, that's expected and fine -- only flag it if a *usage* site, not a *definition*, still has the literal).

- [ ] **Step 5: Typecheck and build**

```bash
cd /home/bot/gstdbot
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add src/validators/manager.ts
git commit -m "$(cat <<'EOF'
chore: add env-var overrides for validator binary install paths

lite-client, helios, and bitcoind install paths were hardcoded to
/home/bot/*-bin with no override, unlike CONFIG_DIR one line above
(already GSTD_CONFIG_DIR-overridable) -- breaks for any deployment
under a different user or host. Added GSTD_LITE_CLIENT_DIR/
GSTD_HELIOS_DIR/GSTD_BITCOIN_DIR env vars, each defaulting to the
current path, matching the existing CONFIG_DIR pattern.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix `scripts/gstd-node.service`'s inconsistent path

**Files:**
- Modify: `/home/bot/gstdbot/scripts/gstd-node.service`

- [ ] **Step 1: Read both service files to compare**

```bash
cat /home/bot/gstdbot/gstdbot.service
echo "---"
cat /home/bot/gstdbot/scripts/gstd-node.service
```

Confirm: `gstdbot.service` (repo root) consistently uses `/home/bot/...` throughout; `scripts/gstd-node.service` uses `/home/ubuntu/gstdbot` for `WorkingDirectory` (currently line 10) while everything else in this ecosystem (this repo's other service file, `ecosystem.config.js`, `tunnel.sh`) assumes `/home/bot`.

- [ ] **Step 2: Decide and document, rather than silently guess, which convention this specific file should follow**

Read the rest of `scripts/gstd-node.service` in full -- if every OTHER path in this file already says `/home/ubuntu` (not just `WorkingDirectory`), then this file was written for a different default user intentionally (e.g., as a generic "adjust for your user" template distinct from the repo-root `gstdbot.service`, which is this specific deployment's actual file) and changing just one line to `/home/bot` while leaving the rest `/home/ubuntu` would create a NEW internal inconsistency instead of fixing one. Check every path in the file:

```bash
grep -n "/home/" /home/bot/gstdbot/scripts/gstd-node.service
```

If ALL paths in this file say `/home/ubuntu`, add a one-line comment at the top of the file instead of changing paths:
```
# Template assumes a user named "ubuntu" -- adjust all /home/ubuntu paths below
# to match your actual deployment user before installing.
```
and stop here -- do not change the paths, since they're internally consistent as a generic template using a different placeholder convention than this specific repo's own deployment.

If paths are MIXED within this one file (some `/home/ubuntu`, some `/home/bot`), fix the inconsistent ones to match whichever convention is used by the majority of lines in the same file, and report which you found in your final report.

- [ ] **Step 3: Commit (only if Step 2 found a real inconsistency to fix)**

```bash
cd /home/bot/gstdbot
git add scripts/gstd-node.service
git commit -m "$(cat <<'EOF'
docs: fix inconsistent path convention in scripts/gstd-node.service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If Step 2 concluded this file is an intentionally generic template and only a comment was added, use an appropriately adjusted commit message describing that instead.)

---

## Task 6: Final verification and push

**Files:** none (verification only).

- [ ] **Step 1: Full checks**

```bash
cd /home/bot/gstdbot
npx tsc --noEmit
npm run build
npm test
grep -rn "GSTD_JETTON_ADDRESS\|process\.env\.GSTD_CONTRACT_TOKEN" src/ | grep -v "src/blockchain/token.ts"
git status --short cloudflared
```

Expected: tsc/build/test all clean, the grep shows no output (Task 2 fully applied), and `cloudflared` shows no tracked-file status (confirms Task 1's `git rm --cached` took effect).

- [ ] **Step 2: Push**

```bash
cd /home/bot/gstdbot
git push origin main
```

(confirm the actual default branch name first with `git branch --show-current`)
