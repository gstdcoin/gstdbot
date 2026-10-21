/**
 * Pluggable data providers. A provider turns validated task params into a
 * deterministic DataVersion. Tasks name a provider id and params only; they
 * never carry code, URLs or commands, so a provider decides where it fetches.
 */

import { fetchNpmVersion, type AdapterConfig } from './adapters.js';
import type { DataVersion } from './board.js';

export interface DataProvider {
    readonly id: string;
    /** Throws if params are not acceptable for this provider. */
    validate(params: Record<string, unknown>): void;
    fetch(params: Record<string, unknown>, cfg: AdapterConfig, now?: number): Promise<DataVersion>;
}

export const npmRegistryProvider: DataProvider = {
    id: 'npm-registry',
    validate(params) {
        if (typeof params.package !== 'string' || !/^(@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,60}$/.test(params.package)) {
            throw new Error('invalid npm package name');
        }
    },
    fetch: (params, cfg, now) => fetchNpmVersion(String(params.package), cfg, now),
};

export class ProviderRegistry {
    private providers = new Map<string, DataProvider>();

    constructor(initial: DataProvider[] = [npmRegistryProvider]) {
        for (const p of initial) this.register(p);
    }

    register(provider: DataProvider): void {
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(provider.id)) throw new Error(`invalid provider id: ${provider.id}`);
        if (this.providers.has(provider.id)) throw new Error(`provider already registered: ${provider.id}`);
        this.providers.set(provider.id, provider);
    }

    get(id: string): DataProvider | undefined { return this.providers.get(id); }
    ids(): string[] { return [...this.providers.keys()].sort(); }
}
