import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, isRegistered, getEntry } from './model-registry.js';

const GSTD_MODELS = [
    'llama3.2:3b', 'llama3.1:8b', 'qwen2.5:7b',
    'mistral:7b', 'phi3:medium', 'llama3.1:70b', 'qwen2.5:32b',
];

describe('MODEL_REGISTRY', () => {
    it('covers all GSTD_MODELS entries', () => {
        for (const m of GSTD_MODELS) {
            expect(MODEL_REGISTRY[m], `missing entry for ${m}`).toBeDefined();
        }
    });

    it('is frozen (immutable)', () => {
        expect(Object.isFrozen(MODEL_REGISTRY)).toBe(true);
    });

    it('every entry has required fields with correct types', () => {
        for (const [id, entry] of Object.entries(MODEL_REGISTRY)) {
            expect(typeof entry.license, id).toBe('string');
            expect(typeof entry.commercial, id).toBe('boolean');
            expect(Array.isArray(entry.tags), id).toBe(true);
            expect(entry.license.length, id).toBeGreaterThan(0);
        }
    });
});

describe('isRegistered', () => {
    it('returns true for known model IDs', () => {
        expect(isRegistered('llama3.2:3b')).toBe(true);
        expect(isRegistered('mistral:7b')).toBe(true);
    });

    it('returns false for unknown model IDs', () => {
        expect(isRegistered('some-random-model:latest')).toBe(false);
        expect(isRegistered('')).toBe(false);
    });
});

describe('getEntry', () => {
    it('returns the correct ModelEntry for a known ID', () => {
        const entry = getEntry('mistral:7b');
        expect(entry).toBeDefined();
        expect(entry!.license).toBe('Apache-2.0');
        expect(entry!.commercial).toBe(true);
        expect(entry!.tags).toContain('chat');
    });

    it('returns undefined for an unknown ID', () => {
        expect(getEntry('unknown:model')).toBeUndefined();
    });
});
