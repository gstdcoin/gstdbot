# Resilience Fix — Design

**Repo:** gstdbot
**Scope:** First sub-project of the broader "eliminate dependency on app.gstdtoken.com" effort. This sub-project does NOT decentralize anything — it makes the node behave sanely when the central platform is unreachable, which is a prerequisite for every later sub-project (decentralized discovery, inference routing, task/reward attestation, ledger consensus) and directly fixes the pain from the current multi-day Vercel outage. Those later sub-projects are separate, future specs.

## Problem

Nine independent fixed-interval timers in this codebase call `app.gstdtoken.com` and never back off, no matter how long it's been unreachable:

| Location | Interval | Purpose |
|---|---|---|
| `src/swarm/agent.ts:183` | 8 min (+ 60s retry-on-failure loop at agent.ts:397) | Main heartbeat |
| `src/swarm/agent.ts:186` | 30s | Task poll |
| `src/swarm/agent.ts:189` | 5s | Priority inference poll |
| `src/swarm/agent.ts:192` | 60s | Peer fetch |
| `src/swarm/agent.ts:195` | 5 min | Rewards info fetch |
| `src/swarm/agent.ts:198` | 10 min | Join active campaigns |
| `src/swarm/agent.ts:202` | 2 min | Retry pending settlements |
| `src/swarm/agent.ts:207` | 2 min | Retry pending task reports |
| `src/naas/uptime_daemon.ts:91` (`HEARTBEAT_INTERVAL_MS`) | 30s | NaaS proof-of-uptime heartbeat |

During this outage, that's the 5s and 30s loops alone firing thousands of times a day against a server returning `402 DEPLOYMENT_DISABLED` — pure waste, with no operator-visible signal beyond scrolling raw logs (`uptime_daemon.ts` only logs every 10th failure, silently, at `console.warn` — `agent.ts`'s heartbeat logs once then retries silently forever).

Separately, `src/index.ts:392-408` starts the libp2p P2P mesh exactly once per process lifetime. If `p2pNode.start()` throws for any reason (confirmed live: `EADDRINUSE` on port 4001), the catch block just logs `⚠ P2P mesh: ... (platform-only mode)` and `p2pNode` stays `null` forever — no retry, even though `GstdP2PNode.start()` is safe to call again (it constructs a fresh libp2p instance from scratch each call; nothing needs cleanup between attempts).

## Design

### 1. Shared circuit breaker (`src/lib/platform-health.ts`, new file)

A singleton module tracking platform reachability as shared state — not nine independent backoff counters. Rationale: all nine loops fail for the same reason at the same time (the platform is down), so a single shared clock means only one of them needs to actually probe before the rest silently skip their turn, instead of nine loops independently hammering and independently ramping up backoff.

```ts
class PlatformHealth {
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;

  shouldAttempt(): boolean {
    return Date.now() >= this.nextAttemptAt;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.nextAttemptAt = 0;
  }

  recordFailure(baseIntervalMs: number): void {
    this.consecutiveFailures++;
    const backoff = Math.min(baseIntervalMs * 2 ** this.consecutiveFailures, 5 * 60_000);
    this.nextAttemptAt = Date.now() + backoff;
  }

  getStatus() {
    return {
      connected: this.consecutiveFailures === 0,
      consecutiveFailures: this.consecutiveFailures,
      nextAttemptInMs: Math.max(0, this.nextAttemptAt - Date.now()),
    };
  }
}

export const platformHealth = new PlatformHealth();
```

`recordFailure(baseIntervalMs)` takes the CALLING loop's own natural interval as the doubling base, so a 5s loop's backoff grows 5s→10s→20s→...→5min, while an 8min loop's backoff (already above the 5min cap) just stays at 8min — never faster than the loop's own designed cadence, never slower than the 5-minute cap.

### 2. Wire the guard into all nine call sites

Each polling callback gets a one-line guard before its existing fetch logic:

```ts
if (!platformHealth.shouldAttempt()) return;
try {
  // ...existing fetch...
  platformHealth.recordSuccess();
} catch (e) {
  platformHealth.recordFailure(THIS_LOOPS_INTERVAL_MS);
  // ...existing error handling stays...
}
```

No change to the `setInterval`/`setTimeout` periods themselves — they keep firing at their original cadence when connected (so latency-sensitive priority inference polling stays responsive the instant the platform is back), and the guard turns the excess ticks into no-ops during an outage.

### 3. P2P mesh retry (`src/index.ts:392-408`)

Replace the single try/catch with a scheduled retry using the same doubling-capped-at-5-minutes backoff (a second, independent counter — mesh bind failure is unrelated to platform reachability, so it must not share `platformHealth`'s state):

```ts
async function startMeshWithRetry(p2pNode: GstdP2PNode, swarm: SwarmAgent | null): Promise<string> {
  let attempt = 0;
  while (true) {
    try {
      const peerId = await p2pNode.start();
      if (swarm) swarm.setP2PNode(p2pNode);
      return peerId;
    } catch (e: any) {
      attempt++;
      const backoff = Math.min(5_000 * 2 ** attempt, 5 * 60_000);
      console.log(`    ⚠ P2P mesh: ${e.message} — retrying in ${Math.round(backoff / 1000)}s`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}
```

Called via `startMeshWithRetry(p2pNode, swarm).catch(() => {})` fired without `await` at boot (so it doesn't block the other 16 startup steps), continuing to retry in the background until it succeeds or the process exits.

### 4. Dashboard visibility

Extend the existing `GET /api/node/status` handler (`src/gateway/server.ts:1447`) to include `platformHealth.getStatus()` under a `platform` key in its JSON response. Add a status line to `web/dashboard.html`'s existing status section reading that field — "Platform: connected" / "Platform: unreachable, retrying in Ns — running autonomously" — using whatever polling/rendering pattern the dashboard already uses for its other live status fields (read at plan time).

## Testing

No test framework exists in this repo (confirmed: no jest/vitest configured). Verification:
- `npx tsc` (or `tsc --skipLibCheck`) clean build, matching this repo's established verification pattern.
- Manual sanity check of the backoff math (pure function — no framework needed to hand-verify a few `recordFailure` calls produce the expected `nextAttemptAt` growth and 5-minute cap).
- Live check: temporarily point `GSTD_SWARM_URL` at an unreachable address, run the node, confirm log volume for the 5s/30s loops drops to roughly one attempt per backoff-scheduled interval instead of every tick, confirm `/api/node/status` reports `platform.connected: false` with a growing `consecutiveFailures`, then restore the real URL and confirm `connected` flips back to `true` and `consecutiveFailures` resets on the very next tick (no lingering slowness).
- Since `app.gstdtoken.com` is currently actually down, the live check above can be run against the REAL outage as a natural test case, then re-verified once Vercel's block is lifted to confirm the recovery path too.

## Out of scope

- Decentralized discovery, inference routing, task/reward attestation, ledger consensus — separate future sub-projects (B/C/D/E from the parent decomposition).
- Making the node fully functional with zero platform connectivity (e.g., actually routing tasks or serving inference without ever reaching the platform) — this sub-project only stops wasteful hammering and makes the degraded state visible; it doesn't build a replacement for what the platform provides while it's down.
