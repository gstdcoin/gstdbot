import { describe, expect, it } from 'vitest';
import { ProviderRegistry, npmRegistryProvider, type DataProvider } from './providers.js';

describe('provider registry', () => {
    it('ships with the npm provider and validates its params', () => {
        const r = new ProviderRegistry();
        expect(r.ids()).toEqual(['npm-registry']);
        expect(() => npmRegistryProvider.validate({ package: 'left-pad' })).not.toThrow();
        expect(() => npmRegistryProvider.validate({ package: '../etc/passwd' })).toThrow();
        expect(() => npmRegistryProvider.validate({})).toThrow();
    });

    it('registers custom providers and refuses duplicates or bad ids', () => {
        const r = new ProviderRegistry();
        const custom: DataProvider = { id: 'custom-feed', validate: () => undefined, fetch: async () => { throw new Error('unused'); } };
        r.register(custom);
        expect(r.get('custom-feed')).toBe(custom);
        expect(r.ids()).toEqual(['custom-feed', 'npm-registry']);
        expect(() => r.register(custom)).toThrow(/already registered/);
        expect(() => r.register({ ...custom, id: 'Bad Id!' })).toThrow(/invalid provider id/);
    });
});
