# Bring your hardware to GSTD

GSTD welcomes operators who already run local AI. The [Hugging Face hardware community](https://huggingface.co/hardware) is a directory of equipment owned by HF users, not a list of GSTD participants or a partnership. Participation is voluntary; no HF token is needed for public, ungated model downloads.

## Support and evidence

| Equipment | Installation path | Evidence and limits |
| --- | --- | --- |
| Linux ARM64 CPU | Source installer | Physically exercised on the current Debian ARM64 node. Model size and latency remain hardware dependent. |
| Linux x86-64 CPU | Source installer | Fresh-install CI; not a physical production deployment in this validation. |
| NVIDIA discrete GPU | Linux with compatible Ollama drivers | Read-only vendor detection and fixture tests. Actual GPU execution requires a compatible driver, runtime and a successful local model test. |
| AMD discrete GPU / Ryzen AI | Supported Ollama ROCm/Vulkan environment | Detection fixtures only; support depends on the exact device and runtime. Shared memory is not counted twice. |
| Apple Silicon | macOS source installer and Ollama | Portable configuration tests and unified-memory accounting; physical installation and inference are not yet verified here. |
| Windows | WSL2 Linux installation | Native Windows is not the source shell install target; WSL GPU forwarding is environment dependent. |
| Several Linux machines | Install one independent node per machine | Each machine has its own identity and resource budget. No pooled RAM/VRAM or single model sharding across hosts. |

No promise of universal hardware support. Consult the current [official Ollama hardware matrix](https://docs.ollama.com/gpu) for driver and device requirements. Existing Ollama installations are preserved. If Ollama is absent, its official installer may configure GPU dependencies with administrator access; the read-only environment check does not change drivers.

## Operator journey

1. Follow the [source installation guide](../README.md). The installer prints the local panel URL and location of the private first-run setup token. Keep that token on your machine.
2. Open the panel, finish protected setup, and bind your public TON reward address. Never enter a seed phrase or private key.
3. Choose a model from the catalogue or [import an exact public GGUF from Hugging Face](HUGGINGFACE.md). Review its license, download size and memory estimate.
4. Install with the panel button, then select Test to run a local request. A memory estimate is not proof that a model loads or uses the GPU.
5. Check panel status, models, load and network connectivity. For public serving use the panel HTTPS configuration with a domain you control. Do not expose Ollama directly.

The protected operator API exposes hardware candidates and runtime allocation evidence separately. Vendor tools are bounded read-only probes; their presence does not verify GPU execution. Ollama `/api/ps` describes loaded model allocations, not free VRAM. An empty runtime remains unverified.

## Network resource matching

The existing local refresh takes a CPU/RAM/disk snapshot; registration, heartbeat and task polling use the same sanitized planning budget. Snapshots expire after 90 seconds. Remote or unavailable runtimes advertise no local work budget, and failed model discovery clears stale model capabilities. Memory and disk reserves leave room for the OS. This is a scheduling estimate, not an exclusive allocation or benchmark.

GPU-specific constrained jobs currently advertise zero available VRAM until usable free capacity can be measured and validated. Normal Ollama inference may still use a supported GPU automatically. Multiple GPU capacities and shared memory are never blindly added together. No extra public platform polling was added.

## Rewards

Only funded, accepted work earns GSTD: **85% executor, 10% protocol, 5% reserve**, with no additional reward-claim fee. Idle hardware, downloads, a registered node or a successful free local test do not earn tokens. Demand, acceptance and operating costs determine profitability; earnings are not guaranteed. Free promotional quota is separate from paid funds.

Real funded deposit/work/withdrawal verification is still pending available funds. Telegram user-session delivery, a second physical node and the physical GPU/macOS paths also need end-to-end confirmation before claiming production readiness for all hardware.
