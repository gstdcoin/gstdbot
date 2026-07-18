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
import re
import shutil
import hashlib
import tarfile
import tempfile
import subprocess
import urllib.request
import urllib.parse
from pathlib import Path

IPFS_API = os.environ.get("GSTD_IPFS_API", "http://127.0.0.1:5001")

# Last line of defense against SSRF: the platform's job-submission API
# (frontend/src/pages/api/v1/training/jobs.ts) blocks these same host classes
# before a job is queued, but tasks can also reach this node via the
# unauthenticated generic task-submission endpoint, which doesn't run that
# validation -- so we replicate the check here too.
BLOCKED_HOSTS = re.compile(r'^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|fd|fc)', re.IGNORECASE)

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
    hostname = urllib.parse.urlparse(url).hostname or ""
    if BLOCKED_HOSTS.match(hostname):
        raise ValueError(f"shard_url host not allowed: {hostname}")
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
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
