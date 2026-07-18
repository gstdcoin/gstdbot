# Real Fine-Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace gstdbot's simulated `finetune` task handling (random numbers, fake `lora_path`) with real PEFT/LoRA training via a Python subprocess, upload the result to IPFS, and gate the capability so only nodes that can really train advertise it — verified live against the production job queue.

**Architecture:** `SwarmAgent.processFinetune()` (TypeScript) spawns a standalone Python script (`scripts/finetune.py`) that downloads the shard, picks the right open (Qwen2.5, Apache-2.0) model for the requested `base_model` against this node's actual detected hardware, runs real PEFT LoRA training, uploads the adapter to the node's local IPFS daemon, and prints one JSON result line. TypeScript parses it and returns it from `processFinetune`; the existing shared `/tasks/complete` call (already made by `processTask()` for every task type) forwards `metacognitive_score`/`gradient_norm`/`val_loss_improvement`/`lora_path` into the training job record — no new platform endpoint needed, this wiring already exists and was verified during design (`gstdai/frontend/src/pages/api/v1/tasks/complete.ts:80-107`). A dead, competing implementation (`SwarmTrainer` in `src/training/federated.ts`) is removed.

**Tech Stack:** TypeScript (Node.js, existing `child_process.spawn`), Python 3.13 in a dedicated venv, `torch`/`transformers`/`peft`/`accelerate`/`psutil`, local IPFS HTTP API (`127.0.0.1:5001`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-real-finetuning-design.md` — every requirement in it must map to a task below.
- Only Apache-2.0, ungated Hugging Face models (Qwen2.5 family) — no `meta-llama/*` or `google/gemma-*` (both require accepting a gated license, adds friction, blocks non-interactive setup).
- CPU path uses `torch.float32` (not `float16` — float16 matmul is unsupported/slow on CPU; the pre-existing `finetune_worker.py` code in gstd-a2a had this as a latent bug, don't repeat it here).
- A node must reject (not silently downgrade) a job whose requested `base_model` exceeds its detected hardware — report `insufficient_resources` and let the platform's normal requeue-on-fail path hand it to a stronger node later. Never train a smaller model than requested and report it as if it were the requested one.
- `finetune` capability must only be added to `this.config.models.available` after a real, non-cached-forever, verified check (`python3 ... --check`) succeeds — this is what the task queue's `nodeCanHandle()` (`gstdai/frontend/src/pages/api/v1/tasks/poll.ts:23-38`) gates on.
- Never commit `venv-training/` or downloaded model weights to git.
- GSTD_SWARM_URL / API URLs: never hardcode, follow existing `process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com'` pattern already in this codebase.

---

## File Map

**gstdbot:**
- Create: `requirements-training.txt` — training-only Python deps (opt-in, not installed by default `npm install`)
- Create: `scripts/finetune.py` — the whole real-training implementation
- Create: `scripts/test_finetune.py` — standalone smoke test (no pytest dependency needed; runs as a plain script, asserts, exits non-zero on failure)
- Modify: `src/swarm/agent.ts` — replace `processFinetune()` body (currently `agent.ts:782-852`), add `checkTrainingCapable()` + `runPythonScript()` helpers, add capability gating in `start()`
- Modify: `src/training/federated.ts` — remove `pollTrainingJobs()`, `processTrainingJob()`, `processFinetune()`, `processFederated()`, `processDistillation()`, `processEmbeddingTraining()`, and the `setInterval(() => this.pollTrainingJobs(), 30_000)` call in `init()`
- Modify: `.gitignore` — add `venv-training/`

**gstdai:**
- Modify: `frontend/src/pages/api/v1/training/jobs.ts` — add `qwen2.5:0.5b` to `SUPPORTED_MODELS` and `COST_PER_EPOCH` (the only model size this node can currently actually serve; other Qwen2.5 sizes are supported by `finetune.py`'s code but not yet added to the platform's list since nothing can serve them yet — that's a fast-follow once a stronger node exists, not part of this plan)

---

## Task 1: Python training environment

**Files:**
- Create: `/home/bot/gstdbot/requirements-training.txt`
- Modify: `/home/bot/gstdbot/.gitignore`

**Interfaces:**
- Produces: a working venv at `/home/bot/gstdbot/venv-training/` with `torch`, `transformers`, `peft`, `accelerate`, `psutil` importable — every later task's Python code depends on this venv existing at this exact path.

- [ ] **Step 1: Write requirements-training.txt**

```
torch
transformers
peft
accelerate
psutil
```

- [ ] **Step 2: Add venv to .gitignore**

Add these two lines to `/home/bot/gstdbot/.gitignore` (after the existing `dist/` line):

```
venv-training/
.pip-tmp/
```

- [ ] **Step 3: Create the venv and install**

**Important — verified during design, do not skip either flag:**
- `/tmp` on this Pi is a small `tmpfs` (RAM-backed, ~3.9GB total) — pip's default temp dir. Plain `pip install torch` (no index override) resolves a CUDA-bundled variant that pulls 2GB+ of NVIDIA cublas/cudnn/cusparse/nccl wheels — completely unusable on this ARM64 CPU-only board — and reliably fills `/tmp` mid-install (`OSError: [Errno 28] No space left on device`, reproduced during design). Use `TMPDIR` pointed at the main disk.
- Use PyTorch's official CPU-only package index so `pip` never resolves the CUDA variant in the first place. Verified during design: this installs `torch-2.13.0+cpu` at 155MB (vs. 427MB+ for the CUDA variant, before its 2GB of dependencies).

```bash
cd /home/bot/gstdbot
python3 -m venv venv-training
mkdir -p .pip-tmp
TMPDIR=/home/bot/gstdbot/.pip-tmp ./venv-training/bin/pip install --upgrade pip
TMPDIR=/home/bot/gstdbot/.pip-tmp ./venv-training/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
TMPDIR=/home/bot/gstdbot/.pip-tmp ./venv-training/bin/pip install -r requirements-training.txt
```

(The second command installs CPU-only `torch` first from PyTorch's own index; the third installs the rest from PyPI as normal — `pip` won't re-resolve `torch` from a different index once it's already satisfied.)

Expected: completes without error, no `nvidia_*` or `cuda_*` packages in the install list, `df -h /` still shows several GB free afterward.

- [ ] **Step 4: Verify imports work**

```bash
./venv-training/bin/python3 -c "import torch, transformers, peft, accelerate, psutil; print('OK', torch.__version__, transformers.__version__, peft.__version__)"
```

Expected: prints `OK <versions>` with no ImportError.

- [ ] **Step 5: Commit**

```bash
cd /home/bot/gstdbot
git add requirements-training.txt .gitignore
git commit -m "$(cat <<'EOF'
feat(training): add Python training environment (torch/transformers/peft)

Opt-in venv, not part of the default npm install — nodes that want to
advertise the 'finetune' capability run this setup once.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `scripts/finetune.py` — real training + IPFS upload

**Files:**
- Create: `/home/bot/gstdbot/scripts/finetune.py`
- Create: `/home/bot/gstdbot/scripts/test_finetune.py`

**Interfaces:**
- Consumes: the venv from Task 1 (`venv-training/bin/python3 scripts/finetune.py`).
- Produces (consumed by Task 3's TypeScript code):
  - `python3 scripts/finetune.py --check` → prints one JSON line `{"capable": true}` or `{"capable": false, "reason": "..."}`, exits 0 either way (capable field is what matters, not exit code).
  - `python3 scripts/finetune.py <task.json>` → reads a JSON file shaped `{"job_id": str, "shard_id": str, "base_model": str, "domain": str, "shard_url": str, "steps": int}`, prints one JSON line to stdout on the last line:
    - success: `{"success": true, "job_id": str, "model": str, "dataset_size": int, "steps_run": int, "metacognitive_score": float, "gradient_norm": float, "val_loss_improvement": float, "lora_cid": str, "training_seconds": float}`, exit 0
    - failure: `{"success": false, "job_id": str, "error": str}`, exit 1

- [ ] **Step 1: Write the failing smoke test**

Create `/home/bot/gstdbot/scripts/test_finetune.py`:

```python
#!/usr/bin/env python3
"""
Standalone smoke test for finetune.py — proves training and IPFS upload are
real, not simulated. Run with the training venv:
    venv-training/bin/python3 scripts/test_finetune.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import finetune  # noqa: E402

FIXTURE_EXAMPLES = [
    {"instruction": "What is the capital of France?", "output": "Paris."},
    {"instruction": "What is 2+2?", "output": "4."},
    {"instruction": "Name a primary color.", "output": "Red."},
    {"instruction": "What is the opposite of hot?", "output": "Cold."},
    {"instruction": "Name a planet.", "output": "Mars."},
]


def check(label, condition):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {label}")
    if not condition:
        sys.exit(1)


def main():
    work_dir = Path(tempfile.mkdtemp(prefix="gstd_finetune_test_"))

    print("--- run_training() ---")
    metrics = finetune.run_training(FIXTURE_EXAMPLES, "qwen2.5:0.5b", steps_requested=5, work_dir=work_dir)

    check("baseline_loss is a finite number", metrics["baseline_loss"] == metrics["baseline_loss"] and abs(metrics["baseline_loss"]) < 1e6)
    check("post_loss differs from baseline_loss (weights actually changed)",
          metrics["post_loss"] != metrics["baseline_loss"])
    check("steps_run > 0", metrics["steps_run"] > 0)
    check("gradient_norm > 0 (not the old fake random 0.8-1.2 range check -- just must be a real positive float)",
          metrics["gradient_norm"] > 0)

    lora_dir = Path(metrics["lora_dir"])
    check("adapter_config.json exists", (lora_dir / "adapter_config.json").exists())
    adapter_files = list(lora_dir.glob("adapter_model.*"))
    check("adapter_model weights file exists", len(adapter_files) > 0)
    check("adapter weights file is non-trivial size (>1KB)", adapter_files[0].stat().st_size > 1024)

    print("--- ipfs_add_dir() ---")
    cid = finetune.ipfs_add_dir(lora_dir)
    check("got a CID string back", isinstance(cid, str) and len(cid) > 10)

    print("--- fetch back from local IPFS gateway and verify content matches ---")
    import urllib.request
    import tarfile
    import io
    fetch_url = f"http://127.0.0.1:8090/ipfs/{cid}"
    with urllib.request.urlopen(fetch_url, timeout=15) as resp:
        tar_bytes = resp.read()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        names = tar.getnames()
    check("fetched tarball contains adapter_config.json",
          any(n.endswith("adapter_config.json") for n in names))

    print("--- metacognitive_score() ---")
    score_good = finetune.metacognitive_score(1.0, 2.0, 1.0)  # 50% improvement, healthy norm
    score_exploded = finetune.metacognitive_score(50.0, 2.0, 1.0)  # norm too large
    check("healthy gradient scores > 0.3", score_good > 0.3)
    check("exploded gradient scores 0.0", score_exploded == 0.0)

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it to verify it fails (finetune.py doesn't exist yet)**

```bash
cd /home/bot/gstdbot
./venv-training/bin/python3 scripts/test_finetune.py
```

Expected: `ModuleNotFoundError: No module named 'finetune'`

- [ ] **Step 3: Write scripts/finetune.py**

```python
#!/usr/bin/env python3
"""
gstdbot real fine-tune worker.

Invoked as a subprocess by src/swarm/agent.ts::processFinetune(). Two modes:
  finetune.py --check          -> capability probe, prints {"capable": bool, ...}
  finetune.py <task.json>      -> runs one training shard, prints result JSON

Deliberately standalone (no gstd-a2a import) -- gstdbot is a separate
deployable and shouldn't depend on another repo's package.
"""
import sys
import os
import json
import math
import time
import hashlib
import tarfile
import tempfile
import subprocess
import urllib.request
from pathlib import Path

IPFS_API = os.environ.get("GSTD_IPFS_API", "http://127.0.0.1:5001")

# Ollama-style model id -> real, ungated (Apache-2.0) HF equivalent + hardware floor.
# All Qwen2.5-Instruct on purpose: same license family across every size, so the
# exact same code path works whether a node has 2GB RAM or a real GPU -- a
# stronger node just satisfies a higher row in this table, no branching logic.
MODEL_MAP = {
    "qwen2.5:0.5b": {"hf_id": "Qwen/Qwen2.5-0.5B-Instruct", "min_ram_gb": 2,  "min_gpu_vram_gb": None},
    "qwen2.5:1.5b": {"hf_id": "Qwen/Qwen2.5-1.5B-Instruct", "min_ram_gb": 6,  "min_gpu_vram_gb": None},
    "qwen2.5:3b":   {"hf_id": "Qwen/Qwen2.5-3B-Instruct",   "min_ram_gb": 12, "min_gpu_vram_gb": None},
    "qwen2.5:7b":   {"hf_id": "Qwen/Qwen2.5-7B-Instruct",   "min_ram_gb": 8,  "min_gpu_vram_gb": 8},
    "qwen2.5:14b":  {"hf_id": "Qwen/Qwen2.5-14B-Instruct",  "min_ram_gb": 16, "min_gpu_vram_gb": 16},
    "qwen2.5:32b":  {"hf_id": "Qwen/Qwen2.5-32B-Instruct",  "min_ram_gb": 32, "min_gpu_vram_gb": 24},
}

MAX_SECONDS = float(os.environ.get("GSTD_FINETUNE_MAX_SECONDS", "180"))


def detect_hardware():
    import psutil
    free_gb = psutil.virtual_memory().available / (1024 ** 3)
    try:
        import torch
        has_gpu = torch.cuda.is_available()
        vram_gb = (torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)) if has_gpu else 0.0
    except Exception:
        has_gpu, vram_gb = False, 0.0
    return free_gb, has_gpu, vram_gb


def check_capacity(base_model, free_gb, has_gpu, vram_gb):
    """Returns the HF model id to use, or raises if this node can't honestly serve it."""
    spec = MODEL_MAP.get(base_model)
    if not spec:
        raise ValueError(f"Unsupported model for training: {base_model}. Supported: {list(MODEL_MAP)}")
    if spec["min_gpu_vram_gb"] and not (has_gpu and vram_gb >= spec["min_gpu_vram_gb"]):
        raise RuntimeError(
            f"insufficient_resources: {base_model} needs a GPU with "
            f"{spec['min_gpu_vram_gb']}GB+ VRAM (have gpu={has_gpu}, vram={vram_gb:.1f}GB)"
        )
    if free_gb < spec["min_ram_gb"]:
        raise RuntimeError(
            f"insufficient_resources: {base_model} needs {spec['min_ram_gb']}GB+ free RAM "
            f"(have {free_gb:.1f}GB)"
        )
    return spec["hf_id"]


def download_shard(url: str, job_id: str, work_dir: Path) -> Path:
    if not url.startswith("https://"):
        raise ValueError("shard_url must be https")
    dest = work_dir / f"{job_id}_{hashlib.md5(url.encode()).hexdigest()[:8]}.jsonl"
    urllib.request.urlretrieve(url, str(dest))
    return dest


def load_examples(path: Path) -> list:
    examples = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    examples.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return examples


def format_example(ex: dict) -> str:
    instruction = ex.get("instruction", "")
    inp = ex.get("input", "")
    output = ex.get("output", "")
    if inp:
        return f"### Instruction:\n{instruction}\n\n### Input:\n{inp}\n\n### Response:\n{output}"
    return f"### Instruction:\n{instruction}\n\n### Response:\n{output}"


def metacognitive_score(gradient_norm, val_loss_before, val_loss_after,
                         max_gradient_norm=10.0, max_perplexity=200.0) -> float:
    """Ported from gstd-a2a's MetacognitiveEvaluator.evaluate() -- same formula,
    standalone copy since gstdbot doesn't depend on the gstd-a2a package."""
    if math.isnan(gradient_norm) or math.isinf(gradient_norm):
        return 0.0
    if gradient_norm > max_gradient_norm or gradient_norm < 1e-8:
        return 0.0
    try:
        perplexity = math.exp(val_loss_after)
    except OverflowError:
        perplexity = float("inf")
    if perplexity > max_perplexity:
        return 0.1
    improvement = 0.5 if val_loss_before <= 0 else (val_loss_before - val_loss_after) / val_loss_before
    if improvement < -0.5:
        return 0.0
    if gradient_norm < 0.01:
        norm_score = 0.1
    elif gradient_norm < 0.1:
        norm_score = 0.5
    elif gradient_norm <= 5.0:
        norm_score = 1.0
    elif gradient_norm <= 10.0:
        norm_score = 0.5
    else:
        norm_score = 0.0
    return round(min(1.0, max(0.0, max(0.0, improvement) * 0.7 + norm_score * 0.3)), 4)


def run_training(examples: list, base_model: str, steps_requested: int, work_dir: Path) -> dict:
    """Pure(ish) training core -- no download, no IPFS. Separated out so it can
    be smoke-tested directly with hardcoded examples, no network needed."""
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import get_peft_model, LoraConfig, TaskType

    if len(examples) < 2:
        raise ValueError(f"Too few examples: {len(examples)} (min 2)")

    free_gb, has_gpu, vram_gb = detect_hardware()
    hf_model_id = check_capacity(base_model, free_gb, has_gpu, vram_gb)

    tokenizer = AutoTokenizer.from_pretrained(hf_model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    device = "cuda" if has_gpu else "cpu"
    dtype = torch.float16 if has_gpu else torch.float32  # float16 on CPU is unsupported/slow -- fp32 there
    model = AutoModelForCausalLM.from_pretrained(hf_model_id, torch_dtype=dtype).to(device)

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM, r=8, lora_alpha=16, lora_dropout=0.05,
        target_modules=["q_proj", "v_proj"],
    )
    model = get_peft_model(model, lora_config)

    val_split = max(1, len(examples) // 5)
    val_examples = examples[:val_split]
    train_examples = examples[val_split:] or examples

    def eval_loss(exs):
        model.eval()
        losses = []
        with torch.no_grad():
            for ex in exs[:5]:
                text = format_example(ex)
                inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
                inputs = {k: v.to(device) for k, v in inputs.items()}
                outputs = model(**inputs, labels=inputs["input_ids"])
                losses.append(outputs.loss.item())
        model.train()
        return sum(losses) / max(len(losses), 1)

    baseline_loss = eval_loss(val_examples)

    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4)
    grad_norms = []
    start = time.time()
    step_count = 0
    for i, ex in enumerate(train_examples):
        if i >= steps_requested or (time.time() - start) > MAX_SECONDS:
            break
        text = format_example(ex)
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        outputs = model(**inputs, labels=inputs["input_ids"])
        optimizer.zero_grad()
        outputs.loss.backward()
        total_norm = sum(
            p.grad.data.norm(2).item() ** 2 for p in model.parameters() if p.grad is not None
        ) ** 0.5
        grad_norms.append(total_norm)
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        step_count += 1

    post_loss = eval_loss(val_examples)
    avg_norm = sum(grad_norms) / max(len(grad_norms), 1)
    improvement = (baseline_loss - post_loss) / max(baseline_loss, 1e-8)

    lora_dir = work_dir / "lora_adapter"
    model.save_pretrained(str(lora_dir))
    tokenizer.save_pretrained(str(lora_dir))

    return {
        "model": hf_model_id,
        "dataset_size": len(examples),
        "steps_run": step_count,
        "baseline_loss": round(baseline_loss, 6),
        "post_loss": round(post_loss, 6),
        "gradient_norm": round(avg_norm, 6),
        "val_loss_improvement": round(improvement, 6),
        "training_seconds": round(time.time() - start, 1),
        "lora_dir": str(lora_dir),
    }


def ipfs_add_dir(dir_path: Path) -> str:
    """Tar the adapter directory and add it to the local IPFS daemon as one file.
    (Multi-file IPFS directory adds need multipart wrap-with-directory semantics;
    tar+gzip keeps the upload/retrieve path to one simple curl call each way.)"""
    tar_path = Path(dir_path).parent / f"{Path(dir_path).name}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        tar.add(dir_path, arcname=Path(dir_path).name)
    result = subprocess.run(
        ["curl", "-s", "-m", "60", "-X", "POST", "-F", f"file=@{tar_path}", f"{IPFS_API}/api/v0/add"],
        capture_output=True, text=True, timeout=65,
    )
    line = result.stdout.strip().splitlines()[-1]
    data = json.loads(line)
    return data["Hash"]


def process_task(task: dict, work_dir: Path) -> dict:
    job_id = task.get("job_id", "unknown")
    base_model = task.get("base_model", "qwen2.5:0.5b")
    shard_url = task.get("shard_url", "")
    steps = int(task.get("steps", 100))

    shard_path = download_shard(shard_url, job_id, work_dir)
    examples = load_examples(shard_path)

    metrics = run_training(examples, base_model, steps, work_dir)
    lora_dir = metrics.pop("lora_dir")
    score = metacognitive_score(metrics["gradient_norm"], metrics["baseline_loss"], metrics["post_loss"])
    cid = ipfs_add_dir(Path(lora_dir))

    return {
        "success": True,
        "job_id": job_id,
        "metacognitive_score": score,
        "lora_cid": cid,
        **{k: v for k, v in metrics.items() if k not in ("baseline_loss", "post_loss")},
    }


def check_environment() -> dict:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
        import peft  # noqa: F401
        import psutil  # noqa: F401
    except ImportError as e:
        return {"capable": False, "reason": f"missing dependency: {e}"}
    try:
        req = urllib.request.Request(f"{IPFS_API}/api/v0/version", method="POST")
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        return {"capable": False, "reason": f"ipfs unreachable: {e}"}
    return {"capable": True}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "usage: finetune.py --check | <task.json>"}))
        sys.exit(1)

    if sys.argv[1] == "--check":
        print(json.dumps(check_environment()))
        sys.exit(0)

    with open(sys.argv[1]) as f:
        task = json.load(f)

    work_dir = Path(tempfile.mkdtemp(prefix="gstd_finetune_"))
    try:
        result = process_task(task, work_dir)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"success": False, "job_id": task.get("job_id", "unknown"), "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the smoke test to verify it passes**

```bash
cd /home/bot/gstdbot
./venv-training/bin/python3 scripts/test_finetune.py
```

Expected: every line prints `[PASS] ...`, ends with `ALL CHECKS PASSED`, exit code 0. This step downloads `Qwen/Qwen2.5-0.5B-Instruct` from Hugging Face on first run (~1GB) and actually trains 5 real steps on CPU — expect this to take a few minutes, not seconds.

If `post_loss == baseline_loss` fails: something is wrong with the training loop (optimizer not stepping, or eval_loss not seeing updated weights) — do not proceed until this specific assertion passes, it's the one that proves training is real.

- [ ] **Step 5: Run the `--check` mode manually**

```bash
cd /home/bot/gstdbot
./venv-training/bin/python3 scripts/finetune.py --check
```

Expected: `{"capable": true}`

```bash
python3 scripts/finetune.py --check
```

(using system python3, no venv, which lacks torch) — Expected: `{"capable": false, "reason": "missing dependency: ..."}`. This proves the check genuinely distinguishes a ready environment from an unready one.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add scripts/finetune.py scripts/test_finetune.py
git commit -m "$(cat <<'EOF'
feat(training): real PEFT/LoRA fine-tuning worker + IPFS upload

Standalone Python script, invoked as a subprocess by processFinetune()
(wired in the next commit). Replaces the simulated Ollama-generate-as-
training-proxy approach with genuine gradient-based LoRA training via
transformers+peft, verified end-to-end: baseline/post validation loss
actually differ, a real adapter_model file is saved and is fetchable
back from IPFS after upload.

Only ungated Qwen2.5 (Apache-2.0) models — Llama/Gemma both require
accepting a license on HuggingFace first, which blocks unattended node
setup. Same model family from 0.5B to 32B means the same code scales to
stronger future hardware without a rewrite -- see MODEL_MAP.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire it into `SwarmAgent` + remove the dead competing implementation

**Files:**
- Modify: `/home/bot/gstdbot/src/swarm/agent.ts`
- Modify: `/home/bot/gstdbot/src/training/federated.ts`

**Interfaces:**
- Consumes: `scripts/finetune.py` (Task 2), `venv-training/bin/python3` (Task 1).
- Produces: `processFinetune(task: SwarmTask): Promise<any>` — same name/signature as before, so `processTask()`'s existing switch statement (`agent.ts:626-628`) doesn't need to change at all.

- [ ] **Step 1: Add imports to agent.ts**

In `/home/bot/gstdbot/src/swarm/agent.ts`, change the import block (currently lines 13-22):

```typescript
import { cpus, totalmem, freemem, platform, arch, loadavg, tmpdir } from 'os';
import { createHash } from 'crypto';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logActivity } from '../gateway/server.js';
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
import type { CollectiveMemory } from '../memory/collective.js';
import { CrossChainBridge } from '../blockchain/bridge.js';
import { SovereignSuite } from './sovereign.js';
```

(Added `tmpdir` to the `os` import, `spawn` to `child_process`, `writeFileSync`/`unlinkSync` to `fs`, and a new `join` from `path`.)

- [ ] **Step 2: Add a private field for the cached capability flag**

In the `SwarmAgent` class field list (currently lines 77-90), add one line after `private avgLatencyMs = 0;`:

```typescript
    private trainingCapable = false;
```

- [ ] **Step 3: Add `runPythonScript` and `checkTrainingCapable` helper methods**

Add these two new private methods anywhere in the class body (e.g. right after `getCapabilities()`, near the end of the file before the closing brace):

```typescript
    // ─── Python training subprocess bridge ────────────────────────
    private runPythonScript(args: string[], timeoutMs: number): Promise<string> {
        const pythonBin = join(this.config.installDir, 'venv-training', 'bin', 'python3');
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonBin, args, { cwd: this.config.installDir });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                reject(new Error(`python subprocess timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve(stdout);
                else reject(new Error(`python exited ${code}: ${stderr.slice(0, 500)}`));
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    private async checkTrainingCapable(): Promise<boolean> {
        const scriptPath = join(this.config.installDir, 'scripts', 'finetune.py');
        try {
            const stdout = await this.runPythonScript([scriptPath, '--check'], 10_000);
            const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
            return result.capable === true;
        } catch (_e) {
            return false;
        }
    }
```

- [ ] **Step 4: Gate the `finetune` capability in `start()`**

In `start()` (currently starting at line 146), add this block right after the `swarm.enabled` check and before `// Register with platform`:

```typescript
        // Gate the 'finetune' capability on a real, verified Python training
        // environment -- a node must not advertise it can train unless it
        // actually can. This is what tasks/poll.ts's nodeCanHandle() checks
        // against (it requires 'finetune' literally present in this array).
        this.trainingCapable = await this.checkTrainingCapable();
        if (this.trainingCapable && !this.config.models.available.includes('finetune')) {
            this.config.models.available.push('finetune');
            console.log('    🎓 Fine-tuning capability verified — advertising "finetune"');
        }
```

- [ ] **Step 5: Replace `processFinetune()`'s body**

Replace the entire method currently at `agent.ts:782-852` (from `private async processFinetune(task: SwarmTask): Promise<any> {` through its closing `}`) with:

```typescript
    private async processFinetune(task: SwarmTask): Promise<any> {
        const p = (task as any).payload || {};
        const jobId   = p.job_id   || '';
        const shardId = p.shard_id || ((task as any).task_id || task.id);

        if (!this.trainingCapable) {
            throw new Error('finetune capability not verified on this node');
        }

        const taskFile = join(tmpdir(), `gstd_finetune_task_${shardId}.json`);
        writeFileSync(taskFile, JSON.stringify({
            job_id:     jobId,
            shard_id:   shardId,
            base_model: p.base_model || 'qwen2.5:0.5b',
            domain:     p.domain     || 'general',
            shard_url:  p.shard_url  || '',
            steps:      p.steps      || 100,
        }));

        const scriptPath = join(this.config.installDir, 'scripts', 'finetune.py');
        const budgetSecs = parseInt(process.env.GSTD_FINETUNE_MAX_SECONDS || '180', 10);
        const timeoutMs  = (budgetSecs + 30) * 1000; // training budget + subprocess/model-load overhead

        let stdout: string;
        try {
            stdout = await this.runPythonScript([scriptPath, taskFile], timeoutMs);
        } finally {
            try { unlinkSync(taskFile); } catch (_e) { /* best effort cleanup */ }
        }

        const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
        if (!result.success) {
            throw new Error(result.error || 'finetune subprocess failed');
        }
        if (result.metacognitive_score < 0.3) {
            // Honest reporting: a low-quality shard should not count as done or
            // earn a reward. Throwing routes to /tasks/fail via processTask()'s
            // catch block instead of /tasks/complete.
            throw new Error(`metacognitive_score ${result.metacognitive_score} below 0.3 threshold`);
        }

        logActivity(`Finetune shard ${shardId.slice(0, 10)} complete — model: ${result.model}, score: ${result.metacognitive_score.toFixed(2)}`, 'success');

        return {
            job_id:               jobId,
            shard_id:             shardId,
            base_model:           result.model,
            domain:               p.domain || 'general',
            metacognitive_score:  result.metacognitive_score,
            gradient_norm:        result.gradient_norm,
            val_loss_improvement: result.val_loss_improvement,
            lora_path:            `ipfs://${result.lora_cid}`,
            duration_ms:          Math.round(result.training_seconds * 1000),
            steps_run:            result.steps_run,
        };
    }
```

- [ ] **Step 6: Remove the dead competing implementation in federated.ts**

In `/home/bot/gstdbot/src/training/federated.ts`, confirmed (re-checked at plan-writing time) unreachable/dead once the finetune poll loop is gone — nothing else in the repo calls any of these (only `index.ts` imports from this file, and only the `SwarmTrainer` class + `.init()`/`.stop()`, never these methods directly):

1. Remove the `this.pollTimer = setInterval(() => this.pollTrainingJobs(), 30_000);` line from `init()` (currently line 125). Keep the rest of `init()` (GPU/Ollama detection logging, health monitor, offline queue — those are independent of finetune handling).
2. Delete these seven methods entirely (search for each `private async <name>` / `private <name>` line and delete through its matching closing `}` at the same indentation level — get exact current line numbers by grepping, since earlier investigation's line numbers may have drifted):
   - `pollTrainingJobs()` (~line 244)
   - `processTrainingJob()` (~line 267)
   - `processFinetune()` (~line 312) — job-queue version, not to be confused with `SwarmAgent.processFinetune()` in `agent.ts`, which is the one being kept/fixed
   - `processFederated()` (~line 337)
   - `processDistillation()` (~line 354)
   - `processEmbeddingTraining()` (~line 363)
   - `pullModel()` and `trainEpochOllama()` (~lines 374, 389) — only ever called from the methods just deleted above; verify with `grep -n "pullModel(\|trainEpochOllama("` that no call sites remain outside their own definitions before deleting
3. Remove the now-unused `export const SUPPORTED_MODELS: Record<...> = {...}` (~line 79) — its only reference was inside `processFinetune()`, just deleted. Confirm with `grep -rn "SUPPORTED_MODELS" src/` that nothing outside this file imports it (already checked at plan-writing time: only this file references it).

Do NOT remove `checkOllama()` (~line 468) or `detectGPU()` — both are still called from `init()` independently for startup logging, unrelated to the finetune-specific code being removed.

- [ ] **Step 7: Typecheck and build**

```bash
cd /home/bot/gstdbot
npm run build
```

Expected: no TypeScript errors. If `federated.ts` has leftover unused imports/types after removing the methods (e.g. `TrainingJob` interface no longer referenced anywhere), remove those too — `tsc` will flag unused-but-exported types only if `noUnusedLocals`-style strictness is on; check the build output for actual errors and fix only what it flags (don't guess).

- [ ] **Step 8: Commit**

```bash
cd /home/bot/gstdbot
git add src/swarm/agent.ts src/training/federated.ts
git commit -m "$(cat <<'EOF'
fix(training): wire real finetune.py into processFinetune, remove dead race

processFinetune() now spawns scripts/finetune.py and reports its real
metrics instead of Math.random() gradient norms and a fake lora_path.
Capability-gated: 'finetune' is only added to this node's capabilities
array (what tasks/poll.ts's nodeCanHandle() checks) after a live
--check probe confirms the Python env is actually ready.

Also removed SwarmTrainer's competing poll loop in federated.ts -- it
polled the exact same /tasks/poll endpoint on the same 30s timer and
could race with SwarmAgent for the same queued finetune tasks, using a
different (also fake) protocol that didn't even match what gstdai's
job-tracking expects. Verified its four process* methods had no other
caller anywhere in the repo before deleting them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add the smallest model to the platform's supported list

**Files:**
- Modify: `/home/bot/gstdai/frontend/src/pages/api/v1/training/jobs.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `qwen2.5:0.5b` becomes submittable via `POST /api/v1/training/jobs` — needed for Task 5's live verification.

- [ ] **Step 1: Add the model**

In `/home/bot/gstdai/frontend/src/pages/api/v1/training/jobs.ts`, change:

```typescript
const SUPPORTED_MODELS = [
    'llama3.1:8b', 'llama3.2:3b', 'llama3.2:1b',
    'qwen2.5:7b', 'qwen2.5:3b', 'mistral:7b',
    'phi3:mini', 'gemma2:2b',
];

const COST_PER_EPOCH: Record<string, number> = {
    'llama3.1:8b': 2.0, 'qwen2.5:7b': 2.0, 'mistral:7b': 2.0,
    'llama3.2:3b': 0.8, 'qwen2.5:3b': 0.8, 'phi3:mini': 0.8,
    'llama3.2:1b': 0.4, 'gemma2:2b': 0.4,
};
```

to:

```typescript
const SUPPORTED_MODELS = [
    'llama3.1:8b', 'llama3.2:3b', 'llama3.2:1b',
    'qwen2.5:7b', 'qwen2.5:3b', 'qwen2.5:0.5b', 'mistral:7b',
    'phi3:mini', 'gemma2:2b',
];

const COST_PER_EPOCH: Record<string, number> = {
    'llama3.1:8b': 2.0, 'qwen2.5:7b': 2.0, 'mistral:7b': 2.0,
    'llama3.2:3b': 0.8, 'qwen2.5:3b': 0.8, 'phi3:mini': 0.8,
    'llama3.2:1b': 0.4, 'gemma2:2b': 0.4,
    'qwen2.5:0.5b': 0.2,
};
```

(`qwen2.5:0.5b` is the only size gstdbot's `finetune.py` can currently honestly serve — see `MODEL_MAP` in Task 2. Other Qwen2.5 sizes exist in the script's code but aren't added here yet since no node can serve them; add them once a stronger node exists.)

- [ ] **Step 2: Typecheck**

```bash
cd /home/bot/gstdai/frontend
npx tsc --noEmit -p .
```

Expected: no errors.

- [ ] **Step 3: Commit and push**

```bash
cd /home/bot/gstdai
git add frontend/src/pages/api/v1/training/jobs.ts
git commit -m "$(cat <<'EOF'
feat(training): add qwen2.5:0.5b -- the model size gstdbot can now really train

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 5: Deploy and verify live, end-to-end

**Files:** none (deployment + verification only).

**Interfaces:** none new — this task proves Tasks 1-4 work together against the live, running system.

- [ ] **Step 1: Push gstdbot's commits and rebuild on the Pi**

```bash
cd /home/bot/gstdbot
git push origin main
npm run build
```

- [ ] **Step 2: Restart the node and confirm capability gating works**

```bash
pm2 restart ecosystem.config.js --only gstdbot --update-env
```

Wait for startup (check `pm2 logs gstdbot --lines 30 --nostream`), then confirm the startup log includes the line added in Task 3 Step 4:

```
🎓 Fine-tuning capability verified — advertising "finetune"
```

If it's missing, `checkTrainingCapable()` returned false — run `./venv-training/bin/python3 scripts/finetune.py --check` manually on the Pi to see why before continuing.

- [ ] **Step 3: Prepare a tiny real dataset and host it**

```bash
mkdir -p /tmp/gstd_test_dataset
cat > /tmp/gstd_test_dataset/train.jsonl << 'EOF'
{"instruction": "What is the capital of France?", "output": "Paris."}
{"instruction": "What is 2+2?", "output": "4."}
{"instruction": "Name a primary color.", "output": "Red."}
{"instruction": "What is the opposite of hot?", "output": "Cold."}
{"instruction": "Name a planet.", "output": "Mars."}
{"instruction": "What language is spoken in Japan?", "output": "Japanese."}
{"instruction": "What is the boiling point of water in Celsius?", "output": "100."}
{"instruction": "Name a continent.", "output": "Africa."}
{"instruction": "What is the chemical symbol for gold?", "output": "Au."}
{"instruction": "How many days are in a week?", "output": "Seven."}
{"instruction": "Name an ocean.", "output": "Pacific."}
{"instruction": "What is the freezing point of water in Celsius?", "output": "Zero."}
EOF
```

**Use 12 examples and `steps: 12` (not fewer) — verified during design.** A dry run of this exact training code with only 5 examples / 4 real steps produced `metacognitive_score: 0.285` — just *under* the 0.3 quality gate in `processFinetune()` (Task 3 Step 5), which correctly reported it as a failure (`/tasks/fail`, not `/tasks/complete`) rather than count it as done. That's the honesty gate working as designed, but it means a job this small won't reliably reach `status: done` for the rest of this verification (Steps 7-9 need a completed job). More examples/steps gives the loss more room to actually improve past the threshold. If you still land below 0.3 with 12, that's a legitimate result to report, not a bug to "fix" by lowering the threshold — just increase the dataset/steps further and re-run.

`shard_url` in `jobs.ts` must be `https://` (SSRF-safe URL validation, `validateDatasetUrl()` in `jobs.ts:70-78`). Upload this file somewhere reachable over HTTPS you control (a GitHub Gist raw URL is simplest — create one manually and note the raw URL), or host it via any HTTPS endpoint you already have. Substitute that URL in the next step as `<DATASET_URL>`.

- [ ] **Step 4: Fund a disposable test wallet's balance via the real admin API**

The job costs `0.2 GSTD × epochs` (from Task 4's `COST_PER_EPOCH['qwen2.5:0.5b']`). There's no local access to the production Upstash Redis from this machine (no `.env.local` with real `KV_REST_API_URL`/`TOKEN` checked out here — this repo checkout builds/pushes code, Vercel holds the real credentials). Use the existing, real admin endpoint instead of touching KV directly — it writes to the exact same `balance:<wallet>` key `training/jobs.ts` reads (`gstdai/frontend/src/pages/api/v1/credits/deposit.ts`):

```bash
curl -s -X POST https://app.gstdtoken.com/api/v1/credits/deposit \
  -H "Content-Type: application/json" \
  -H "X-Treasury-Secret: $TREASURY_SECRET" \
  -d '{"wallet": "0xtest_wallet_for_finetune_verification", "amount_gstd": 5, "tx_hash": "finetune-verification-test"}'
```

Expected: `{"ok": true, "wallet": "0xtest_wallet_for_finetune_verification", "amount_gstd": 5, ...}`.

**This requires `TREASURY_SECRET`** (the same secret configured in Vercel for `gstdai`) **exported in your shell.** This is a real production secret — get it from wherever it's stored (Vercel project env vars, or ask whoever set it up) rather than guessing or hardcoding it anywhere. If you don't have it, stop here and get it before continuing — don't work around this by adding a test-only bypass to the real credits/deposit endpoint.

- [ ] **Step 5: Submit the real job**

```bash
curl -s -X POST https://app.gstdtoken.com/api/v1/training/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5:0.5b",
    "dataset_url": "<DATASET_URL>",
    "domain": "general",
    "epochs": 1,
    "steps": 12,
    "wallet": "0xtest_wallet_for_finetune_verification"
  }'
```

Expected: `{"ok": true, "job_id": "...", ...}`. Note the `job_id`.

- [ ] **Step 6: Watch the live node process it**

```bash
pm2 logs gstdbot --lines 0
```

Wait up to 30s (poll interval) + however long training takes (budgeted to `GSTD_FINETUNE_MAX_SECONDS`, default 180s) + model download time on first run. Expect to see:

```
Finetune shard <shard_id> complete — model: Qwen/Qwen2.5-0.5B-Instruct, score: <some number that is NOT 0.80-1.20 random-looking>
```

- [ ] **Step 7: Confirm the job record shows real data, not placeholders**

```bash
curl -s "https://app.gstdtoken.com/api/v1/training/jobs/<job_id>" | python3 -m json.tool
```

Expected: `status: "done"`, `lora_url` starting with `ipfs://`, and `gradients[0]` containing a `metacognitive_score`/`gradient_norm`/`val_loss_improvement` that are NOT the old fake pattern (`gradient_norm` was always `0.8 + random*0.4` before — confirm this run's value doesn't fall suspiciously in exactly that range across repeated jobs, or better, run the job twice and confirm the two gradient_norms differ in a way consistent with real computation, not `Math.random()`).

- [ ] **Step 8: Fetch and verify the actual adapter from IPFS**

```bash
CID=$(curl -s "https://app.gstdtoken.com/api/v1/training/jobs/<job_id>" | python3 -c "import json,sys; print(json.load(sys.stdin)['lora_url'].replace('ipfs://',''))")
curl -s "http://127.0.0.1:8090/ipfs/$CID" -o /tmp/gstd_verify_adapter.tar.gz
tar tzf /tmp/gstd_verify_adapter.tar.gz
```

Expected: lists `lora_adapter/adapter_config.json` and `lora_adapter/adapter_model.safetensors` (or `.bin`), both real files with non-zero size.

- [ ] **Step 9: Sanity-check the weights are actually different from the base model**

```bash
cd /home/bot/gstdbot
tar xzf /tmp/gstd_verify_adapter.tar.gz -C /tmp/
./venv-training/bin/python3 -c "
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

base = AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-0.5B-Instruct', torch_dtype=torch.float32)
tok = AutoTokenizer.from_pretrained('Qwen/Qwen2.5-0.5B-Instruct')
tuned = PeftModel.from_pretrained(base, '/tmp/lora_adapter')

prompt = '### Instruction:\nWhat is the capital of France?\n\n### Response:\n'
inputs = tok(prompt, return_tensors='pt')

base_out = tok.decode(base.generate(**inputs, max_new_tokens=10)[0])
tuned_out = tok.decode(tuned.generate(**inputs, max_new_tokens=10)[0])

print('BASE :', repr(base_out))
print('TUNED:', repr(tuned_out))
print('DIFFERENT:', base_out != tuned_out)
"
```

This doesn't need to show the tuned model is *better* (5 steps on 6 examples won't meaningfully improve anything) — it needs to show `DIFFERENT: True`, proving the adapter genuinely changes the model's behavior rather than being an empty/no-op LoRA.

- [ ] **Step 10: Clean up test artifacts**

```bash
rm -rf /tmp/gstd_test_dataset /tmp/gstd_verify_adapter.tar.gz /tmp/lora_adapter
pm2 logs gstdbot --lines 0  # confirm no errors after cleanup, node still stable
```

- [ ] **Step 11: Update STATUS.md**

In `/home/bot/gstdai/STATUS.md`, in the `gstdcoin/gstdbot` section, add a line under "What's working" (or fix the existing entry if the 07-04 spec's claims are still there):

```markdown
- [x] Real fine-tuning: `finetune` capability gated on verified Python/PEFT
      env; produces genuine LoRA adapters uploaded to IPFS (verified
      2026-07-19 -- see gstdbot/docs/superpowers/plans/2026-07-19-real-finetuning.md)
```

Commit and push per the existing STATUS.md pattern (`git add STATUS.md && git commit -m "docs: real fine-tuning verified live" && git push origin main`).

---

## Self-Review Notes (for whoever executes this)

- **Spec coverage:** §3 architecture → Task 3; §4 model ladder → Task 2's `MODEL_MAP`; §5 capability gating → Task 3 Steps 2-4; §6 file list → matches File Map above; §7 verification plan → Task 5 (all 8 spec verification bullets covered by Task 5 steps 2/6/7/8/9). §8 known limits are documented, not action items.
- **Line numbers in Task 3 Step 6** (federated.ts deletions) are given as "currently" values from investigation at design time — re-grep for exact current ranges before deleting, since earlier edits in this same session may have shifted them slightly.
- Task 5 Step 4 uses the real `/api/v1/credits/deposit` admin endpoint (requires `TREASURY_SECRET`) rather than touching KV directly — there's no local `.env.local` with production Redis credentials checked out on this machine to do it any other way.
- **Task 1 Step 3 was validated for real during plan-writing** (not just read from docs): plain `pip install torch` was tried first, pulled ~2GB of NVIDIA CUDA wheels despite this being an ARM64 CPU-only board, and crashed with `No space left on device` because `/tmp` here is a small tmpfs. Fixed with `--index-url https://download.pytorch.org/whl/cpu` + `TMPDIR` override, both confirmed working (`torch-2.13.0+cpu`, 155MB, no CUDA packages). Task 1's steps already reflect the fix — don't revert to the simpler-looking plain `pip install torch` form.
- **Task 2's `run_training()`/`metacognitive_score()`/`ipfs_add_dir()` were run for real during plan-writing**, not just written and assumed correct: on this Pi, 5 examples / 4 real training steps produced `baseline_loss=3.0246 -> post_loss=2.4410` (genuinely different, ~19% improvement), `gradient_norm=9.61` (a real computed value, nothing like the old code's `0.8 + random()*0.4`), a 2.17MB adapter file, and a working IPFS round-trip (upload -> CID -> fetch back). The resulting `metacognitive_score` was 0.285 -- this is what drove the "use 12 examples, not 5-6" correction in Task 5 Step 3. Task 2's actual code in this plan is what was tested (not a simplified stand-in) — trust it more than you'd trust untested code in a typical plan.
