# Model Registry Design

**Date:** 2026-08-27  
**Author:** goldenbit.kz@gmail.com  
**Status:** Approved

---

## Goal

Give GSTD nodes a verifiable, local model registry that (1) records license and commercial-use metadata for every allowlisted model, (2) tracks per-model inference demand in-memory, and (3) filters the `models_loaded` heartbeat field so only registry-verified models are visible to the platform. No centralized service is contacted; verification is entirely local.

---

## Background

The node currently serves any model Ollama has installed, without any record of what it is running, whether its license permits commercial use, or whether callers actually request it. `resolveAvailableModels()` in `src/index.ts` returns raw Ollama tags with no verification, and `platform-link.ts` forwards that list verbatim to the platform heartbeat.

---

## Architecture

Two new modules, four integration points.

### New: `src/lib/model-registry.ts`

A static TypeScript map keyed by Ollama model ID. Exported as a frozen constant; no I/O at any point.

```ts
export interface ModelEntry {
  license: string;      // SPDX or canonical license name
  commercial: boolean;  // true = commercial use permitted by license
  tags: string[];       // e.g. ['chat', 'reasoning', 'multilingual']
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

export function isRegistered(modelId: string): boolean
export function getEntry(modelId: string): ModelEntry | undefined
```

All models in `GSTD_MODELS` and all values of `MODEL_MAP` in `src/gateway/router.ts` are covered. Any model Ollama has installed that is not in this map is "unverified."

### New: `src/lib/demand-tracker.ts`

An in-memory singleton. Counts inference calls per Ollama model ID. Resets on process restart (intentional — demand reflects live usage, not historical).

```ts
export interface DemandEntry {
  modelId: string;
  requests: number;
}

class DemandTracker {
  record(modelId: string): void
  getDemandRanking(): DemandEntry[]                            // sorted by requests desc
  getTopRecommended(installed: string[], n?: number): string[] // uninstalled registry models, ranked by demand, top n
}

export const demandTracker: DemandTracker  // module-level singleton
```

`getTopRecommended(installed, n=3)` returns models that are in `MODEL_REGISTRY` but **not** in `installed`, sorted by recorded demand descending. This gives callers a ranked suggestion of what to pull next.

### Integration: `src/index.ts` — startup log

After `resolveAvailableModels()` (line ~350), iterate `config.models.available` and log two warning classes:

1. **Unverified:** model is installed in Ollama but not in `MODEL_REGISTRY` — logs `WARN [registry] unverified model loaded: <id>`.
2. **Non-commercial:** model is registered but `commercial: false` — logs `WARN [registry] non-commercial model loaded: <id>` (not present in current registry but future-proofed).

No models are blocked at startup. Warnings are informational.

### Integration: `src/gateway/router.ts` — demand recording

In `NeuralRouter.route()` (or wherever the final `ollamaModel` string is resolved after `toOllamaModel()`), call `demandTracker.record(ollamaModel)` once per successful inference call (i.e., after the response resolves, not on cache hits).

Cache hits do not record demand — only actual model invocations count.

### Integration: `src/gateway/server.ts` — status endpoint

Add a `model_registry` field to the `/api/node/status` JSON response:

```json
{
  "model_registry": {
    "verified": ["llama3.2:3b", "mistral:7b"],
    "unverified": [],
    "demand_ranking": [
      { "modelId": "llama3.2:3b", "requests": 47 },
      { "modelId": "mistral:7b",  "requests": 12 }
    ],
    "top_recommended": ["llama3.1:8b"]
  }
}
```

`verified` = installed models that are in `MODEL_REGISTRY`.  
`unverified` = installed models not in `MODEL_REGISTRY`.  
`demand_ranking` = `demandTracker.getDemandRanking()`, trimmed to installed models only.  
`top_recommended` = `demandTracker.getTopRecommended(installed, 3)`.

### Integration: `src/core/platform-link.ts` — heartbeat filter

At line 159, `models_loaded: models` currently forwards the full Ollama list. Change to:

```ts
models_loaded: models.filter(m => isRegistered(m)),
```

`capabilities` at line 158 keeps the full list (so the platform knows what the node *can* serve, even if unverified).

**Enforcement model: soft.** An unverified model continues to be served locally — callers who ask for it by ID still get it. Only the platform-facing heartbeat is filtered. This avoids breaking existing node operators who may have custom models installed.

---

## Non-Goals

- No network calls, no app.gstdtoken.com, no remote registry.
- No model hash verification (out of scope — Ollama's own content-addressable storage handles integrity).
- No automatic model pull or eviction.
- No persistent demand storage — in-memory only.

---

## Files Touched

| File | Change |
|------|--------|
| `src/lib/model-registry.ts` | **new** — registry constant + helpers |
| `src/lib/model-registry.test.ts` | **new** — unit tests |
| `src/lib/demand-tracker.ts` | **new** — in-memory demand tracker + singleton |
| `src/lib/demand-tracker.test.ts` | **new** — unit tests |
| `src/index.ts` | add startup warnings (2-3 lines) |
| `src/gateway/router.ts` | add `demandTracker.record()` call |
| `src/gateway/server.ts` | add `model_registry` to status response |
| `src/core/platform-link.ts` | filter `models_loaded` in heartbeat |

---

## Testing

- `model-registry.test.ts`: `isRegistered` true/false for known/unknown IDs; `getEntry` returns correct shape; `MODEL_REGISTRY` covers all `GSTD_MODELS` entries.
- `demand-tracker.test.ts`: `record()` increments; `getDemandRanking()` sorts descending; `getTopRecommended()` excludes installed models; empty-state behaviour.
- Integration tests in `src/index.test.ts` / `server.test.ts` if they exist; otherwise manual smoke test.
- All 57 existing tests must remain green.
