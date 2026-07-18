# GSTD Real Fine-Tuning — Design Spec
**Date:** 2026-07-19
**Status:** Approved
**Supersedes (partially):** `2026-07-04-distributed-finetuning-design.md`
**Goal:** Make the `finetune` task type actually train a model instead of simulating it, so the "donate compute for open-model fine-tuning" pitch is honest and verifiable — and so the same code scales from today's single CPU-only Pi node to stronger GPU nodes later without a rewrite.

---

## 1. What's actually there today (verified 2026-07-19, not assumed from the 07-04 spec)

The 07-04 spec called for a real QLoRA pipeline. What actually shipped and is live:

- **`gstdai` (platform, `app.gstdtoken.com`)** owns job submission/payment/status: `POST /api/v1/training/jobs`, `POST /api/v1/training/gradient`, `GET /api/v1/training/jobs/:id`. This part is real and already verified working (queue push, KV job record, payment deduction). **Not being changed.**
- **`gstdbot` has two independent, competing pieces of code that both claim `finetune` tasks from the same `/tasks/poll` endpoint on the same 30s timer:**
  1. `SwarmAgent.processFinetune()` (`src/swarm/agent.ts:782`) — the one actually wired to the real protocol (reports to `/api/v1/training/gradient`, matching what `gstdai` expects). Its own comment admits: *"Simulate training via domain-grounding inference pass... this is Ollama-native approximation"* — `gradient_norm = 0.8 + Math.random()*0.4` is literally random, `lora_path: gstd://lora/...` resolves to nothing.
  2. `SwarmTrainer.processFinetune()` (`src/training/federated.ts:308`) — instantiated and started in `index.ts` but its output (`/tasks/complete`) doesn't match what `gstdai`'s job tracking expects at all, and it's equally simulated (Ollama-generate-as-proxy). It has no callers other than its own poll loop.
- **`gstd-a2a` (Python SDK, for third-party node operators, NOT what our live node runs)** has a real, unused-by-us `FineTuneWorker._train_peft()` that does genuine PEFT/QLoRA training with `transformers`+`peft`+`bitsandbytes` — but only if those are installed, and it's gated behind gaited/licensed HF models (`meta-llama/...`, needs an approved HF token). This is closer to "real" but disconnected from what our node runs, and its GPU-oriented model map doesn't help a CPU-only Pi.
- **Nobody uploads the trained artifact anywhere.** `lora_path` is always a string describing a local path or a made-up URI; `gstdai`'s `/api/v1/training/gradient` just stores whatever string it's given as `job.lora_url`. Even a hypothetically-real training run would produce a result the paying user could never retrieve.

## 2. Scope of this spec

1. Remove the race: delete `SwarmTrainer`'s competing finetune poll path; `SwarmAgent.processFinetune` remains the single owner of `finetune` tasks in gstdbot (its protocol already matches what the platform expects).
2. Replace the simulated body of `processFinetune` with a call into a new, real, standalone Python training script, invoked as a subprocess.
3. Use only ungated, Apache-2.0 models (Qwen2.5 family, 0.5B→72B) so the exact same script runs on today's CPU Pi and tomorrow's GPU box — same code, bigger number.
4. Auto-detect hardware (GPU present? how much free RAM/CPU headroom, via the existing `NodeHealth`/resource-stats code) and pick quantization + step budget accordingly — no separate "weak node" / "strong node" code branches.
5. Upload the resulting LoRA adapter to the node's local IPFS daemon (already running, confirmed reachable at `127.0.0.1:5001`); submit the CID as `lora_path`.
6. Gate the `finetune` capability: only advertise it if the Python environment is actually verified working at startup. A node that can't really train should not accept training shards.
7. Verify for real: install the Python deps on this Pi, submit a genuine job through the live `/api/v1/training/jobs` endpoint, let the live node pick it up, and confirm the reported numbers are computed (not random) and the IPFS CID is fetchable and contains real adapter weights.

**Out of scope (explicitly not doing this round):** `ThermalRouter`/`SpecializationTracker`/`GradientAggregator` multi-node routing and FedAvg aggregation from the 07-04 spec — those matter once there's more than one training-capable node; today there's one. Revisit when node count grows. Also out of scope: fixing `gstd-a2a`'s Python `TrainingNode` path — it's for third-party operators, not our live node; can be a fast-follow once this pattern is proven.

## 3. Architecture

```
gstdai /api/v1/training/jobs  (unchanged)
        │  pushes 'finetune' task to tasks:queue
        ▼
gstdbot SwarmAgent.pollTasks() → processFinetune(task)
        │  spawns subprocess, waits, parses stdout JSON
        ▼
scripts/finetune.py  (new, standalone — no gstd-a2a dependency)
        │  1. download shard (reuse existing SSRF-safe download logic pattern)
        │  2. detect hardware: torch.cuda.is_available(), psutil free RAM
        │  3. pick model size + quantization from a size ladder (see §4)
        │  4. real PEFT LoRA: baseline val loss → train → post val loss
        │  5. save adapter → POST to http://127.0.0.1:5001/api/v0/add → CID
        │  6. print one JSON line to stdout, exit 0/1
        ▼
processFinetune() submits to /api/v1/training/gradient with lora_path: `ipfs://<cid>`
```

## 4. Model ladder (hardware → model size, one table, no branches)

All Qwen2.5-Instruct, Apache-2.0, no HF gating:

| Free RAM (no GPU) | GPU present, VRAM | Model | HF ID |
|---|---|---|---|
| < 2GB | — | skip job, report `insufficient_resources` | — |
| 2–6GB | — | 0.5B | `Qwen/Qwen2.5-0.5B-Instruct` |
| 6–12GB | < 8GB | 1.5B | `Qwen/Qwen2.5-1.5B-Instruct` |
| ≥12GB | 8–16GB | 3B–7B (4-bit) | `Qwen/Qwen2.5-3B-Instruct` / `-7B-Instruct` |
| — | ≥16GB | 14B–32B (4-bit) | `Qwen/Qwen2.5-14B-Instruct` / `-32B-Instruct` |

This ladder is a plain lookup table in the script, not an if/else per "weak vs strong node" — a future beefier node just lands in a higher row automatically. GPU path uses `bitsandbytes` 4-bit (already coded in `finetune_worker.py`'s `_train_peft`, being ported); CPU path uses plain `torch_dtype=torch.float32` (float16 matmul on CPU is unsupported/slow in PyTorch — float32 is the correct CPU choice, the existing code's float16 CPU fallback was itself a latent bug).

Step budget: cap wall-clock training to a configurable `GSTD_FINETUNE_MAX_SECONDS` (default 180s) — after detecting hardware, compute how many steps fit in that budget from a quick 1-step timing probe, run that many (bounded by the job's requested `steps`). This is the one place "weak vs. strong" shows up, and it's a number, not a code path.

## 5. Capability gating

At node startup, run a one-time check (cached for the process lifetime): can we `import torch, transformers, peft` and reach the local IPFS API? Only then does `finetune` get added to the capabilities list sent in `/nodes/register` and `/tasks/poll`. This applies network-wide, not just to us — any node without the Python env stops pretending it can train.

## 6. Files changed

**gstdbot:**
- `src/training/federated.ts` — remove `pollTrainingJobs()` entirely. Verified: it only ever dispatches `type === 'finetune'` before calling `processTrainingJob`, which makes `processFederated`/`processDistillation`/`processEmbeddingTraining` in this file unreachable dead code (no other caller anywhere in the repo) — remove those three too. `SwarmTrainer` class itself stays (still instantiated in `index.ts`) but loses its poll loop and the four process* methods; whatever's left (stats fields, constructor) can stay as-is since it's not the focus of this change.
- `src/swarm/agent.ts` — `processFinetune()`: replace the simulated body with a subprocess call to `scripts/finetune.py`; capability list gated per §5.
- `scripts/finetune.py` — new. Standalone, no gstd-a2a import (gstdbot is a separate deployable). Reuses the *shape* of `gstd-a2a/src/gstd_a2a/finetune_worker.py::_train_peft` and `metacognition.py`'s scoring logic, adapted for the Qwen ladder + IPFS upload + CPU float32 fix.
- `requirements-training.txt` (new, gstdbot repo root) — torch, transformers, peft, accelerate. Documented as an opt-in install (`pip install -r requirements-training.txt`), not a default dependency of the Node.js app.

**Not touched:** `gstdai`'s training API routes, `gstd-a2a`'s Python training modules (separate follow-up if desired).

## 7. Verification plan (this is the part that proves it's real, not just "should work")

1. Install `python3 -m venv` + the training requirements on this Pi.
2. Confirm the node's registered capabilities now include `finetune` only after that install (toggle: verify it's *absent* before installing, present after — proves the gating is real, not decorative).
3. Fund a disposable test wallet's KV balance directly (dev-only, this machine) enough to submit one job.
4. `POST /api/v1/training/jobs` with a tiny real JSONL dataset (5–10 instruction/output pairs), `model: qwen2.5:0.5b` (add this alias to `gstdai`'s `SUPPORTED_MODELS`/`COST_PER_EPOCH` — currently missing), `epochs: 1`, `steps: 10`.
5. Watch the live node pick it up via its own logs; confirm `gradient_norm`/`metacognitive_score`/`val_loss_improvement` are plausible *and change run-to-run* (proving they're computed, not constant/random noise pattern).
6. Fetch the reported `ipfs://<cid>` via the local gateway (`http://127.0.0.1:8080/ipfs/<cid>` or public `https://ipfs.io/ipfs/<cid>`) and confirm it contains `adapter_config.json` + `adapter_model.safetensors` of plausible non-zero size.
7. Sanity-check the adapter is non-trivial: load base model + adapter, run one prompt, confirm output differs from base-model-only output (doesn't need to be *better*, just *different* — proves weights actually changed).
8. Job status endpoint (`GET /api/v1/training/jobs/:id`) shows `status: done` and the same CID as `lora_url`.

## 8. Known limits going in (not blockers, just honest)

- One node, one job at a time — no aggregation/FedAvg yet (see out-of-scope).
- 180s default training budget on CPU produces a barely-trained adapter — enough to prove the pipeline is real, not enough to produce a genuinely useful fine-tune. That's a hardware problem, not a software one; it improves automatically as stronger nodes join, per §4's ladder.
- IPFS pinning: the local daemon serves the content but doesn't guarantee long-term availability unless pinned to a persistent/remote pinning service. V1 relies on the local node staying up (same trust assumption as everything else in this single-node network today); revisit if/when multiple nodes exist to co-pin.
