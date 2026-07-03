# GSTD Distributed Fine-Tuning Network — Design Spec
**Date:** 2026-07-04  
**Status:** Approved  
**Goal:** Make GSTD nodes profitable to run and create a network that trains models cheaper than cloud providers, with GSTD token as the economic key.

---

## 1. Problem

Cloud fine-tuning (OpenAI, Google, AWS) costs $8–30 per 1M training tokens and requires sending private data to corporate servers. Users have no sovereignty over their models or data.

## 2. Solution

Distributed fine-tuning marketplace on top of the existing GSTD A2A network:
- Users submit training jobs (JSONL dataset + base model) and pay in GSTD
- GSTD nodes pick up training shards, train with QLoRA, submit gradient updates
- Aggregator merges quality-weighted gradients → returns LoRA adapter to user
- Node operators earn GSTD proportional to gradient quality

**Target cost:** ~10-30x cheaper than cloud providers.

---

## 3. Architecture

```
User → TrainingJobManager (gstdbot) → ThermalRouter → A2A Nodes
                                                           ↓
                                              FineTuneWorker + MetacognitiveEvaluator
                                                           ↓
                                              GradientAggregator (gstdbot)
                                                           ↓
                                              User receives LoRA weights
```

---

## 4. Components

### 4.1 ThermalRouter (gstdbot: src/training/thermal-router.ts)
Routes training shards to nodes using entropy minimization:
- `computeEntropy(node, domain)` → `latencyVariance × (1 - successRate) × (1 - specializationScore)`
- Lowest-entropy node gets the shard first
- Fallback list maintained for fault tolerance

### 4.2 GradientAggregator (gstdbot: src/training/aggregator.ts)
Weighted FedAvg with outlier protection:
- Reject submissions where gradient norm > 3× median
- Weight = `metacognitive_score × dataset_size`
- Save checkpoint after each aggregation round
- Update node specialization scores after each round

### 4.3 SpecializationTracker (gstdbot: src/training/specialization.ts)
Tracks per-node domain expertise using exponential moving average:
- `domainScore[domain] = 0.9 × prev + 0.1 × improvement`
- Feeds into ThermalRouter for smarter routing
- Powers the node tier/leaderboard system

### 4.4 MetacognitiveEvaluator (A2A: src/gstd_a2a/metacognition.py)
Self-evaluation before submitting gradients:
- Check gradient norm (exploding/vanishing)
- Validate loss improvement on held-out 5% of shard
- Check perplexity within acceptable bounds
- Returns quality score 0.0–1.0; below 0.3 = don't submit

### 4.5 FineTuneWorker (A2A: src/gstd_a2a/finetune_worker.py)
Actual training on node hardware:
- QLoRA 4-bit quantization (runs on 6GB VRAM)
- LoRA rank=16, alpha=32, gradient checkpointing
- Supported: llama3.1:8b, qwen2.5:7b, mistral:7b
- Input: JSONL Alpaca format (instruction/input/output)

### 4.6 TrainingNode (A2A: src/gstd_a2a/training_node.py)
Extended Agent with training capabilities:
- Registers with `capabilities: ["finetune", "federated"]`
- Polls for `finetune` task type
- Orchestrates worker + evaluator + reward claim

---

## 5. Token Economics

- User pays in GSTD: `base_rate × epochs × dataset_size`
- Distribution: 80% to nodes, 15% burned (deflation), 5% treasury
- Node reward = `base_reward × metacognitive_score × specialization_bonus`
- Tiers: Seedling (any node), Validator (stake 1000 GSTD, +20%), Sovereign (stake 5000 GSTD, +50%)
- Referral: 5% of recruit's lifetime earnings

---

## 6. Security

| Threat | Defense |
|--------|---------|
| Gradient poisoning | Outlier filter: reject norm > 3× median |
| Fake quality scores | Aggregator recomputes validation loss independently |
| Dataset theft | Shards use time-limited signed URLs (2h TTL) |
| Sybil attack | Validator tier requires 1000 GSTD stake |
| Node dropout | SwarmOrchestrator re-routes unfinished shards |

---

## 7. API Endpoints (gstdbot gateway)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/training/submit | Submit training job |
| GET | /api/training/jobs | List user's jobs |
| GET | /api/training/jobs/:id | Job status + loss curve |
| POST | /api/training/gradient | Node submits gradient update |
| GET | /api/training/nodes | Training node leaderboard |
| GET | /api/training/models | Available base models |

---

## 8. V1 Scope (what we build now)

- Base models: llama3.1:8b, qwen2.5:7b, mistral:7b (via Ollama)
- Training type: LoRA fine-tuning only
- Minimum 2 nodes per job
- Dataset format: JSONL Alpaca (min 500 examples)
- Output: LoRA adapter .safetensors + loss curve JSON
- Node payment: immediate on gradient acceptance

---

## 9. Files Changed

**gstdbot:**
- `src/training/federated.ts` — enhance SwarmTrainer with real logic
- `src/training/thermal-router.ts` — new: entropy-based routing
- `src/training/aggregator.ts` — new: weighted gradient aggregation
- `src/training/specialization.ts` — new: domain expertise tracking

**A2A:**
- `src/gstd_a2a/metacognition.py` — new: gradient quality evaluator
- `src/gstd_a2a/finetune_worker.py` — new: QLoRA training worker
- `src/gstd_a2a/training_node.py` — new: training-capable agent
- `src/gstd_a2a/protocols.py` — add FineTuneTask schema
- `src/gstd_a2a/__init__.py` — export new modules
