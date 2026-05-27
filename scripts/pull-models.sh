#!/bin/bash
# ─── GSTD Node — Smart Model Downloader ──────────────────────────────────────
# Detects available RAM and downloads the best models for your hardware.
# Run once after installing the node, or when new models are released.
#
# Usage: bash scripts/pull-models.sh [--force]
#
# Hardware tiers:
#   Tier 1 (4-7 GB RAM):  llama3.2:3b — fast, excellent for Pi nodes
#   Tier 2 (8-15 GB RAM): + llama3.1:8b, qwen2.5:7b, mistral:7b
#   Tier 3 (16-31 GB):    + phi3:medium, qwen2.5:14b
#   Tier 4 (32+ GB RAM):  + llama3.1:70b, qwen2.5:32b (flagship models)

set -e

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
FORCE="${1:-}"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
error() { echo "[ERROR] $*" >&2; }

# ─── Check Ollama is running ────────────────────────────────────────────────
if ! curl -s "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
    error "Ollama is not running. Start it with: ollama serve"
    error "Or install from: https://ollama.ai"
    exit 1
fi

log "Ollama is running at $OLLAMA_URL"

# ─── Detect available RAM ───────────────────────────────────────────────────
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
log "Detected RAM: ${RAM_GB}GB"

# ─── Check if model is already pulled ──────────────────────────────────────
is_pulled() {
    local model="$1"
    local name="${model%%:*}"  # strip tag
    curl -s "$OLLAMA_URL/api/tags" | grep -q "\"$model\"" 2>/dev/null && return 0
    curl -s "$OLLAMA_URL/api/tags" | grep -q "\"$name:" 2>/dev/null && return 0
    return 1
}

pull_model() {
    local model="$1"
    local desc="$2"
    if [ "$FORCE" != "--force" ] && is_pulled "$model"; then
        log "✓ Already have $model ($desc)"
        return 0
    fi
    log "⬇ Pulling $model ($desc)..."
    ollama pull "$model"
    log "✓ $model ready"
}

# ─── Tier 1: Every GSTD node (4GB+) ────────────────────────────────────────
log ""
log "=== Tier 1: Core models (required for all nodes) ==="
pull_model "llama3.2:3b"  "3GB RAM — fast, Pi-optimized"

# ─── Tier 2: 8GB+ nodes ─────────────────────────────────────────────────────
if [ "$RAM_GB" -ge 8 ]; then
    log ""
    log "=== Tier 2: 8GB node models ==="
    pull_model "llama3.1:8b"  "5GB RAM — balanced reasoning"
    pull_model "qwen2.5:7b"   "4GB RAM — strong analytical"
    pull_model "mistral:7b"   "4GB RAM — creative writing"
fi

# ─── Tier 3: 16GB+ nodes ────────────────────────────────────────────────────
if [ "$RAM_GB" -ge 16 ]; then
    log ""
    log "=== Tier 3: 16GB node models ==="
    pull_model "phi3:medium"   "4GB RAM — efficient, high quality"
    pull_model "qwen2.5:14b"   "9GB RAM — strong reasoning"
fi

# ─── Tier 4: 32GB+ flagship nodes ───────────────────────────────────────────
if [ "$RAM_GB" -ge 32 ]; then
    log ""
    log "=== Tier 4: 32GB flagship models ==="
    pull_model "llama3.1:70b"  "40GB RAM — most capable Llama"
    pull_model "qwen2.5:32b"   "20GB RAM — deep reasoning"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
log ""
log "=== Installed models ==="
curl -s "$OLLAMA_URL/api/tags" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    size_gb = m.get('size', 0) / 1024**3
    print(f'  ✓ {m[\"name\"]:30s}  {size_gb:.1f}GB')
" 2>/dev/null || curl -s "$OLLAMA_URL/api/tags" | grep '"name"'

log ""
log "✅ Model setup complete. Your node will now announce these models to the GSTD swarm."
log "   Restart the node to pick up new models: pm2 restart gstdbot"
