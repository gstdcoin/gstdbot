#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node OS — Idempotent Installer v3.2
# curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
#
# Features:
#  • Safe to re-run — picks up where it left off
#  • --fresh flag to start clean installation
#  • Registers node with GSTD Swarm platform
#  • Works on Linux (Debian/Ubuntu/Fedora/Arch), macOS, WSL, ARM/RPi
#  • Deploy from GitHub (git clone)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="3.2.0"
INSTALL_DIR="${GSTD_INSTALL_DIR:-$HOME/gstdbot}"
CONFIG_DIR="$HOME/.config/gstdbot"
STATE_FILE="$CONFIG_DIR/.install_state"
LOG_FILE="$CONFIG_DIR/install.log"
API_URL="https://api.gstdtoken.com/v1"
REPO_URL="https://github.com/gstdcoin/gstdbot.git"

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────
info()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()     { echo -e "  ${RED}✗${NC} $1"; }
step()    { echo -e "\n${CYAN}[$1/8]${NC} ${BOLD}$2${NC}"; }
log()     { echo "[$(date +%H:%M:%S)] $1" >> "$LOG_FILE"; }

# State management — tracks completed steps
mark_done()  { echo "$1" >> "$STATE_FILE"; log "DONE: $1"; }
is_done()    { [ -f "$STATE_FILE" ] && grep -qx "$1" "$STATE_FILE" 2>/dev/null; }
reset_step() { [ -f "$STATE_FILE" ] && sed -i "/$1/d" "$STATE_FILE" 2>/dev/null; true; }

# ─── Handle --fresh flag ─────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --fresh|--clean|--reset)
            echo -e "  ${YELLOW}Resetting installation state...${NC}"
            rm -f "$STATE_FILE" 2>/dev/null || true
            ;;
        --help|-h)
            echo "GSTD Node Installer v${VERSION}"
            echo ""
            echo "Usage: curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash"
            echo "   or: bash install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --fresh    Reset state and start fresh installation"
            echo "  --help     Show this help"
            echo ""
            exit 0
            ;;
    esac
done

# Ensure config dir exists
mkdir -p "$CONFIG_DIR/skills"
echo "" >> "$LOG_FILE"
log "=== GSTD Node Installer v${VERSION} ==="

# ─── Banner ──────────────────────────────────────────────────────
echo -e "${CYAN}"
cat << 'BANNER'
╔══════════════════════════════════════════════╗
║   🐝 GSTD Node — Sovereign AI Platform      ║
║      v3.0 • Collective Intelligence          ║
╚══════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ─── Check for previous partial install ──────────────────────────
if [ -f "$STATE_FILE" ]; then
    COMPLETED=$(wc -l < "$STATE_FILE" | tr -d ' ')
    if [ "$COMPLETED" -gt 0 ] 2>/dev/null; then
        echo -e "  ${YELLOW}↻ Resuming previous install ($COMPLETED steps done)${NC}"
        echo -e "  ${DIM}To start fresh: bash install.sh --fresh${NC}"
        echo ""
    fi
fi

# ═══════════════════════════════════════════════════════════════
# STEP 1: System Detection
# ═══════════════════════════════════════════════════════════════
step 1 "Detecting system..."

OS="unknown"; ARCH=$(uname -m); PKG=""
if [ -f /etc/os-release ]; then
    . /etc/os-release; OS=$ID
    case $ID in
        ubuntu|debian|pop|linuxmint|raspbian) PKG="apt";;
        fedora|centos|rhel|rocky|alma) PKG="dnf";;
        arch|manjaro|endeavouros) PKG="pacman";;
        alpine) PKG="apk";;
    esac
elif [ "$(uname)" = "Darwin" ]; then
    OS="macos"; PKG="brew"
fi

# Detect WSL
if grep -qi microsoft /proc/version 2>/dev/null; then
    OS="wsl-${OS}"
fi

# Normalize arch
case $ARCH in
    x86_64)           ARCH="amd64";;
    aarch64|arm64)    ARCH="arm64";;
    armv7l|armv6l)    ARCH="armv7";;
esac

info "OS: ${OS} | Arch: ${ARCH} | Package: ${PKG:-none}"
log "System: ${OS} ${ARCH} ${PKG}"

# Check RAM
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}' || echo 0)
if [ "$TOTAL_RAM_MB" -lt 2048 ] 2>/dev/null && [ "$TOTAL_RAM_MB" -gt 0 ] 2>/dev/null; then
    warn "Low RAM (${TOTAL_RAM_MB}MB). Cloud mode recommended."
fi

# ═══════════════════════════════════════════════════════════════
# STEP 2: Install / Verify Node.js ≥ 20
# ═══════════════════════════════════════════════════════════════
step 2 "Setting up Node.js..."

install_nodejs() {
    log "Installing Node.js..."
    case $PKG in
        apt)
            if ! node -v 2>/dev/null | grep -q "v2[0-9]"; then
                curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - 2>/dev/null
                sudo apt-get install -y nodejs 2>/dev/null
            fi
            ;;
        dnf)
            curl -fsSL https://rpm.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - 2>/dev/null
            sudo dnf install -y nodejs 2>/dev/null
            ;;
        pacman) sudo pacman -S --noconfirm nodejs npm 2>/dev/null;;
        apk)    sudo apk add --no-cache nodejs npm 2>/dev/null;;
        brew)
            brew install node@22 2>/dev/null || {
                curl -fsSL https://fnm.vercel.app/install | bash 2>/dev/null
                export PATH="$HOME/.local/share/fnm:$PATH"
                eval "$(fnm env 2>/dev/null)" 2>/dev/null
                fnm install 22 2>/dev/null && fnm use 22 2>/dev/null
            }
            ;;
        *)
            if ! command -v nvm &>/dev/null; then
                curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>/dev/null
                export NVM_DIR="$HOME/.nvm"
                [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            fi
            nvm install 22 2>/dev/null && nvm use 22 2>/dev/null
            ;;
    esac
}

if is_done "nodejs"; then
    if command -v node &>/dev/null; then
        info "Node.js $(node -v) (already installed)"
    else
        warn "Node.js was marked done but not found — reinstalling"
        reset_step "nodejs"
    fi
fi

if ! is_done "nodejs"; then
    if command -v node &>/dev/null; then
        NODE_VER_MAJOR=$(node -v | sed 's/v//' | cut -d'.' -f1)
        if [ "$NODE_VER_MAJOR" -ge 20 ] 2>/dev/null; then
            info "Node.js $(node -v) ✓"
        else
            warn "Node.js $(node -v) too old, upgrading to 22..."
            install_nodejs
            info "Node.js $(node -v)"
        fi
    else
        warn "Node.js not found, installing..."
        install_nodejs
        export PATH="/usr/local/bin:/usr/bin:$HOME/.local/share/fnm:$HOME/.nvm/versions/node/v22*/bin:$PATH"
        if command -v node &>/dev/null; then
            info "Node.js $(node -v) installed"
        else
            err "Failed to install Node.js. Install manually: https://nodejs.org"
            exit 1
        fi
    fi
    mark_done "nodejs"
fi

if ! command -v npm &>/dev/null; then
    err "npm not found. Please install Node.js manually: https://nodejs.org"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════
# STEP 3: Install / Verify Git
# ═══════════════════════════════════════════════════════════════
step 3 "Checking git..."

if command -v git &>/dev/null; then
    info "git $(git --version | awk '{print $3}')"
else
    warn "Git not found, installing..."
    case $PKG in
        apt) sudo apt-get install -y git 2>>"$LOG_FILE";;
        dnf) sudo dnf install -y git 2>>"$LOG_FILE";;
        pacman) sudo pacman -S --noconfirm git 2>>"$LOG_FILE";;
        apk) sudo apk add --no-cache git 2>>"$LOG_FILE";;
        brew) brew install git 2>>"$LOG_FILE";;
    esac
    if command -v git &>/dev/null; then
        info "git installed"
    else
        err "Failed to install git"
        exit 1
    fi
fi

# ═══════════════════════════════════════════════════════════════
# STEP 4: Clone / Update GSTD Node from GitHub
# ═══════════════════════════════════════════════════════════════
step 4 "Setting up GSTD Node from GitHub..."

if is_done "gstdbot" && [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    info "GSTD Node already installed at $INSTALL_DIR"
    info "Checking for updates..."
    cd "$INSTALL_DIR"
    if git pull --ff-only 2>>"$LOG_FILE"; then
        info "Updated to latest"
    else
        info "Already up to date (or local changes present)"
    fi
    cd - >/dev/null
else
    if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
        info "GSTD Node found at $INSTALL_DIR, updating..."
        cd "$INSTALL_DIR"
        git pull --ff-only 2>>"$LOG_FILE" || true
        cd - >/dev/null
    else
        info "Cloning GSTD Node from GitHub..."
        if git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>>"$LOG_FILE"; then
            info "Cloned to $INSTALL_DIR"
        else
            err "Failed to clone repository"
            err "Try manually: git clone $REPO_URL $INSTALL_DIR"
            exit 1
        fi
    fi
    reset_step "gstdbot"
fi

# Build
step 4 "Building GSTD Node..."
cd "$INSTALL_DIR"

# Always install/update dependencies
npm install --legacy-peer-deps 2>>"$LOG_FILE" || {
    warn "npm install failed, retrying..."
    npm install 2>>"$LOG_FILE"
}
info "Dependencies installed"

# Always rebuild TypeScript to ensure dist/ matches source
info "Compiling TypeScript..."
npx tsc 2>>"$LOG_FILE" || {
    warn "TypeScript build failed, trying with --skipLibCheck..."
    npx tsc --skipLibCheck 2>>"$LOG_FILE" || {
        # If build fails completely, dist/ from git should still work
        if [ -f "dist/index.js" ]; then
            warn "Build failed but pre-built dist/ exists — using it"
        else
            err "Build failed and no pre-built dist/ found"
            exit 1
        fi
    }
}
info "Build complete ✓"

# Verify the critical file exists
if [ ! -f "dist/gateway/server.js" ]; then
    err "dist/gateway/server.js missing — build incomplete"
    exit 1
fi
info "Verified: gateway server ready"

cd - >/dev/null
mark_done "gstdbot"

# ═══════════════════════════════════════════════════════════════
# STEP 5: Choose AI Mode
# ═══════════════════════════════════════════════════════════════
step 5 "Choosing AI engine..."

SAVED_MODE=""
if [ -f "$CONFIG_DIR/config.json" ]; then
    SAVED_MODE=$(python3 -c "import json; print(json.load(open('$CONFIG_DIR/config.json')).get('mode',''))" 2>/dev/null || echo "")
fi

if is_done "mode" && [ -n "$SAVED_MODE" ]; then
    MODE="$SAVED_MODE"
    info "Mode: ${MODE} (previously selected)"
else
    echo ""
    echo -e "  ${BOLD}How do you want to run AI models?${NC}"
    echo ""
    echo -e "  ${GREEN}[1]${NC} ☁️  ${BOLD}Cloud Mode${NC} ${DIM}(instant start, no download)${NC}"
    echo -e "      ${DIM}AI runs on Groq Cloud. 8 models available immediately. Free.${NC}"
    echo ""
    echo -e "  ${CYAN}[2]${NC} 💻 ${BOLD}Hybrid Mode${NC} ${DIM}(local + cloud, recommended)${NC}"
    echo -e "      ${DIM}Simple tasks local via Ollama, complex → Groq Cloud. ~5GB disk.${NC}"
    echo ""
    echo -e "  ${YELLOW}[3]${NC} 🔒 ${BOLD}Sovereign Mode${NC} ${DIM}(fully local, max privacy)${NC}"
    echo -e "      ${DIM}Everything on device via Ollama. ~10GB disk. No internet needed for AI.${NC}"
    echo ""

    read -t 30 -p "  Choose [1/2/3] (default: 1): " MODE_CHOICE 2>/dev/null || MODE_CHOICE="1"
    echo ""

    case $MODE_CHOICE in
        2) MODE="hybrid";;
        3) MODE="sovereign";;
        *) MODE="cloud";;
    esac
    mark_done "mode"
fi

# ─── Handle Ollama for hybrid/sovereign ──────────────────────────
install_ollama() {
    if command -v ollama &>/dev/null; then
        info "Ollama already installed"
        if ! pgrep -x ollama &>/dev/null; then
            ollama serve &>/dev/null &
            sleep 2
        fi
        return 0
    fi
    log "Installing Ollama..."
    if curl -fsSL https://ollama.com/install.sh | sh 2>>"$LOG_FILE"; then
        info "Ollama installed"
        if ! pgrep -x ollama &>/dev/null; then
            ollama serve &>/dev/null &
            sleep 3
        fi
        return 0
    else
        warn "Ollama install failed (non-fatal for Cloud mode)"
        return 1
    fi
}

pull_model() {
    local model="$1"
    if ollama list 2>/dev/null | grep -q "$model"; then
        info "Model ${model} ✓ (already pulled)"
        return 0
    fi
    warn "Pulling ${model}... (this may take a few minutes)"
    if ollama pull "$model" 2>>"$LOG_FILE"; then
        info "Model ${model} ✓"
        return 0
    else
        warn "Failed to pull ${model}. Try later: ollama pull ${model}"
        return 1
    fi
}

case $MODE in
    cloud)
        info "Cloud mode — AI via Groq (8 models, instant, free)"
        ;;
    hybrid)
        info "Hybrid mode selected"
        if ! is_done "ollama"; then install_ollama && mark_done "ollama"; else info "Ollama (already set up)"; fi
        if ! is_done "model_llama"; then pull_model "llama3.1:8b" && mark_done "model_llama"; fi
        ;;
    sovereign)
        info "Sovereign mode selected"
        if ! is_done "ollama"; then install_ollama && mark_done "ollama"; else info "Ollama (already set up)"; fi
        if ! is_done "model_llama"; then pull_model "llama3.1:8b" && mark_done "model_llama"; fi
        if ! is_done "model_coder"; then pull_model "qwen2.5-coder:7b" && mark_done "model_coder"; fi
        ;;
esac

# ═══════════════════════════════════════════════════════════════
# STEP 6: Configure Node
# ═══════════════════════════════════════════════════════════════
step 6 "Configuring node..."

NODE_ID=""
if [ -f "$CONFIG_DIR/config.json" ]; then
    NODE_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_DIR/config.json')).get('nodeId',''))" 2>/dev/null || echo "")
fi

if [ -z "$NODE_ID" ]; then
    NODE_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))" 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "node-$(date +%s)")
fi

LOCAL_MODELS='[]'
if [ "$MODE" != "cloud" ] && command -v ollama &>/dev/null; then
    LOCAL_MODELS=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | head -5 | python3 -c "
import sys,json
models = [l.strip() for l in sys.stdin if l.strip()]
print(json.dumps(models))
" 2>/dev/null || echo '[]')
fi

NODE_NAME="${HOSTNAME:-$(hostname)}-node"

cat > "$CONFIG_DIR/config.json" << CONF
{
  "version": "${VERSION}",
  "mode": "${MODE}",
  "nodeId": "${NODE_ID}",
  "nodeName": "${NODE_NAME}",
  "installDir": "${INSTALL_DIR}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "swarm": {
    "enabled": true,
    "maxCPU": 80,
    "maxRAM": 70,
    "apiUrl": "${API_URL}"
  },
  "groq": {
    "models": ["llama-3.3-70b-versatile","llama-3.1-8b-instant","meta-llama/llama-4-scout-17b-16e-instruct","meta-llama/llama-4-maverick-17b-128e-instruct","qwen/qwen3-32b","openai/gpt-oss-120b","openai/gpt-oss-20b","moonshotai/kimi-k2-instruct"]
  },
  "dashboard": {
    "host": "0.0.0.0",
    "port": 8080,
    "enabled": true
  },
  "models": {
    "local": ${LOCAL_MODELS}
  }
}
CONF
info "Config saved: $CONFIG_DIR/config.json"

# ═══════════════════════════════════════════════════════════════
# STEP 7: Register Node with GSTD Platform
# ═══════════════════════════════════════════════════════════════
step 7 "Registering node with GSTD Swarm..."

register_node() {
    local payload="{\"node_id\":\"${NODE_ID}\",\"node_name\":\"${NODE_NAME}\",\"mode\":\"${MODE}\",\"os\":\"${OS}\",\"arch\":\"${ARCH}\",\"ram_mb\":${TOTAL_RAM_MB:-0},\"version\":\"${VERSION}\"}"

    local result
    result=$(curl -s -X POST "${API_URL}/nodes/register" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --connect-timeout 5 \
        --max-time 10 2>/dev/null) || true

    if echo "$result" | grep -qi "success\|registered\|ok\|id" 2>/dev/null; then
        info "Node registered with GSTD Swarm ✓"
        return 0
    else
        warn "Could not register node (platform may be busy)"
        info "Node will auto-register on next heartbeat"
        return 0
    fi
}

if ! is_done "registered"; then
    register_node
    mark_done "registered"
else
    info "Node already registered"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 8: Start Node & Dashboard
# ═══════════════════════════════════════════════════════════════
step 8 "Starting GSTD Node..."

DASH_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_DIR/config.json')).get('dashboard',{}).get('port',8080))" 2>/dev/null || echo 8080)

if [ -f "$INSTALL_DIR/dist/index.js" ]; then
    # Kill any existing node process
    pkill -f "node.*dist/index.js" 2>/dev/null || true
    sleep 1

    # Start in background with log
    cd "$INSTALL_DIR"
    NODE_NAME="${NODE_NAME}" GSTD_DASHBOARD_PORT="$DASH_PORT" \
        nohup node dist/index.js >> "$CONFIG_DIR/node.log" 2>&1 &
    NODE_PID=$!
    echo "$NODE_PID" > "$CONFIG_DIR/node.pid"
    sleep 2

    # Check if started
    if kill -0 "$NODE_PID" 2>/dev/null; then
        info "Node started (PID: $NODE_PID)"
        info "Dashboard: http://localhost:${DASH_PORT}"
        info "Log: $CONFIG_DIR/node.log"
    else
        warn "Node process exited. Check: $CONFIG_DIR/node.log"
        warn "Start manually: cd $INSTALL_DIR && node dist/index.js"
    fi
    cd - >/dev/null

    # ─── Auto-start via systemd (if available) ──────────────────
    if command -v systemctl &>/dev/null && [ -d /etc/systemd/system ]; then
        if [ ! -f /etc/systemd/system/gstd-node.service ]; then
            info "Installing systemd service for auto-start on boot..."
            CURRENT_USER=$(whoami)
            cat > /tmp/gstd-node.service << SVCEOF
[Unit]
Description=GSTD Node OS — Sovereign AI Node
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=GSTD_API_PORT=${DASH_PORT}
Environment=GSTD_INSTALL_DIR=${INSTALL_DIR}
Environment=SWARM_ENABLED=true
Environment=GSTD_MEMORY=true
ExecStart=$(which node) dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gstd-node
LimitNOFILE=65535
MemoryMax=1G

[Install]
WantedBy=multi-user.target
SVCEOF
            if sudo mv /tmp/gstd-node.service /etc/systemd/system/gstd-node.service 2>/dev/null && \
               sudo systemctl daemon-reload 2>/dev/null && \
               sudo systemctl enable gstd-node 2>/dev/null; then
                # Stop the nohup process and let systemd manage it
                kill "$NODE_PID" 2>/dev/null || true
                sleep 1
                sudo systemctl start gstd-node 2>/dev/null
                info "systemd service installed — node will auto-start on boot ✓"
                info "Manage: sudo systemctl {start|stop|restart|status} gstd-node"
            else
                warn "Could not install systemd service (running as nohup instead)"
            fi
        else
            info "systemd service already installed ✓"
            # Ensure it's running via systemd
            if ! systemctl is-active --quiet gstd-node 2>/dev/null; then
                kill "$NODE_PID" 2>/dev/null || true
                sudo systemctl start gstd-node 2>/dev/null
            fi
        fi
    fi
else
    warn "dist/index.js not found — build may have failed"
    warn "Try: cd $INSTALL_DIR && npx tsc && node dist/index.js"
fi

# ─── Verify everything ──────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}✓ GSTD Node ready!${NC}                             ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"

echo ""
echo -e "  ${BOLD}Verification:${NC}"
command -v node &>/dev/null && echo -e "  ${GREEN}✓${NC} Node.js $(node -v)" || echo -e "  ${RED}✗${NC} Node.js"
command -v npm &>/dev/null && echo -e "  ${GREEN}✓${NC} npm $(npm -v)" || echo -e "  ${RED}✗${NC} npm"
command -v git &>/dev/null && echo -e "  ${GREEN}✓${NC} git" || echo -e "  ${RED}✗${NC} git"
[ -d "$INSTALL_DIR/dist" ] && echo -e "  ${GREEN}✓${NC} GSTD Node built ($INSTALL_DIR)" || echo -e "  ${YELLOW}⚠${NC} GSTD Node not built"
[ -f "$CONFIG_DIR/config.json" ] && echo -e "  ${GREEN}✓${NC} Config" || echo -e "  ${RED}✗${NC} Config"
echo -e "  ${GREEN}✓${NC} Node ID: ${NODE_ID}"

if [ "$MODE" != "cloud" ]; then
    command -v ollama &>/dev/null && echo -e "  ${GREEN}✓${NC} Ollama" || echo -e "  ${YELLOW}⚠${NC} Ollama (install: curl -fsSL https://ollama.com/install.sh | sh)"
    ollama list 2>/dev/null | grep -q "llama" && echo -e "  ${GREEN}✓${NC} AI Models" || echo -e "  ${YELLOW}⚠${NC} Models (run: ollama pull llama3.1:8b)"
fi

echo ""
echo -e "  ${BOLD}Quick Start:${NC}"
echo -e "  ${GREEN}📊 Control Panel:${NC}    ${CYAN}http://localhost:${DASH_PORT}${NC}"
echo -e "  ${GREEN}🔄 Restart node:${NC}     ${CYAN}cd $INSTALL_DIR && node dist/index.js${NC}"
echo -e "  ${GREEN}📋 View logs:${NC}        ${CYAN}tail -f $CONFIG_DIR/node.log${NC}"
echo -e "  ${GREEN}⏹  Stop node:${NC}        ${CYAN}kill \$(cat $CONFIG_DIR/node.pid)${NC}"
echo ""
echo -e "  ${BOLD}Telegram Bot:${NC}"
echo -e "  ${CYAN}https://t.me/GstdAppBot${NC}        Chat with 8 AI models free"
echo ""
echo -e "  ${BOLD}AI Models (Groq — all free!):${NC}"
echo -e "  🦙 Llama 3.3 70B     🔭 Llama 4 Scout"
echo -e "  ⚡ Llama 3.1 8B      🚀 Llama 4 Maverick"
echo -e "  🐉 Qwen3 32B        🧠 GPT-OSS 120B"
echo -e "  💡 GPT-OSS 20B      🌙 Kimi K2"
echo ""
echo -e "  ${BOLD}Collective Intelligence (SmartMix):${NC}"
echo -e "  🆓 Free    — 1 model, instant"
echo -e "  🔬 Council — 3 experts consensus"
echo -e "  🔥 Panel   — 5 experts cross-verified"
echo -e "  🧠 Swarm   — 7 experts full synthesis"
echo ""
echo -e "  ${BOLD}Manage:${NC}"
echo -e "  Re-run installer:  ${CYAN}curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash${NC}"
echo -e "  Start fresh:       ${CYAN}curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash -s -- --fresh${NC}"
echo -e "  Update:            ${CYAN}cd $INSTALL_DIR && git pull && npx tsc${NC}"
echo ""
echo -e "  ${BOLD}Links:${NC}"
echo -e "  🌐 ${DIM}https://gstdtoken.com${NC}"
echo -e "  🤖 ${DIM}https://t.me/GstdAppBot${NC}"
echo -e "  📡 ${DIM}https://github.com/gstdcoin${NC}"
echo -e "  💬 ${DIM}https://t.me/goldstandardcoin${NC}"
echo ""
echo -e "  ${DIM}Install log:   $LOG_FILE${NC}"
echo -e "  ${DIM}State file:    $STATE_FILE${NC}"
echo -e "  ${DIM}Install dir:   $INSTALL_DIR${NC}"
echo -e "  ${DIM}PID file:      $CONFIG_DIR/node.pid${NC}"
echo ""
