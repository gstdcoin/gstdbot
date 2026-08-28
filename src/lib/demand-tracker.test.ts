import { describe, it, expect, beforeEach } from 'vitest';
import { DemandTracker } from './demand-tracker.js';

describe('DemandTracker', () => {
    let tracker: DemandTracker;

    beforeEach(() => {
        tracker = new DemandTracker();
    });

    describe('record + getDemandRanking', () => {
        it('starts empty', () => {
            expect(tracker.getDemandRanking()).toEqual([]);
        });

        it('records a single model call', () => {
            tracker.record('llama3.2:3b');
            expect(tracker.getDemandRanking()).toEqual([
                { modelId: 'llama3.2:3b', requests: 1 },
            ]);
        });

        it('accumulates multiple calls for the same model', () => {
            tracker.record('mistral:7b');
            tracker.record('mistral:7b');
            tracker.record('mistral:7b');
            expect(tracker.getDemandRanking()[0]).toEqual({ modelId: 'mistral:7b', requests: 3 });
        });

        it('sorts by requests descending', () => {
            tracker.record('llama3.2:3b');
            tracker.record('mistral:7b');
            tracker.record('mistral:7b');
            tracker.record('qwen2.5:7b');
            const ranking = tracker.getDemandRanking();
            expect(ranking[0].modelId).toBe('mistral:7b');
            expect(ranking[0].requests).toBe(2);
            expect(ranking[1].requests).toBe(1);
        });

        it('returns a snapshot (mutations do not affect internal state)', () => {
            tracker.record('llama3.2:3b');
            const ranking = tracker.getDemandRanking();
            ranking[0].requests = 999;
            expect(tracker.getDemandRanking()[0].requests).toBe(1);
        });
    });

    describe('getTopRecommended', () => {
        it('returns empty when no demand recorded', () => {
            expect(tracker.getTopRecommended(['llama3.2:3b'])).toEqual([]);
        });

        it('excludes already-installed models', () => {
            tracker.record('llama3.2:3b');
            tracker.record('mistral:7b');
            const result = tracker.getTopRecommended(['llama3.2:3b']);
            expect(result).not.toContain('llama3.2:3b');
            expect(result).toContain('mistral:7b');
        });

        it('excludes models not in MODEL_REGISTRY', () => {
            tracker.record('custom-unregistered:latest');
            const result = tracker.getTopRecommended([]);
            expect(result).not.toContain('custom-unregistered:latest');
        });

        it('respects the n limit (default 3)', () => {
            tracker.record('llama3.1:8b');
            tracker.record('llama3.1:70b');
            tracker.record('qwen2.5:7b');
            tracker.record('mistral:7b');
            const result = tracker.getTopRecommended([]);
            expect(result.length).toBe(3);
        });

        it('respects a custom n', () => {
            tracker.record('llama3.1:8b');
            tracker.record('llama3.1:70b');
            const result = tracker.getTopRecommended([], 1);
            expect(result.length).toBe(1);
        });
    });
});
