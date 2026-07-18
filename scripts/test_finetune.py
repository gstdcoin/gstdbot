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
