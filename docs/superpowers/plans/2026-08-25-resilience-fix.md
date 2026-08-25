# Resilience Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the node from wastefully hammering an unreachable `app.gstdtoken.com` forever, and stop the P2P mesh from permanently disabling itself after one failed start attempt.

**Architecture:** A single shared circuit-breaker module (`src/lib/platform-health.ts`) is consulted at the two actual network choke points that matter — `SwarmAgent.apiCall()` in `src/swarm/agent.ts` (which turns out to be the ONE place all 8 of `agent.ts`'s polling loops already route through — confirmed by grep: every `heartbeat()`, `pollTasks()`, `pollPriorityInference()`, `fetchPeers()`, `fetchRewardsInfo()`, `joinActiveCampaigns()`, `retryPendingSettlements()`, and `retryPendingTaskReports()` call `this.apiCall(...)`) and `UptimeDaemon.sendHeartbeat()` in `src/naas/uptime_daemon.ts` (which has its own separate `fetch()`, unrelated to `apiCall()`). This means wiring the circuit breaker into exactly 2 call sites collapses all 9 originally-identified loops onto one shared backoff clock — simpler and less error-prone than touching all 9 individually, and equivalent in effect. The P2P mesh gets its own independent retry-with-backoff (separate state — a port-bind failure is unrelated to platform reachability), added without changing the timing of the current successful-start path.

**Tech Stack:** TypeScript (Node.js 20), no test framework in this repo (confirmed: no jest/vitest, no `*.test.*` files) — verification is `tsc`/`tsc --skipLibCheck` + manual math checks + live checks, matching this repo's established pattern.

## Global Constraints

- Backoff cap: 5 minutes (`5 * 60_000`ms), doubling from a 5-second base — `5s → 10s → 20s → 40s → 80s → 160s → 300s(cap)`.
- `recordSuccess()` resets immediately — no lingering slowness once the platform is reachable again.
- Do not change the behavior or timing of any code path when the platform IS reachable — this fix only changes what happens during sustained unreachability.
- Repo root for all paths below: `/home/bot/gstdbot/`.
- Import convention in this codebase: relative imports use explicit `.js` extensions even though source files are `.ts` (confirmed via existing imports, e.g. `src/swarm/agent.ts:17`: `import { logActivity } from '../gateway/server.js';`).

---

### Task 1: Shared circuit breaker module

**Files:**
- Create: `src/lib/platform-health.ts`

**Interfaces:**
- Produces: `platformHealth` (singleton instance) with methods `shouldAttempt(): boolean`, `recordSuccess(): void`, `recordFailure(): void`, `getStatus(): { connected: boolean; consecutiveFailures: number; nextAttemptInMs: number }`. Tasks 2, 3, and 5 import and use this exact singleton and these exact method names.

- [ ] **Step 1: Write the module**

```ts
/**
 * Shared circuit breaker for calls to the central platform (app.gstdtoken.com).
 *
 * All platform-facing polling loops in this process (SwarmAgent's 8 timers,
 * routed through its single apiCall() choke point, and UptimeDaemon's own
 * heartbeat) share ONE instance of this class. That means the moment any one
 * of them detects the platform is unreachable, all the others back off too --
 * instead of 9 independent loops each hammering a dead server on their own
 * fixed interval forever.
 */

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

class PlatformHealth {
    private consecutiveFailures = 0;
    private nextAttemptAt = 0;

    /** True if enough backoff time has elapsed since the last failure to try again. */
    shouldAttempt(): boolean {
        return Date.now() >= this.nextAttemptAt;
    }

    /** Call after a call to the platform succeeds (2xx response). Resets backoff immediately. */
    recordSuccess(): void {
        this.consecutiveFailures = 0;
        this.nextAttemptAt = 0;
    }

    /** Call after a call to the platform fails (network error OR non-2xx response). */
    recordFailure(): void {
        this.consecutiveFailures++;
        const backoff = Math.min(BASE_BACKOFF_MS * 2 ** this.consecutiveFailures, MAX_BACKOFF_MS);
        this.nextAttemptAt = Date.now() + backoff;
    }

    getStatus(): { connected: boolean; consecutiveFailures: number; nextAttemptInMs: number } {
        return {
            connected: this.consecutiveFailures === 0,
            consecutiveFailures: this.consecutiveFailures,
            nextAttemptInMs: Math.max(0, this.nextAttemptAt - Date.now()),
        };
    }
}

export const platformHealth = new PlatformHealth();
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors referencing this file.

- [ ] **Step 3: Manually verify the backoff math**

Run: `node -e "
const BASE=5000, MAX=5*60000;
let n=0;
for (let i=1;i<=8;i++){ n++; const b=Math.min(BASE*2**n, MAX); console.log('failure '+n+': backoff='+(b/1000)+'s'); }
"`

Expected output: backoff grows `10s, 20s, 40s, 80s, 160s, 300s, 300s, 300s` (failure 1 = `5000*2^1=10000ms=10s`, ..., failure 6 = `5000*2^6=320000ms` which is above the 300s cap so clamps to `300s`, and stays at `300s` for all further failures). This confirms the cap is reached after 6 consecutive failures and never exceeded.

- [ ] **Step 4: Commit**

```bash
cd /home/bot/gstdbot
git add src/lib/platform-health.ts
git commit -m "feat: add shared platform-health circuit breaker"
```

---

### Task 2: Wire circuit breaker into SwarmAgent's apiCall()

**Files:**
- Modify: `src/swarm/agent.ts:1276-1301` (the `apiCall` method), and its imports near the top of the file.

**Interfaces:**
- Consumes: `platformHealth` from Task 1 (`shouldAttempt()`, `recordSuccess()`, `recordFailure()`).

- [ ] **Step 1: Add the import**

In `src/swarm/agent.ts`, after the existing `import { logActivity } from '../gateway/server.js';` (line 17), add:

```ts
import { platformHealth } from '../lib/platform-health.js';
```

- [ ] **Step 2: Rewrite `apiCall()`**

Find the current method (lines 1276-1301):

```ts
    private async apiCall(endpoint: string, data: any, method?: string, query?: string): Promise<any> {
        const url = this.config.swarm.apiUrl + endpoint + (query || '');
        const walletAddr = this.wallet.getAddress() || '';
        const isGet = method === 'GET' || endpoint.startsWith('/nodes/public');
        // /nodes/heartbeat and /nodes/register have been observed taking ~18-22s in
        // production (same root cause already fixed in uptime_daemon.ts) -- give them
        // more headroom than the fast, frequently-polled endpoints like /tasks/poll,
        // which should keep failing fast to avoid piling up calls on a 5s interval.
        const timeoutMs = (endpoint === '/nodes/heartbeat' || endpoint === '/nodes/register') ? 25_000 : 10_000;
        try {
            const resp = await fetch(url, {
                method: isGet ? 'GET' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': walletAddr,
                    'X-Node-Id': this.config.nodeId,
                },
                body: isGet ? undefined : JSON.stringify(data),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (resp.ok) return await resp.json().catch(() => ({ ok: true }));
            return null;
        } catch (_e) {
            return null;
        }
    }
```

Replace it with:

```ts
    private async apiCall(endpoint: string, data: any, method?: string, query?: string): Promise<any> {
        if (!platformHealth.shouldAttempt()) return null;
        const url = this.config.swarm.apiUrl + endpoint + (query || '');
        const walletAddr = this.wallet.getAddress() || '';
        const isGet = method === 'GET' || endpoint.startsWith('/nodes/public');
        // /nodes/heartbeat and /nodes/register have been observed taking ~18-22s in
        // production (same root cause already fixed in uptime_daemon.ts) -- give them
        // more headroom than the fast, frequently-polled endpoints like /tasks/poll,
        // which should keep failing fast to avoid piling up calls on a 5s interval.
        const timeoutMs = (endpoint === '/nodes/heartbeat' || endpoint === '/nodes/register') ? 25_000 : 10_000;
        try {
            const resp = await fetch(url, {
                method: isGet ? 'GET' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': walletAddr,
                    'X-Node-Id': this.config.nodeId,
                },
                body: isGet ? undefined : JSON.stringify(data),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (resp.ok) {
                platformHealth.recordSuccess();
                return await resp.json().catch(() => ({ ok: true }));
            }
            platformHealth.recordFailure();
            return null;
        } catch (_e) {
            platformHealth.recordFailure();
            return null;
        }
    }
```

The `shouldAttempt()` guard at the top means all 8 of this file's polling loops (`heartbeat`, `pollTasks`, `pollPriorityInference`, `fetchPeers`, `fetchRewardsInfo`, `joinActiveCampaigns`, `retryPendingSettlements`, `retryPendingTaskReports` — all confirmed via grep to call only `this.apiCall(...)` for their network access) become instant no-ops during backoff, with zero changes needed to any of those 8 methods themselves: they already handle an `apiCall()` result of `null` exactly the same way whether it came from a real failed fetch or a synthetic backoff-skip, since that's already `apiCall()`'s existing failure-signaling contract.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/bot/gstdbot
git add src/swarm/agent.ts
git commit -m "fix: gate SwarmAgent.apiCall() on platform-health circuit breaker"
```

---

### Task 3: Wire circuit breaker into UptimeDaemon's heartbeat

**Files:**
- Modify: `src/naas/uptime_daemon.ts` (imports near line 15, `sendHeartbeat`/`doSendHeartbeat` around lines 88-203).

**Interfaces:**
- Consumes: `platformHealth` from Task 1.

- [ ] **Step 1: Add the import**

In `src/naas/uptime_daemon.ts`, after the existing `import { logActivity } from '../gateway/server.js';` (line 15), add:

```ts
import { platformHealth } from '../lib/platform-health.js';
```

- [ ] **Step 2: Guard `sendHeartbeat()`**

Find the current method:

```ts
    private async sendHeartbeat(): Promise<void> {
        // Guard against overlapping requests: the platform's heartbeat endpoint has been
        // observed taking up to ~18s to respond (a slow full-keyspace KEYS scan server-side),
        // close to the 30s firing interval -- without this guard, a slow response could still
        // be in flight when the next interval tick fires a second concurrent request.
        if (this.heartbeatInFlight) return;
        this.heartbeatInFlight = true;
        try {
            await this.doSendHeartbeat();
        } finally {
            this.heartbeatInFlight = false;
        }
    }
```

Replace it with:

```ts
    private async sendHeartbeat(): Promise<void> {
        // Skip the whole cycle (including hardware benchmarks below) while backing off.
        if (!platformHealth.shouldAttempt()) return;
        // Guard against overlapping requests: the platform's heartbeat endpoint has been
        // observed taking up to ~18s to respond (a slow full-keyspace KEYS scan server-side),
        // close to the 30s firing interval -- without this guard, a slow response could still
        // be in flight when the next interval tick fires a second concurrent request.
        if (this.heartbeatInFlight) return;
        this.heartbeatInFlight = true;
        try {
            await this.doSendHeartbeat();
        } finally {
            this.heartbeatInFlight = false;
        }
    }
```

- [ ] **Step 3: Record success/failure in `doSendHeartbeat()`**

Find the current try/catch (the fetch call and its handling):

```ts
        try {
            const resp = await fetch(`${PLATFORM_URL}/api/v1/nodes/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(heartbeat),
                // Observed live: the platform's heartbeat endpoint took ~18s to respond
                // (a slow full-keyspace KEYS scan server-side, see kv.ts's kvKeys()) --
                // the old 10s timeout meant every single heartbeat from this daemon had been
                // timing out for 3+ days straight (confirmed via live logs: heartbeatCount in
                // the high thousands, error logged every 10th attempt, i.e. every one failed).
                signal: AbortSignal.timeout(25000),
            });

            if (resp.ok) {
                const data = await resp.json() as any;
                // Server may return updated multiplier and commands
                if (data.age_multiplier !== undefined) {
                    this.currentMultiplier = data.age_multiplier;
                }
                if (data.commands && Array.isArray(data.commands)) {
                    for (const cmd of data.commands) {
                        this.executeNaaSCommand(cmd);
                    }
                }
                // Pull queued models (node operator requested via UI)
                if (data.pull_queue && Array.isArray(data.pull_queue) && data.pull_queue.length > 0) {
                    this.processPullQueue(data.pull_queue);
                }
            }
        } catch (err) {
            if (this.heartbeatCount % 10 === 0) {
                console.warn(`[NaaS] Heartbeat error (attempt ${this.heartbeatCount}):`, err instanceof Error ? err.message : err);
            }
        }
```

Replace it with:

```ts
        try {
            const resp = await fetch(`${PLATFORM_URL}/api/v1/nodes/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(heartbeat),
                // Observed live: the platform's heartbeat endpoint took ~18s to respond
                // (a slow full-keyspace KEYS scan server-side, see kv.ts's kvKeys()) --
                // the old 10s timeout meant every single heartbeat from this daemon had been
                // timing out for 3+ days straight (confirmed via live logs: heartbeatCount in
                // the high thousands, error logged every 10th attempt, i.e. every one failed).
                signal: AbortSignal.timeout(25000),
            });

            if (resp.ok) {
                platformHealth.recordSuccess();
                const data = await resp.json() as any;
                // Server may return updated multiplier and commands
                if (data.age_multiplier !== undefined) {
                    this.currentMultiplier = data.age_multiplier;
                }
                if (data.commands && Array.isArray(data.commands)) {
                    for (const cmd of data.commands) {
                        this.executeNaaSCommand(cmd);
                    }
                }
                // Pull queued models (node operator requested via UI)
                if (data.pull_queue && Array.isArray(data.pull_queue) && data.pull_queue.length > 0) {
                    this.processPullQueue(data.pull_queue);
                }
            } else {
                platformHealth.recordFailure();
            }
        } catch (err) {
            platformHealth.recordFailure();
            if (this.heartbeatCount % 10 === 0) {
                console.warn(`[NaaS] Heartbeat error (attempt ${this.heartbeatCount}):`, err instanceof Error ? err.message : err);
            }
        }
```

This closes a real gap: previously, a non-2xx response (like the current live `402 DEPLOYMENT_DISABLED`) fell through the `if (resp.ok)` block silently — no log, no backoff, nothing — meaning this specific failure mode was invisible even though it's exactly what's happening right now in production.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/bot/gstdbot
git add src/naas/uptime_daemon.ts
git commit -m "fix: gate UptimeDaemon heartbeat on platform-health circuit breaker, handle non-ok responses"
```

---

### Task 4: P2P mesh retry-with-backoff instead of permanent give-up

**Files:**
- Modify: `src/index.ts:388-409`

**Interfaces:** None — self-contained within `index.ts`.

- [ ] **Step 1: Add the retry helper function**

Find this section (currently lines 389-409):

```ts
    // ── 17. libp2p P2P Mesh Network ──────────────────────────────
    let p2pNode: GstdP2PNode | null = null;
    let p2pPeerId = '';
    if (!isPlatform) {
        console.log(`  [17/${TOTAL_STEPS}] Starting P2P mesh network...`);
        p2pNode = new GstdP2PNode({
            nodeId: config.nodeId,
            walletAddress: wallet.getAddress() || '',
            listenPort: parseInt(process.env.GSTD_P2P_PORT || '4001'),
            enableMdns: process.env.GSTD_P2P_MDNS !== 'false',
            version: config.version,
        });
        try {
            p2pPeerId = await p2pNode.start();
            // Wire P2P into SwarmAgent: P2P tasks routed through processTask(),
            // P2P heartbeats used to dial new WAN peers for mesh formation
            if (swarm) swarm.setP2PNode(p2pNode);
        } catch (e: any) {
            console.log(`    ⚠ P2P mesh: ${e.message} (platform-only mode)`);
        }
    }
```

Replace it with:

```ts
    // ── 17. libp2p P2P Mesh Network ──────────────────────────────
    let p2pNode: GstdP2PNode | null = null;
    let p2pPeerId = '';
    if (!isPlatform) {
        console.log(`  [17/${TOTAL_STEPS}] Starting P2P mesh network...`);
        p2pNode = new GstdP2PNode({
            nodeId: config.nodeId,
            walletAddress: wallet.getAddress() || '',
            listenPort: parseInt(process.env.GSTD_P2P_PORT || '4001'),
            enableMdns: process.env.GSTD_P2P_MDNS !== 'false',
            version: config.version,
        });
        try {
            p2pPeerId = await p2pNode.start();
            // Wire P2P into SwarmAgent: P2P tasks routed through processTask(),
            // P2P heartbeats used to dial new WAN peers for mesh formation
            if (swarm) swarm.setP2PNode(p2pNode);
        } catch (e: any) {
            // Previously this gave up for the entire process lifetime. Instead,
            // keep boot moving (this doesn't block startup) and retry with
            // backoff in the background -- a transient failure like EADDRINUSE
            // should not permanently disable the mesh.
            console.log(`    ⚠ P2P mesh: ${e.message} — retrying in background`);
            retryMeshInBackground(p2pNode, swarm);
        }
    }
```

Then add the `retryMeshInBackground` function. `SwarmAgent` is already imported in this file (`src/index.ts:37`: `import { SwarmAgent } from './swarm/agent.js';`), and the code above lives inside `async function main(): Promise<void>` (`src/index.ts:164`). Insert this function immediately above that `async function main()` declaration (i.e., directly before line 164):

```ts
const MESH_RETRY_BASE_MS = 5_000;
const MESH_RETRY_MAX_MS = 5 * 60_000;

/**
 * Retries a failed P2P mesh start in the background with exponential backoff
 * (capped at 5 minutes), without blocking node boot. Runs until it succeeds
 * or the process exits -- there is no permanent give-up.
 */
function retryMeshInBackground(node: GstdP2PNode, swarm: SwarmAgent | null): void {
    let attempt = 0;
    const tryStart = async () => {
        attempt++;
        try {
            const peerId = await node.start();
            if (swarm) swarm.setP2PNode(node);
            console.log(`    ✓ P2P mesh started after ${attempt} retr${attempt === 1 ? 'y' : 'ies'} (peer ${peerId.slice(0, 16)}...)`);
        } catch (e: any) {
            const backoff = Math.min(MESH_RETRY_BASE_MS * 2 ** attempt, MESH_RETRY_MAX_MS);
            console.log(`    ⚠ P2P mesh retry ${attempt} failed: ${e.message} — next attempt in ${Math.round(backoff / 1000)}s`);
            setTimeout(tryStart, backoff);
        }
    };
    setTimeout(tryStart, Math.min(MESH_RETRY_BASE_MS * 2, MESH_RETRY_MAX_MS));
}
```

This intentionally does NOT change timing for the success path (the first `p2pNode.start()` call is still awaited synchronously exactly as before, at the same point in boot) — only the failure path changes, from "give up forever" to "keep retrying in the background."

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/bot/gstdbot
git add src/index.ts
git commit -m "fix: retry P2P mesh start with backoff instead of giving up permanently on first failure"
```

---

### Task 5: Expose platform connectivity in the dashboard

**Files:**
- Modify: `src/gateway/server.ts` (imports near line 23, `/api/node/status` handler around lines 1447-1510)
- Modify: `web/dashboard.html` (HTML near line 746, JS in `loadSettings()` near lines 1476-1483)

**Interfaces:**
- Consumes: `platformHealth.getStatus()` from Task 1, returning `{ connected: boolean; consecutiveFailures: number; nextAttemptInMs: number }`.
- Produces: `/api/node/status` response gains a `platform_health` key with that exact shape, consumed by `web/dashboard.html`. (Named `platform_health`, not `platform` — the response already has an unrelated top-level `platform` string field, the OS platform e.g. "linux", read by the dashboard's existing `s-plat` badge; reusing that key would silently break it.)

- [ ] **Step 1: Import and add the field in `server.ts`**

After the existing `import { PlatformLink } from '../core/platform-link.js';` (line 23), add:

```ts
import { platformHealth } from '../lib/platform-health.js';
```

Find this part of the `/api/node/status` handler:

```ts
                gateway: { port: this.config.port, api_port: this.config.apiPort },
                p2p: {
```

Replace it with:

```ts
                platform_health: platformHealth.getStatus(),
                gateway: { port: this.config.port, api_port: this.config.apiPort },
                p2p: {
```

- [ ] **Step 2: Add the HTML badge**

In `web/dashboard.html`, find (lines 745-746):

```html
        <div class="row jb mb8"><span class="muted sm">Platform</span><span class="sm" id="s-plat">—</span></div>
        <div class="row jb"><span class="muted sm">Architecture</span><span class="sm" id="s-arch">—</span></div>
```

Replace it with:

```html
        <div class="row jb mb8"><span class="muted sm">Platform</span><span class="sm" id="s-plat">—</span></div>
        <div class="row jb mb8"><span class="muted sm">Architecture</span><span class="sm" id="s-arch">—</span></div>
        <div class="row jb"><span class="muted sm">Central Server</span><span class="badge badge-muted" id="s-central-badge">Loading...</span></div>
```

(Note: the existing "Platform" row above shows the OS platform, e.g. "linux" — this new "Central Server" row is deliberately labeled differently to avoid confusion with that unrelated field.)

- [ ] **Step 3: Render the badge in `loadSettings()`**

Find (lines 1476-1483):

```js
    if(st.status==='fulfilled'){
      const d=st.value;
      set('s-nid',trunc(d.nodeId||'',16,8));
      set('s-ver',d.version||'—');
      set('s-plat',d.platform||'—');
      set('s-arch',d.arch||'—');
      set('s-curver','v'+(d.version||'—'));
    }
```

Replace it with:

```js
    if(st.status==='fulfilled'){
      const d=st.value;
      set('s-nid',trunc(d.nodeId||'',16,8));
      set('s-ver',d.version||'—');
      set('s-plat',d.platform||'—');
      set('s-arch',d.arch||'—');
      set('s-curver','v'+(d.version||'—'));
      const cb=document.getElementById('s-central-badge');
      if(d.platform_health&&cb){
        if(d.platform_health.connected){cb.className='badge badge-green';cb.textContent='Connected';}
        else{cb.className='badge badge-yellow';cb.textContent='Unreachable — retrying in '+Math.round(d.platform_health.nextAttemptInMs/1000)+'s';}
      }
    }
```

Note: this JS reads `d.platform_health`, not `d.platform` — `d.platform` is already used by this exact same block (`set('s-plat',d.platform||'—')`) for the pre-existing OS-platform string field, which must not change. `d.platform_health` is the new key added in Step 1.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 5: Manual HTML/JS sanity check**

Run: `node -e "require('fs').readFileSync('web/dashboard.html','utf8')" ` (confirms the file is still readable/well-formed after edits — this repo has no HTML linter). Then visually confirm via `grep -n "s-central-badge" web/dashboard.html` that both the HTML element and its two JS references (the `getElementById` and nothing else) are present and spelled identically.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add src/gateway/server.ts web/dashboard.html
git commit -m "feat: show platform connectivity status in dashboard settings"
```

---

### Task 6: Final verification

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Full clean build**

```bash
cd /home/bot/gstdbot
npx tsc --skipLibCheck
```
Expected: zero errors.

- [ ] **Step 2: Live check against the real outage**

`app.gstdtoken.com` is currently actually down (`402 DEPLOYMENT_DISABLED` on every request — a real, live Vercel account-level block, unrelated to this fix). Use this as the live disconnected-state test case rather than simulating one:

```bash
node_modules/.bin/tsc --skipLibCheck
pm2 restart gstdbot
sleep 30
curl -s http://localhost:8081/api/node/status | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('platform_health'), indent=2))"
```
Expected: `connected: false`, `consecutiveFailures` > 0, `nextAttemptInMs` > 0.

- [ ] **Step 3: Confirm log volume dropped**

```bash
pm2 logs gstdbot --lines 0 &
LOGPID=$!
sleep 90
kill $LOGPID
```
Expected: at most 1-2 `[NaaS] Heartbeat error` lines in the 90-second window (previously, at the old fixed 30s interval, this window would show 3 attempts unconditionally; the circuit breaker should now be skipping most of them once backoff exceeds 30s, which happens after the very first failure per Task 1 Step 3's math).

- [ ] **Step 4: Confirm recovery path**

This step can only be fully verified once Vercel's block is lifted (separate, ongoing issue not fixed by this plan) — until then, verify the recovery LOGIC directly instead of end-to-end:

```bash
node --input-type=module -e "
import { platformHealth } from './dist/lib/platform-health.js';
platformHealth.recordFailure();
platformHealth.recordFailure();
console.log('after 2 failures:', platformHealth.getStatus());
platformHealth.recordSuccess();
console.log('after recordSuccess:', platformHealth.getStatus());
console.log('shouldAttempt immediately after success:', platformHealth.shouldAttempt());
"
```
Expected: after `recordSuccess()`, `connected: true`, `consecutiveFailures: 0`, `nextAttemptInMs: 0`, and `shouldAttempt()` returns `true` — confirming there's no lingering slowness once a call succeeds. (Requires Task 1-3 already built via `npx tsc --skipLibCheck` so `dist/lib/platform-health.js` exists.)

- [ ] **Step 5: Confirm dashboard renders the new status**

```bash
curl -s http://localhost:8081/api/node/status | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'platform_health' in d, 'platform_health key missing'; print('OK:', d['platform_health'])"
```
Expected: prints `OK: {...}` with no assertion error.

- [ ] **Step 6: Report completion**

No further action if all checks pass. This closes out the "resilience-fix" sub-project. The remaining decentralization tracks (discovery, inference routing, task/reward attestation, ledger consensus) are separate future sub-projects per the original decomposition and are not started by this plan. The live Vercel "fair use" block on `app.gstdtoken.com` remains a separate, ongoing issue this plan does not fix — it requires action on Vercel's side.
