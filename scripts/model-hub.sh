#!/bin/bash
# ─── GSTD Model Hub — Universal Model Downloader ────────────────────────────
# Downloads models from Ollama registry AND HuggingFace GGUF hub.
# Hardware-aware: checks available RAM before downloading.
#
# Usage:
#   bash scripts/model-hub.sh list                         # show available models
#   bash scripts/model-hub.sh pull <model-id>              # pull specific model
#   bash scripts/model-hub.sh pull-tier [--force]          # pull all models for your RAM tier
#   bash scripts/model-hub.sh hf <hf.co/org/model>        # pull HuggingFace GGUF
#   bash scripts/model-hub.sh remove <model-id>            # remove a model
#
# HuggingFace GGUF syntax: hf.co/bartowski/Phi-3.5-mini-instruct-GGUF
# Ollama handles the download — no separate huggingface-cli needed.

set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"

log()   { echo "[$(date -u +%H:%M:%S)] $*"; }
error() { echo "[ERROR] $*" >&2; }
info()  { echo "  $*"; }

# ─── Check Ollama ─────────────────────────────────────────────────────────────
check_ollama() {
    if ! curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
        error "Ollama is not running. Start it: ollama serve"
        exit 1
    fi
}

# ─── RAM detection ────────────────────────────────────────────────────────────
get_ram_gb() {
    if [ -f /proc/meminfo ]; then
        awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo
    elif command -v sysctl &>/dev/null; then
        sysctl -n hw.memsize 2>/dev/null | awk '{printf "%d", $1/1024/1024/1024}' || echo "8"
    else
        echo "8"
    fi
}

RAM_GB=$(get_ram_gb)

# ─── Model catalog ────────────────────────────────────────────────────────────
declare -A MODEL_DESC
declare -A MODEL_RAM
declare -A MODEL_TIER

add_model() {
    local id="$1" ram="$2" tier="$3" desc="$4"
    MODEL_DESC["$id"]="$desc"
    MODEL_RAM["$id"]="$ram"
    MODEL_TIER["$id"]="$tier"
}

# Tier 1 — 4GB+
add_model "llama3.2:1b"    1  1 "Llama 3.2 1B — ultra-compact edge model"
add_model "llama3.2:3b"    3  1 "Llama 3.2 3B — Pi-optimized, fast"
add_model "phi3:mini"      2  1 "Phi-3 Mini 3.8B — Microsoft, MIT license"
add_model "gemma2:2b"      2  1 "Gemma 2 2B — Google, compact"
add_model "qwen2.5:3b"     3  1 "Qwen 2.5 3B — multilingual compact"

# Tier 2 — 8GB+
add_model "llama3.1:8b"    5  2 "Llama 3.1 8B — balanced general-purpose"
add_model "qwen2.5:7b"     4  2 "Qwen 2.5 7B — strong analytical, 128K ctx"
add_model "mistral:7b"     4  2 "Mistral 7B — creative writing, Apache 2.0"
add_model "mistral-nemo:12b" 7 2 "Mistral NeMo 12B — multilingual, 128K ctx"
add_model "codellama:7b"   4  2 "Code Llama 7B — Meta code model, 20+ langs"
add_model "deepseek-coder:6.7b" 4 2 "DeepSeek Coder 6.7B — code generation"
add_model "nomic-embed-text" 0 2 "Nomic Embed — text embeddings for RAG"

# Tier 3 — 16GB+
add_model "phi3:medium"    8  3 "Phi-3 Medium 14B — Microsoft, MIT, 128K ctx"
add_model "qwen2.5:14b"    9  3 "Qwen 2.5 14B — enterprise tasks"
add_model "deepseek-r1:14b" 9 3 "DeepSeek R1 14B — chain-of-thought reasoning"
add_model "codellama:13b"  8  3 "Code Llama 13B — complex codebases"
add_model "llava:13b"      8  3 "LLaVA 13B — vision + text (multimodal)"
add_model "mixtral:8x7b"  26  3 "Mixtral 8x7B MoE — high quality, efficient"

# Tier 4 — 32GB+
add_model "llama3.1:70b"  40  4 "Llama 3.1 70B — Meta flagship, 128K ctx"
add_model "qwen2.5:32b"   20  4 "Qwen 2.5 32B — deep reasoning, 128K ctx"
add_model "deepseek-r1:70b" 40 4 "DeepSeek R1 70B — OpenAI o1-class reasoner"
add_model "codellama:70b" 40  4 "Code Llama 70B — flagship code model"

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_list() {
    echo ""
    echo "Available models (your RAM: ${RAM_GB}GB)"
    echo "────────────────────────────────────────────────────────"
    printf "  %-35s %6s  %s\n" "MODEL ID" "RAM GB" "DESCRIPTION"
    echo "────────────────────────────────────────────────────────"

    for id in "${!MODEL_DESC[@]}"; do
        local ram="${MODEL_RAM[$id]}"
        local tier="${MODEL_TIER[$id]}"
        local desc="${MODEL_DESC[$id]}"
        local canrun="✓"
        [ "$RAM_GB" -lt "$ram" ] && canrun="✗"
        printf "  %s %-34s %5sGB  %s\n" "$canrun" "$id" "$ram" "$desc"
    done | sort

    echo ""
    echo "  ✓ = fits your RAM   ✗ = requires more RAM"
    echo ""
    echo "Pull: bash scripts/model-hub.sh pull <model-id>"
    echo "HuggingFace GGUF: bash scripts/model-hub.sh hf hf.co/org/model"
}

cmd_pull() {
    local model_id="${1:-}"
    [ -z "$model_id" ] && { error "Usage: model-hub.sh pull <model-id>"; exit 1; }

    check_ollama

    # Check RAM requirement
    local req_ram="${MODEL_RAM[$model_id]:-0}"
    if [ "$req_ram" -gt 0 ] && [ "$RAM_GB" -lt "$req_ram" ]; then
        error "$model_id requires ${req_ram}GB RAM, you have ${RAM_GB}GB"
        error "Consider a smaller model: bash scripts/model-hub.sh list"
        exit 1
    fi

    log "Pulling $model_id..."
    ollama pull "$model_id"
    log "✓ $model_id ready — announcing to GSTD swarm via next heartbeat"
}

cmd_pull_tier() {
    local force="${1:-}"
    check_ollama

    log "Your RAM: ${RAM_GB}GB"

    local pulled=0
    for id in "${!MODEL_TIER[@]}"; do
        local tier="${MODEL_TIER[$id]}"
        local req_ram="${MODEL_RAM[$id]}"

        # Only pull if RAM fits
        [ "$RAM_GB" -lt "$req_ram" ] && continue
        # Only pull tier ≤ your hardware tier
        local hw_tier=1
        [ "$RAM_GB" -ge 32 ] && hw_tier=4
        [ "$RAM_GB" -ge 16 ] && [ "$hw_tier" -lt 3 ] && hw_tier=3
        [ "$RAM_GB" -ge 8 ]  && [ "$hw_tier" -lt 2 ] && hw_tier=2
        [ "$tier" -gt "$hw_tier" ] && continue

        # Skip if already pulled (unless --force)
        if [ "$force" != "--force" ]; then
            if ollama list 2>/dev/null | grep -qF "${id%%:*}:"; then
                log "✓ Already have $id"
                continue
            fi
        fi

        log "⬇ Pulling $id (tier $tier, ${req_ram}GB RAM)..."
        ollama pull "$id" && pulled=$((pulled + 1)) || log "⚠ Failed to pull $id, continuing..."
    done

    log "Done. Pulled $pulled new models."
    log "Your node will announce all available models to the GSTD swarm on next heartbeat."
}

cmd_hf() {
    local hf_id="${1:-}"
    [ -z "$hf_id" ] && { error "Usage: model-hub.sh hf hf.co/org/model"; exit 1; }

    # Normalize — add hf.co/ prefix if missing
    [[ "$hf_id" != hf.co/* ]] && hf_id="hf.co/$hf_id"

    check_ollama

    # Estimate RAM from model name
    local est_ram=8
    echo "$hf_id" | grep -qiE '70[Bb]|65[Bb]' && est_ram=40
    echo "$hf_id" | grep -qiE '32[Bb]|34[Bb]' && est_ram=20
    echo "$hf_id" | grep -qiE '13[Bb]|14[Bb]' && est_ram=9
    echo "$hf_id" | grep -qiE '7[Bb]|8[Bb]'   && est_ram=5
    echo "$hf_id" | grep -qiE '3[Bb]'          && est_ram=3
    echo "$hf_id" | grep -qiE '1[Bb]'          && est_ram=2

    if [ "$RAM_GB" -lt "$est_ram" ]; then
        log "Warning: this model may need ~${est_ram}GB RAM, you have ${RAM_GB}GB"
        read -r -p "Continue anyway? [y/N] " confirm
        [[ "$confirm" != [yY]* ]] && exit 0
    fi

    log "Pulling HuggingFace GGUF: $hf_id"
    log "Ollama will download the best quantization for your hardware..."
    ollama pull "$hf_id"
    log "✓ $hf_id ready — announcing to GSTD swarm via next heartbeat"
}

cmd_remove() {
    local model_id="${1:-}"
    [ -z "$model_id" ] && { error "Usage: model-hub.sh remove <model-id>"; exit 1; }
    check_ollama
    log "Removing $model_id..."
    ollama rm "$model_id"
    log "✓ Removed. Node will stop announcing $model_id on next heartbeat."
}

cmd_status() {
    check_ollama
    log "Installed models:"
    echo ""
    curl -sf "$OLLAMA_URL/api/tags" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    size_gb = m.get('size', 0) / 1024**3
    print(f'  ✓ {m[\"name\"]:40s}  {size_gb:.1f}GB')
" 2>/dev/null || ollama list
    echo ""
    log "These models are announced to the GSTD swarm on every heartbeat."
}

# ─── Main ─────────────────────────────────────────────────────────────────────
CMD="${1:-help}"
shift 2>/dev/null || true

case "$CMD" in
    list)        cmd_list ;;
    pull)        cmd_pull "$@" ;;
    pull-tier)   cmd_pull_tier "$@" ;;
    hf)          cmd_hf "$@" ;;
    remove|rm)   cmd_remove "$@" ;;
    status)      cmd_status ;;
    help|--help|-h)
        echo ""
        echo "GSTD Model Hub — pull any model from Ollama or HuggingFace"
        echo ""
        echo "  list              Show all available models"
        echo "  pull <id>         Pull an Ollama model (e.g. llama3.1:8b)"
        echo "  pull-tier         Pull all models for your hardware tier"
        echo "  hf <hf.co/...>    Pull a HuggingFace GGUF model"
        echo "  remove <id>       Remove a model from this node"
        echo "  status            List installed models"
        echo ""
        echo "Examples:"
        echo "  bash scripts/model-hub.sh pull llama3.1:8b"
        echo "  bash scripts/model-hub.sh hf hf.co/bartowski/Phi-3.5-mini-instruct-GGUF"
        echo "  bash scripts/model-hub.sh pull-tier"
        ;;
    *)
        error "Unknown command: $CMD"
        echo "Run: bash scripts/model-hub.sh help"
        exit 1
        ;;
esac
