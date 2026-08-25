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
        const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (this.consecutiveFailures - 1), MAX_BACKOFF_MS);
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
