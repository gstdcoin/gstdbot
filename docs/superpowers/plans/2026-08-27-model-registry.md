# Model Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static local model registry with license metadata and an in-memory demand tracker, wired into startup logging, inference routing, the status API, and the heartbeat filter.

**Architecture:** Two new modules (`model-registry.ts` — frozen static map; `demand-tracker.ts` — in-memory singleton) plus four small integration edits. No network calls; all verification is local. Enforcement is soft: unverified models are still served locally but excluded from the platform heartbeat `models_loaded` field.

**Tech Stack:** TypeScript, Node.js 20, Vitest (existing test runner)

**Spec:** `docs/superpowers/specs/2026-08-27-model-registry-design.md`

## Global Constraints

- No network calls — all verification is purely local
- Do not use app.gstdtoken.com for anything in these files
- Soft enforcement — unverified models MUST still be served locally; only filtered from heartbeat `models_loaded`
- `capabilities` field in heartbeat stays unchanged (full list)
- All 57 existing tests must remain green after every task
- Run `npm test` (which is `vitest run`) — no separate tsc step needed (CI uses `tsc --noEmit`)
- Test files use Vitest: `import { describe, it, expect, beforeEach } from 'vitest'`
- Import paths use `.js` extension in TypeScript source (e.g. `import ... from './model-registry.js'`)

---

### Task 1: Model Registry module

**Files:**
- Create: `src/lib/model-registry.ts`
- Create: `src/lib/model-registry.test.ts`

**Interfaces:**
- Produces:
  - `MODEL_REGISTRY: Readonly<Record<string, ModelEntry>>` — frozen static map
  - `interface ModelEntry { license: string; commercial: boolean; tags: string[] }`
  - `function isRegistered(modelId: string): boolean`
  - `function getEntry(modelId: string): ModelEntry | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/lib/model-registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/bot/gstdbot && npm test -- src/lib/model-registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/model-registry.ts`**

```ts
export interface ModelEntry {
    license: string;
    commercial: boolean;
    tags: string[];
}

export const MODEL_REGISTRY: Readonly<Record<string, ModelEntry>> = Object.freeze({
    'llama3.2:3b':  { license: 'Meta Llama 3.2 Community License', commercial: true,  tags: ['chat'] },
    'llama3.1:8b':  { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'llama3.1:70b': { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'qwen2.5:7b':   { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual'] },
    'qwen2.5:32b':  { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'] },
    'mistral:7b':   { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'phi3:medium':  { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
});

export function isRegistered(modelId: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, modelId);
}

export function getEntry(modelId: string): ModelEntry | undefined {
    return MODEL_REGISTRY[modelId];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/bot/gstdbot && npm test -- src/lib/model-registry.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Verify full suite still green**

```bash
cd /home/bot/gstdbot && npm test
```

Expected: 57+ tests pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add src/lib/model-registry.ts src/lib/model-registry.test.ts
git commit -m "feat: add ModelRegistry — static local allowlist with license metadata"
```

---

### Task 2: Demand Tracker module

**Files:**
- Create: `src/lib/demand-tracker.ts`
- Create: `src/lib/demand-tracker.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent module)
- Produces:
  - `interface DemandEntry { modelId: string; requests: number }`
  - `class DemandTracker { record(modelId: string): void; getDemandRanking(): DemandEntry[]; getTopRecommended(installed: string[], n?: number): string[] }`
  - `demandTracker: DemandTracker` — module-level singleton export

- [ ] **Step 1: Write the failing test**

Create `src/lib/demand-tracker.test.ts`:

```ts
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
            expect(result.length).toBeLessThanOrEqual(3);
        });

        it('respects a custom n', () => {
            tracker.record('llama3.1:8b');
            tracker.record('llama3.1:70b');
            const result = tracker.getTopRecommended([], 1);
            expect(result.length).toBeLessThanOrEqual(1);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/bot/gstdbot && npm test -- src/lib/demand-tracker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/demand-tracker.ts`**

```ts
import { isRegistered } from './model-registry.js';

export interface DemandEntry {
    modelId: string;
    requests: number;
}

export class DemandTracker {
    private counts = new Map<string, number>();

    record(modelId: string): void {
        this.counts.set(modelId, (this.counts.get(modelId) ?? 0) + 1);
    }

    getDemandRanking(): DemandEntry[] {
        return [...this.counts.entries()]
            .map(([modelId, requests]) => ({ modelId, requests }))
            .sort((a, b) => b.requests - a.requests);
    }

    getTopRecommended(installed: string[], n = 3): string[] {
        const installedSet = new Set(installed);
        return this.getDemandRanking()
            .filter(e => !installedSet.has(e.modelId) && isRegistered(e.modelId))
            .slice(0, n)
            .map(e => e.modelId);
    }
}

export const demandTracker = new DemandTracker();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/bot/gstdbot && npm test -- src/lib/demand-tracker.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Verify full suite still green**

```bash
cd /home/bot/gstdbot && npm test
```

Expected: 57+ tests pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add src/lib/demand-tracker.ts src/lib/demand-tracker.test.ts
git commit -m "feat: add DemandTracker — in-memory per-model inference counter"
```

---

### Task 3: Integration wiring (4 touch-points)

Wire the two new modules into the node startup, inference router, status API, and heartbeat filter.

**Files:**
- Modify: `src/index.ts` (add startup warnings after `loadConfig()` at line ~212)
- Modify: `src/gateway/router.ts` (record demand after successful Ollama and peer calls)
- Modify: `src/gateway/server.ts` (add `model_registry` field to `/api/node/status` response at ~line 1646)
- Modify: `src/core/platform-link.ts` (filter `models_loaded` at line 159)

**Interfaces:**
- Consumes from Task 1: `isRegistered`, `getEntry`, `MODEL_REGISTRY` from `../../lib/model-registry.js` (adjust relative path as needed)
- Consumes from Task 2: `demandTracker` from `../../lib/demand-tracker.js` (adjust relative path as needed)

**Exact import paths to use:**
- In `src/index.ts`: `import { isRegistered, getEntry } from './lib/model-registry.js';`
- In `src/gateway/router.ts`: `import { demandTracker } from '../lib/demand-tracker.js';`
- In `src/gateway/server.ts`: `import { isRegistered, MODEL_REGISTRY } from '../lib/model-registry.js';` and `import { demandTracker } from '../lib/demand-tracker.js';`
- In `src/core/platform-link.ts`: `import { isRegistered } from '../lib/model-registry.js';`

- [ ] **Step 1: Wire startup warnings in `src/index.ts`**

After `const config = await loadConfig();` (line ~212 in main()), add:

```ts
import { isRegistered, getEntry } from './lib/model-registry.js';
```

Add to the top-level imports section of the file (near the other imports).

Then immediately after the `const config = await loadConfig();` line in `main()`:

```ts
// Registry audit — informational only, no models are blocked
for (const m of config.models.available) {
    if (!isRegistered(m)) {
        console.warn(`  WARN [registry] unverified model loaded: ${m}`);
    } else {
        const entry = getEntry(m)!;
        if (!entry.commercial) {
            console.warn(`  WARN [registry] non-commercial model loaded: ${m} (${entry.license})`);
        }
    }
}
```

- [ ] **Step 2: Wire demand recording in `src/gateway/router.ts`**

Add import at top of file (with the other imports):

```ts
import { demandTracker } from '../lib/demand-tracker.js';
```

In `routeInternal`, after the L2 Ollama success block stores to cache (line ~191), add one line:

```ts
// L2 success path — record only real inference calls, not cache hits
try {
    const result = await this.callOllamaLocal(ollamaUrl, ollamaModel, messages, 512);
    this.cache.set(cacheKey, result.content, result.model);
    demandTracker.record(ollamaModel);           // ← add this line
    return { ...result, latencyMs: Date.now() - start };
} catch (err: any) {
    // ...
}
```

Also add after the L3 peer success path stores to cache (line ~203):

```ts
this.cache.set(cacheKey, r.content, r.model);
demandTracker.record(ollamaModel);               // ← add this line
```

- [ ] **Step 3: Add `model_registry` to `/api/node/status` in `src/gateway/server.ts`**

Add imports near the top of `server.ts` (with other lib imports):

```ts
import { isRegistered, MODEL_REGISTRY } from '../lib/model-registry.js';
import { demandTracker } from '../lib/demand-tracker.js';
```

In the `/api/node/status` handler (around line 1643–1646), add a new field inside the `res.json({...})` object, after the `relay` field:

```ts
model_registry: (() => {
    const installed = config.models?.available ?? [];
    const verified   = installed.filter((m: string) => isRegistered(m));
    const unverified = installed.filter((m: string) => !isRegistered(m));
    const allRanking = demandTracker.getDemandRanking();
    const installedSet = new Set(installed);
    return {
        verified,
        unverified,
        demand_ranking: allRanking.filter(e => installedSet.has(e.modelId)),
        top_recommended: demandTracker.getTopRecommended(installed, 3),
    };
})(),
```

Note: `config` here refers to the gateway's own config object, not the full NodeConfig. The gateway config has a `models` field only if you pass it in. If `config.models` is not available in the server's scope, use the module-level variable or initialise `installed` as `[]`.

Investigate: run `grep -n 'this\.config\.' /home/bot/gstdbot/src/gateway/server.ts | head -20` to see what fields are on `this.config` in the server context. If `this.config` does not have a `models.available` field, import and call `resolveAvailableModels()` lazily or cache the list via a setter method. The simplest fallback: declare a `private availableModels: string[] = [];` on `OmegaGateway` and add a setter `setAvailableModels(m: string[]): void { this.availableModels = m; }` — then in `src/index.ts`, call `gateway.setAvailableModels(config.models.available)` right after `loadConfig()`.

- [ ] **Step 4: Filter `models_loaded` in heartbeat — `src/core/platform-link.ts`**

Add import at the top of `src/core/platform-link.ts`:

```ts
import { isRegistered } from '../lib/model-registry.js';
```

Locate line 159:

```ts
models_loaded:   models,
```

Change to:

```ts
models_loaded:   models.filter(m => isRegistered(m)),
```

Leave `capabilities: models,` at line 158 unchanged — it keeps the full list.

- [ ] **Step 5: Verify full suite still green**

```bash
cd /home/bot/gstdbot && npm test
```

Expected: all tests pass. The integration changes don't break existing tests because they only add new behaviour (logging, demand recording) or filter a field the existing tests don't assert on.

- [ ] **Step 6: TypeScript check**

```bash
cd /home/bot/gstdbot && node_modules/.bin/tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/bot/gstdbot
git add src/index.ts src/gateway/router.ts src/gateway/server.ts src/core/platform-link.ts
git commit -m "feat: wire ModelRegistry + DemandTracker into startup/router/status/heartbeat"
```
