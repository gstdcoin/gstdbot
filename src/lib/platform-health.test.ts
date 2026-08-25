import { describe, it, expect } from 'vitest';
import { PlatformHealth } from './platform-health.js';

describe('PlatformHealth', () => {
    it('shouldAttempt() returns true before any failure has been recorded', () => {
        const health = new PlatformHealth();
        expect(health.shouldAttempt()).toBe(true);
    });

    it('backs off exponentially on repeated failures, capped at 300s', () => {
        const health = new PlatformHealth();
        const expectedSeconds = [5, 10, 20, 40, 80, 160, 300, 300];

        for (let i = 0; i < expectedSeconds.length; i++) {
            health.recordFailure();
            const { nextAttemptInMs } = health.getStatus();
            expect(Math.round(nextAttemptInMs / 1000)).toBe(expectedSeconds[i]);
        }
    });

    it('recordSuccess() resets failure count and backoff, and shouldAttempt() is true again', () => {
        const health = new PlatformHealth();
        health.recordFailure();
        health.recordFailure();
        health.recordFailure();

        health.recordSuccess();

        const status = health.getStatus();
        expect(status.consecutiveFailures).toBe(0);
        expect(status.nextAttemptInMs).toBe(0);
        expect(health.shouldAttempt()).toBe(true);
    });

    it('getStatus().connected reflects whether there have been consecutive failures', () => {
        const health = new PlatformHealth();
        expect(health.getStatus().connected).toBe(true);

        health.recordFailure();
        expect(health.getStatus().connected).toBe(false);

        health.recordSuccess();
        expect(health.getStatus().connected).toBe(true);
    });
});
