#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node OS — One-Command Installer v3.6
# curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
#
# ✅ Fully automatic — no interactive prompts
# ✅ Idempotent — safe to re-run anytime
# ✅ Resumes after interruption
# Existing installations update only when this installer is explicitly rerun
# ✅ Registers as systemd service (auto-start on boot)
# Linux x86-64/ARM64 and WSL2; runtime/driver checks still apply.
# macOS is best-effort; native Windows uses WSL2.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# Minimal root images may not include sudo. Keep normal-user sudo behaviour.
sudo() {
    if [ "$(id -u)" = 0 ]; then
        while [ "${1:-}" = -E ] || [ "${1:-}" = -n ]; do shift; done
        "$@"
    else
        command sudo "$@"
    fi
}


VERSION="3.7.0"
INSTALL_DIR="${GSTD_INSTALL_DIR:-$HOME/gstdbot}"
CONFIG_DIR="$HOME/.config/gstdbot"
STATE_FILE="$CONFIG_DIR/.install_state"
LOG_FILE="$CONFIG_DIR/install.log"
API_URL="https://app.gstdtoken.com/api/v1"
REPO_URL="https://github.com/gstdcoin/gstdbot.git"
DASH_PORT="${GSTD_PORT:-8080}"
MODE="${GSTD_MODE:-sovereign}"
STARTER_MODEL="${GSTD_STARTER_MODEL:-auto}"

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────
info()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()     { echo -e "  ${RED}✗${NC} $1"; }
step()    { echo -e "\n${CYAN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }
log()     { echo "[$(date +%H:%M:%S)] $1" >> "$LOG_FILE" 2>/dev/null || true; }

TOTAL_STEPS=8

# State management — tracks completed steps
mark_done()  { echo "$1" >> "$STATE_FILE"; log "DONE: $1"; }
is_done()    { [ -f "$STATE_FILE" ] && grep -qx "$1" "$STATE_FILE" 2>/dev/null; }
reset_step() { [ -f "$STATE_FILE" ] && sed -i "/$1/d" "$STATE_FILE" 2>/dev/null; true; }

update_existing_checkout() {
    local branch="$1"
    local current_hash target_hash

    if [ -n "$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=no)" ]; then
        err "Local tracked changes in $INSTALL_DIR; refusing to overwrite them"
        return 1
    fi

    git -C "$INSTALL_DIR" fetch --no-tags --quiet origin "$branch" 2>>"$LOG_FILE" || {
        err "Failed to fetch updates from origin/$branch"
        return 1
    }
    if [ "$(git -C "$INSTALL_DIR" rev-parse --is-shallow-repository)" = "true" ]; then
        git -C "$INSTALL_DIR" fetch --unshallow --no-tags --quiet origin "$branch" 2>>"$LOG_FILE" || {
            err "Failed to verify update history for this shallow checkout"
            return 1
        }
    fi

    current_hash=$(git -C "$INSTALL_DIR" rev-parse HEAD)
    target_hash=$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)
    if [ "$current_hash" = "$target_hash" ]; then
        info "Already up to date (${current_hash:0:8})"
        return 0
    fi
    if ! git -C "$INSTALL_DIR" merge-base --is-ancestor "$current_hash" "$target_hash"; then
        err "Local history diverges from origin/$branch; refusing to reset or overwrite it"
        return 1
    fi
    git -C "$INSTALL_DIR" merge --ff-only "$target_hash" >>"$LOG_FILE" 2>&1 || {
        err "Fast-forward update failed; existing node files were preserved"
        return 1
    }
    info "Updated to ${target_hash:0:8}"
}

# Read-only preflight runs before touching configuration or installing packages.
platform_supported() {
    case "$1:$2" in Linux:x86_64|Linux:aarch64|Linux:arm64|Darwin:x86_64|Darwin:arm64) return 0;; *) return 1;; esac
}
check_environment() {
    local system machine
    system=$(uname -s); machine=$(uname -m)
    printf 'System: %s\nArchitecture: %s\n' "$system" "$machine"
    if ! platform_supported "$system" "$machine"; then
        echo 'Unsupported OS/architecture. Use 64-bit Linux x86-64/ARM64, or WSL2 on Windows.'
        return 2
    fi
    echo 'Architecture supported; model runtime and GPU drivers still require validation.'
    [ "$system" = Darwin ] && echo 'macOS source installation is best-effort, not validated end-to-end.'
    command -v free >/dev/null && free -m || true
    command -v df >/dev/null && df -h "$HOME" | tail -1 || true
    command -v node >/dev/null && node --version || true
    command -v ollama >/dev/null && ollama --version || true
    echo 'GPU is optional. No GPU drivers will be installed or replaced.'
}

# ─── Handle flags ────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --check) check_environment; exit $?;;
        --no-model) STARTER_MODEL="none";;
        --model=*) STARTER_MODEL="${arg#--model=}";;
        --fresh|--clean|--reset)
            echo -e "  ${YELLOW}Resetting installation state...${NC}"
            rm -f "$STATE_FILE" 2>/dev/null || true
            ;;
        --sovereign) MODE="sovereign";;
        --hybrid)    MODE="hybrid";;
        --cloud)     MODE="cloud";;
        --port=*)    DASH_PORT="${arg#--port=}";;
        --help|-h)
            echo "GSTD Node OS Installer v${VERSION}"
            echo ""
            echo "Usage: curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash"
            echo "   or: bash install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --fresh       Reset state and start fresh"
            echo "  --check       Read-only OS/architecture/resources check"
            echo "  --no-model    Install the node without downloading a model"
            echo "  --model=TAG   Choose a local Ollama starter model"
            echo "  --cloud       Legacy flag; local-only requests remain the default"
            echo "  --hybrid      Legacy compatibility flag; requests remain local by default"
            echo "  --sovereign   Local-first compute (default)"
            echo "  --port=PORT   Dashboard port (default: 8080)"
            echo "  --help        Show this help"
            echo ""
            echo "Environment variables:"
            echo "  GSTD_MODE=sovereign (default)"
            echo "  GSTD_STARTER_MODEL=auto|none|family:tag"
            echo "  GSTD_WALLET_ADDRESS=public-TON-address"
            echo "  GSTD_PORT=8080"
            echo "  GSTD_INSTALL_DIR=~/gstdbot"
            echo "  NODE_NAME=my-node"
            echo ""
            exit 0
            ;;
    esac
done

# Ensure config dir exists
mkdir -p "$CONFIG_DIR/skills" 2>/dev/null || true
touch "$LOG_FILE" 2>/dev/null || true
log "=== GSTD Node OS Installer v${VERSION} ==="

# ─── Banner ──────────────────────────────────────────────────────
echo -e "${CYAN}"
cat << 'BANNER'

  ╔══════════════════════════════════════════════════╗
  ║   🐝 GSTD Node OS — Decentralized AI Compute     ║
  ║      v3.6 • Local-first AI compute       ║
  ╚══════════════════════════════════════════════════╝

BANNER
echo -e "${NC}"

# ─── Check for previous install ──────────────────────────────────
if [ -f "$STATE_FILE" ]; then
    COMPLETED=$(wc -l < "$STATE_FILE" 2>/dev/null | tr -d ' ')
    if [ "${COMPLETED:-0}" -gt 0 ] 2>/dev/null; then
        echo -e "  ${YELLOW}↻ Resuming (${COMPLETED} steps already done)${NC}"
        echo -e "  ${DIM}To start fresh: add --fresh flag${NC}"
        echo ""
    fi
fi

# ═══════════════════════════════════════════════════════════════
# STEP 1: System Detection
# ═══════════════════════════════════════════════════════════════
step 1 "Detecting system..."

OS="unknown"; ARCH=$(uname -m); PKG=""
if [ -f /etc/os-release ]; then
    OS=$(. /etc/os-release; printf '%s' "$ID")
    case $OS in
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

if ! platform_supported "$(uname -s)" "$(uname -m)"; then
    err "Unsupported architecture. Install a 64-bit Linux x86-64/ARM64 OS; use WSL2 for Windows."
    exit 2
fi
if [ -z "$PKG" ] && { ! command -v node >/dev/null || ! command -v npm >/dev/null || ! command -v git >/dev/null; }; then
    err "Unknown package manager. Install Node.js 20+, npm, git and curl, then rerun."
    exit 2
fi

TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}' || echo 0)
info "OS: ${OS} | Arch: ${ARCH} | RAM: ${TOTAL_RAM_MB}MB"
log "System: ${OS} ${ARCH} ${PKG} RAM:${TOTAL_RAM_MB}MB"

# ═══════════════════════════════════════════════════════════════
# STEP 2: Install / Verify Node.js ≥ 20
# ═══════════════════════════════════════════════════════════════
step 2 "Setting up Node.js..."

need_nodejs() {
    if command -v node &>/dev/null; then
        local ver=$(node -v | sed 's/v//' | cut -d'.' -f1)
        [ "${ver:-0}" -ge 20 ] 2>/dev/null && node -e 'process.exit(typeof require("node:util").parseEnv === "function" ? 0 : 1)' 2>/dev/null && return 1  # supported runtime
    fi
    return 0  # need install
}

install_nodejs() {
    log "Installing Node.js..."
    case $PKG in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - >/dev/null 2>&1
            sudo apt-get install -y nodejs >/dev/null 2>&1
            ;;
        dnf)
            curl -fsSL https://rpm.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - >/dev/null 2>&1
            sudo dnf install -y nodejs >/dev/null 2>&1
            ;;
        pacman) sudo pacman -S --noconfirm nodejs npm >/dev/null 2>&1;;
        apk)    sudo apk add --no-cache nodejs npm >/dev/null 2>&1;;
        brew)
            brew install node@22 >/dev/null 2>&1 || {
                err "Homebrew could not install Node.js 22."
                return 1
            }
            brew link --overwrite --force node@22 >/dev/null 2>&1 || {
                err "Homebrew could not link Node.js 22."
                return 1
            }
            ;;
        *)
            if ! command -v nvm &>/dev/null; then
                curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh 2>/dev/null | bash >/dev/null 2>&1
                export NVM_DIR="$HOME/.nvm"
                [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            fi
            nvm install 22 >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1
            ;;
    esac
}

if need_nodejs; then
    warn "Installing Node.js 22..."
    install_nodejs
    export PATH="/usr/local/bin:/usr/bin:$HOME/.local/share/fnm:$PATH"
    if ! command -v node &>/dev/null; then
        err "Failed to install Node.js. Install manually: https://nodejs.org"
        exit 1
    fi
fi
info "Node.js $(node -v) ✓"

if ! command -v npm &>/dev/null; then
    err "npm not found. Install Node.js manually: https://nodejs.org"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════
# STEP 3: Install Git + Clone/Update Repo
# ═══════════════════════════════════════════════════════════════
step 3 "Setting up GSTD Node..."

# Ensure git
if ! command -v git &>/dev/null; then
    warn "Installing git..."
    case $PKG in
        apt) sudo apt-get install -y git >/dev/null 2>&1;;
        dnf) sudo dnf install -y git >/dev/null 2>&1;;
        pacman) sudo pacman -S --noconfirm git >/dev/null 2>&1;;
        apk) sudo apk add --no-cache git >/dev/null 2>&1;;
        brew) brew install git >/dev/null 2>&1;;
    esac
fi

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation..."
    update_existing_checkout main
elif [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    err "Found $INSTALL_DIR without Git metadata; preserving it instead of deleting user data"
    err "Move or back up this directory manually, then rerun the installer"
    exit 1
else
    info "Cloning from GitHub..."
    git clone --depth 10 "$REPO_URL" "$INSTALL_DIR" 2>>"$LOG_FILE"
    if [ -n "${GSTD_INSTALL_REF:-}" ]; then
        [[ "$GSTD_INSTALL_REF" =~ ^[a-fA-F0-9]{40}$ ]] || { err "GSTD_INSTALL_REF must be a full commit SHA"; exit 2; }
        git -C "$INSTALL_DIR" fetch --depth 1 origin "$GSTD_INSTALL_REF" >>"$LOG_FILE" 2>&1
        git -C "$INSTALL_DIR" checkout --detach FETCH_HEAD >>"$LOG_FILE" 2>&1
    fi
    info "Cloned to $INSTALL_DIR"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 4: Install Dependencies + Build
# ═══════════════════════════════════════════════════════════════
step 4 "Building..."

cd "$INSTALL_DIR"

# Always run npm install (fast if nothing changed)
# --no-audit: suppress vulnerability report (we audit and fix in CI — safe to omit here)
npm ci --include=dev --no-audit >>"$LOG_FILE" 2>&1 || {
    err "Dependency installation failed. The committed lockfile was not rewritten. Check: $LOG_FILE"
    exit 1
}
info "Dependencies ✓"

# Always rebuild TypeScript (fast if nothing changed)
node_modules/.bin/tsc >>"$LOG_FILE" 2>&1 || {
    err "TypeScript build failed. Check: $LOG_FILE"
    exit 1
}
info "Build ✓"

cd - >/dev/null

# ═══════════════════════════════════════════════════════════════
# STEP 5: Configure
# ═══════════════════════════════════════════════════════════════
step 5 "Configuring..."

# Preserve existing nodeId if present
NODE_ID=""
if [ -f "$CONFIG_DIR/config.json" ]; then
    NODE_ID=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(d.nodeId!==undefined&&typeof d.nodeId!=="string")throw Error("Invalid existing nodeId");console.log(d.nodeId||"")' "$CONFIG_DIR/config.json")
    # Preserve mode if not explicitly set
    if [ "$MODE" = "cloud" ]; then
        SAVED_MODE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mode||"sovereign")' "$CONFIG_DIR/config.json")
        MODE="$SAVED_MODE"
    fi
fi

if [ -z "$NODE_ID" ]; then
    NODE_ID=$(node -e 'console.log(require("crypto").randomUUID())')
fi

NODE_NAME="${NODE_NAME:-${HOSTNAME:-$(hostname)}-node}"

GSTD_CFG_FILE="$CONFIG_DIR/config.json" GSTD_CFG_VERSION="$VERSION" GSTD_CFG_MODE="$MODE" GSTD_CFG_ID="$NODE_ID" GSTD_CFG_NAME="$NODE_NAME" GSTD_CFG_INSTALL="$INSTALL_DIR" GSTD_CFG_API="$API_URL" GSTD_CFG_PORT="$DASH_PORT" node <<'NODECONFIG'
const fs=require('fs'),e=process.env,file=e.GSTD_CFG_FILE;
const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const port=Number(e.GSTD_CFG_PORT);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid dashboard port');
const config={...old,version:e.GSTD_CFG_VERSION,mode:e.GSTD_CFG_MODE,nodeId:e.GSTD_CFG_ID,nodeName:e.GSTD_CFG_NAME,installDir:e.GSTD_CFG_INSTALL,
 installedAt:old.installedAt||new Date().toISOString(),
 swarm:{enabled:true,maxCPU:80,maxRAM:70,...old.swarm,apiUrl:e.GSTD_CFG_API},
 dashboard:{host:'0.0.0.0',enabled:true,...old.dashboard,port},
 ollama:old.ollama||{url:'http://localhost:11434',models:[]},
 memory:old.memory||{enabled:false},apps:old.apps||{enabled:false}};
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.chmodSync(file,0o600);
NODECONFIG
info "Config: $MODE mode, port $DASH_PORT, ID: ${NODE_ID:0:8}..."

# Copy .env if missing
if [ ! -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/.env.example" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    # Inject NODE_NAME if set
    if [ -n "${NODE_NAME:-}" ]; then
        sed -i "s|^NODE_NAME=.*|NODE_NAME=${NODE_NAME}|" "$INSTALL_DIR/.env"
    fi
    # Inject GSTD_WALLET_ADDRESS if provided via env
    if [ -n "${GSTD_WALLET_ADDRESS:-}" ]; then
        sed -i "s|^GSTD_WALLET_ADDRESS=.*|GSTD_WALLET_ADDRESS=${GSTD_WALLET_ADDRESS}|" "$INSTALL_DIR/.env"
        info "Wallet address set: ${GSTD_WALLET_ADDRESS:0:12}..."
    else
        warn "GSTD_WALLET_ADDRESS not set — set your public TON address as GSTD_WALLET_ADDRESS before accepting paid work"
    fi
    GSTD_SETUP_ENV="$INSTALL_DIR/.env" GSTD_SETUP_TOKEN_FILE="$CONFIG_DIR/setup-token" node <<'NODESETUP'
const fs=require('node:fs'),crypto=require('node:crypto');
const envFile=process.env.GSTD_SETUP_ENV,tokenFile=process.env.GSTD_SETUP_TOKEN_FILE;
let env=fs.readFileSync(envFile,'utf8');
const token=fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():crypto.randomBytes(32).toString('hex');
if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid existing setup-token file; review it manually.');
env=env.replace(/^GSTD_DASHBOARD_SETUP_TOKEN=.*$/m,'GSTD_DASHBOARD_SETUP_TOKEN='+token);
if(!/^GSTD_DASHBOARD_SETUP_TOKEN=/m.test(env))env+='\nGSTD_DASHBOARD_SETUP_TOKEN='+token+'\n';
if(!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,token+'\n',{mode:0o600,flag:'wx'});
fs.chmodSync(tokenFile,0o600);
fs.writeFileSync(envFile,env,{mode:0o600});fs.chmodSync(envFile,0o600);
NODESETUP
    info "Initial setup token saved locally: $CONFIG_DIR/setup-token (keep it private)"
    info ".env configured"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 6: Register with GSTD Swarm (non-blocking)
# ═══════════════════════════════════════════════════════════════
step 6 "Registering with GSTD Swarm..."

info "Registration is performed by the running node with its persistent Ed25519 identity."
# IPFS storage and bridge daemons are not installed by the compute profile.

# Set up Cloudflare Tunnel binary for public node access.
if [ -f "$INSTALL_DIR/tunnel.sh" ] && [ ! -x "$INSTALL_DIR/tunnel.sh" ]; then
    chmod +x "$INSTALL_DIR/tunnel.sh"
fi
if [ ! -f "$INSTALL_DIR/cloudflared" ]; then
    ARCH=$(uname -m)
    CF_ARCH="amd64"; case "$ARCH" in aarch64|arm64) CF_ARCH="arm64";; esac
    CF_OS="linux"; [ "$(uname -s)" = "Darwin" ] && CF_OS="darwin"
    info "Downloading cloudflared ($CF_ARCH)..."
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_OS}-${CF_ARCH}" \
        -o "$INSTALL_DIR/cloudflared" && chmod +x "$INSTALL_DIR/cloudflared" \
        && info "cloudflared installed" \
        || warn "cloudflared download failed — tunnel may not work"
fi

# Use ecosystem.config.js if available (includes ipfs + tunnel + gstdbot)
if [ -f "$INSTALL_DIR/ecosystem.config.js" ] && command -v pm2 &>/dev/null; then
    info "Using pm2 ecosystem (ipfs + tunnel + gstdbot)"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 7: Install Ollama + pull starter model (AI inference engine)
# ═══════════════════════════════════════════════════════════════
step 7 "Setting up AI inference engine (Ollama)..."

INSTALLED_MODEL=""

install_ollama() {
    if command -v ollama &>/dev/null; then
        info "Ollama already installed ($(ollama --version 2>/dev/null | head -1))"
        return 0
    fi
    info "Installing Ollama..."
    if curl -fsSL https://ollama.com/install.sh | sh >/dev/null 2>&1; then
        info "Ollama installed ✓"
    else
        warn "Ollama install failed — install manually: https://ollama.com"
        return 1
    fi
}

pick_model() {
    # Choose the best model that fits in RAM with headroom for the OS
    local ram=$1
    if   [ "$ram" -ge 32000 ]; then echo "qwen3.5:9b"
    elif [ "$ram" -ge 16000 ]; then echo "qwen3.5:4b"
    elif [ "$ram" -ge  8000 ]; then echo "qwen3.5:2b"
    elif [ "$ram" -ge  4000 ]; then echo "qwen3.5:0.8b"
    elif [ "$ram" -ge  2000 ]; then echo "qwen2.5:0.5b"
    else echo ""
    fi
}

if install_ollama; then
    # Start Ollama daemon if not running
    if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
        nohup ollama serve >/dev/null 2>&1 &
        sleep 3
    fi

    if [ "$STARTER_MODEL" = none ]; then CHOSEN_MODEL=""
    elif [ "$STARTER_MODEL" = auto ]; then CHOSEN_MODEL=$(pick_model "${TOTAL_RAM_MB:-0}")
    elif [[ "$STARTER_MODEL" =~ ^[a-zA-Z0-9._/-]+:[a-zA-Z0-9._-]+$ ]] && [[ "$STARTER_MODEL" != *cloud* ]]; then CHOSEN_MODEL="$STARTER_MODEL"
    else err "Invalid local starter model name"; exit 2
    fi
    if [ -n "$CHOSEN_MODEL" ]; then
        # Check if already pulled
        if ollama list 2>/dev/null | grep -q "^${CHOSEN_MODEL}"; then
            info "Model ${CHOSEN_MODEL} already installed ✓"
            INSTALLED_MODEL="$CHOSEN_MODEL"
        else
            info "Pulling ${CHOSEN_MODEL} (conservative starter choice for ${TOTAL_RAM_MB}MB RAM)..."
            if ollama pull "$CHOSEN_MODEL" 2>&1 | tail -3; then
                info "Model ${CHOSEN_MODEL} ready ✓"
                INSTALLED_MODEL="$CHOSEN_MODEL"
            else
                warn "Model pull failed — pull manually: ollama pull ${CHOSEN_MODEL}"
            fi
        fi
    else
        warn "No starter model selected. Choose a compatible model in the dashboard."
    fi
fi

# ═══════════════════════════════════════════════════════════════
# STEP 8: Start Node (systemd or background)
# ═══════════════════════════════════════════════════════════════
step 8 "Starting GSTD Node OS..."

# Kill any existing process
# Existing managed process is restarted below by its own systemd/PM2 service.
# Never kill unrelated nodes or bridge processes by a broad command pattern.

# Bridge Validator — deployed separately (TON mainnet Phase 1.b)
info "Bridge Validator: available after TON mainnet deployment"

# Try systemd first (Linux only): system unit with root/sudo, otherwise a per-user unit (no root needed)
USED_SYSTEMD=false
SYSTEMD_MODE=""
if command -v systemctl &>/dev/null && [ -d /run/systemd/system ]; then
    if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
        SYSTEMD_MODE="system"
    elif systemctl --user show-environment &>/dev/null; then
        SYSTEMD_MODE="user"
    fi
fi
if [ "$(id -u)" = "0" ]; then
    warn "Running as root: the node service will run as root. Re-run as a normal user for a safer setup."
fi

if [ -n "$SYSTEMD_MODE" ]; then
    UNIT_TMP="$(mktemp)"
    {
        echo "[Unit]"
        echo "Description=GSTD Node OS - Sovereign AI Platform"
        echo "After=network-online.target"
        echo "Wants=network-online.target"
        echo ""
        echo "[Service]"
        echo "Type=simple"
        [ "$SYSTEMD_MODE" = "system" ] && echo "User=$(whoami)"
        echo "WorkingDirectory=${INSTALL_DIR}"
        echo "ExecStart=$(command -v node) ${INSTALL_DIR}/dist/index.js"
        echo "Restart=always"
        echo "RestartSec=5"
        echo "TimeoutStopSec=20"
        echo "Environment=NODE_NAME=${NODE_NAME}"
        echo "Environment=GSTD_DASHBOARD_PORT=${DASH_PORT}"
        echo "Environment=GSTD_NODE_ID=${NODE_ID}"
        echo "Environment=OLLAMA_NO_CLOUD=1"
        echo "# Keep a Raspberry Pi / small VPS responsive"
        echo "MemoryMax=768M"
        echo "CPUQuota=80%"
        echo "Nice=10"
        if [ "$SYSTEMD_MODE" = "system" ]; then
            echo "NoNewPrivileges=true"
            echo "PrivateTmp=true"
            echo "ProtectSystem=full"
        fi
        echo ""
        echo "[Install]"
        if [ "$SYSTEMD_MODE" = "system" ]; then echo "WantedBy=multi-user.target"; else echo "WantedBy=default.target"; fi
    } > "$UNIT_TMP"

    if [ "$SYSTEMD_MODE" = "system" ]; then
        sudo install -m 644 "$UNIT_TMP" /etc/systemd/system/gstd-node.service 2>/dev/null && {
            sudo systemctl daemon-reload 2>/dev/null
            sudo systemctl enable gstd-node 2>/dev/null
            sudo systemctl restart gstd-node 2>/dev/null
        }
        sleep 3
        sudo systemctl is-active --quiet gstd-node 2>/dev/null && USED_SYSTEMD=true

    else
        mkdir -p "$HOME/.config/systemd/user"
        install -m 644 "$UNIT_TMP" "$HOME/.config/systemd/user/gstd-node.service"
        systemctl --user daemon-reload 2>/dev/null
        systemctl --user enable gstd-node 2>/dev/null
        systemctl --user restart gstd-node 2>/dev/null
        # Without linger the user service would stop at logout and not start at boot
        loginctl enable-linger "$(whoami)" 2>/dev/null || warn "Could not enable linger: run 'sudo loginctl enable-linger $(whoami)' to start the node at boot"
        sleep 3
        systemctl --user is-active --quiet gstd-node 2>/dev/null && USED_SYSTEMD=true
    fi
    rm -f "$UNIT_TMP"
    if [ "$USED_SYSTEMD" = true ]; then
        info "Running as systemd ${SYSTEMD_MODE} service (auto-restart, auto-start on boot)"
    fi
fi
# Fallback: use PM2 for production process management (auto-restart, log rotation)
if [ "$USED_SYSTEMD" = false ]; then
    # Install PM2 if not present
    if ! command -v pm2 &>/dev/null; then
        info "Installing PM2 process manager..."
        mkdir -p "$HOME/.local"
        npm install --global --prefix "$HOME/.local" pm2 2>/dev/null || warn "Could not install PM2; trying the unmanaged fallback"
        export PATH="$HOME/.local/bin:$PATH"
    fi

    if command -v pm2 &>/dev/null; then
        cd "$INSTALL_DIR"
        # Stop only gstdbot (leave ipfs/tunnel/ollama running — they have long uptime)
        pm2 delete gstdbot 2>/dev/null || true
        pm2 delete gstd-node 2>/dev/null || true

        # Start gstdbot from ecosystem.config.js (other apps already running — pm2 skips them)
        if [ -f "$INSTALL_DIR/ecosystem.config.js" ]; then
            pm2 start "$INSTALL_DIR/ecosystem.config.js" --only gstdbot 2>/dev/null || \
            NODE_NAME="${NODE_NAME}" GSTD_DASHBOARD_PORT="$DASH_PORT" GSTD_NODE_ID="$NODE_ID" \
                pm2 start dist/index.js --name gstdbot \
                --max-memory-restart 768M \
                --log "$CONFIG_DIR/logs/node.log" \
                --time --merge-logs
        else
            NODE_NAME="${NODE_NAME}" GSTD_DASHBOARD_PORT="$DASH_PORT" GSTD_NODE_ID="$NODE_ID" \
                pm2 start dist/index.js --name gstdbot \
                --max-memory-restart 768M \
                --log "$CONFIG_DIR/logs/node.log" \
                --time --merge-logs
        fi

        # Save PM2 process list for auto-start on reboot
        pm2 save 2>/dev/null

        # Setup PM2 startup script (auto-start on system boot)
        pm2 startup 2>/dev/null || true

        # Enable log rotation (10MB max, keep 5 files)
        pm2 install pm2-logrotate 2>/dev/null
        pm2 set pm2-logrotate:max_size 10M 2>/dev/null
        pm2 set pm2-logrotate:retain 5 2>/dev/null

        sleep 3
        if pm2 pid gstdbot >/dev/null 2>&1 || pm2 pid gstd-node >/dev/null 2>&1; then
            info "Running via PM2 (auto-restart, log rotation, memory guard)"
        else
            warn "PM2 start failed. Check: pm2 logs gstdbot"
        fi
        cd - >/dev/null
    else
        # Ultimate fallback: nohup (no auto-restart)
        cd "$INSTALL_DIR"
        NODE_NAME="${NODE_NAME}" GSTD_DASHBOARD_PORT="$DASH_PORT" GSTD_NODE_ID="$NODE_ID" \
            nohup node dist/index.js >> "$CONFIG_DIR/node.log" 2>&1 &
        NODE_PID=$!
        echo "$NODE_PID" > "$CONFIG_DIR/node.pid"

        sleep 3
        if kill -0 "$NODE_PID" 2>/dev/null; then
            info "Running in background (PID: $NODE_PID) — install PM2 for auto-restart"
        else
            warn "Process exited. Check: tail -f $CONFIG_DIR/node.log"
        fi
        cd - >/dev/null
    fi
fi

# ─── Create gstd-node CLI tool ──────────────────────────────────
CLI_PATH="/usr/local/bin/gstd-node"
if ! touch "$CLI_PATH" 2>/dev/null; then
    mkdir -p "$HOME/.local/bin"
    CLI_PATH="$HOME/.local/bin/gstd-node"
    export PATH="$HOME/.local/bin:$PATH"
fi

cat > "$CLI_PATH" << CLISCRIPT
#!/usr/bin/env bash
INSTALL_DIR="$INSTALL_DIR"
export PATH="\$HOME/.local/bin:\$PATH"
SYS_CMD="sudo systemctl"; JOURNAL="sudo journalctl -u gstd-node -f"
if [ "\$(id -u)" = "0" ]; then SYS_CMD="systemctl"; JOURNAL="journalctl -u gstd-node -f"; fi
if [ "\$(id -u)" != "0" ] && ! sudo -n true 2>/dev/null; then SYS_CMD="systemctl --user"; JOURNAL="journalctl --user -u gstd-node -f"; fi

case "\$1" in
    update)
        echo "Updating GSTD Node..."
        curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | GSTD_INSTALL_DIR="\$INSTALL_DIR" GSTD_PORT="${DASH_PORT}" bash
        ;;
    rollback)
        echo "Rolling back to previous version..."
        cd "\$INSTALL_DIR"
        git checkout HEAD@{1} 2>/dev/null || git checkout HEAD^ 2>/dev/null || { echo "Cannot rollback further."; exit 1; }
        npm ci --include=dev --quiet || exit 1
        node_modules/.bin/tsc || exit 1
        pm2 restart gstdbot 2>/dev/null || \$SYS_CMD restart gstd-node 2>/dev/null
        echo "Rollback complete."
        ;;
    restart)
        if \$SYS_CMD restart gstd-node 2>/dev/null; then exit 0; fi
        if command -v pm2 >/dev/null && pm2 restart gstdbot 2>/dev/null; then exit 0; fi
        echo "No managed node service found. Start the node with its original process manager." >&2
        exit 1
        ;;
    status) if command -v pm2 >/dev/null && pm2 describe gstdbot >/dev/null 2>&1; then pm2 status gstdbot; else \$SYS_CMD status gstd-node; fi ;;
    logs) if command -v pm2 >/dev/null && pm2 describe gstdbot >/dev/null 2>&1; then pm2 logs gstdbot; else \$JOURNAL 2>/dev/null || tail -f "\$HOME/.config/gstdbot/node.log"; fi ;;
    *)
        echo "GSTD Node CLI (v${VERSION})"
        echo "Usage: gstd-node {update|rollback|restart|status|logs}"
        ;;
esac
CLISCRIPT
chmod +x "$CLI_PATH"
info "CLI tool installed: type 'gstd-node' to manage your node"


# ─── Wait for dashboard ─────────────────────────────────────────
READY=false
for i in $(seq 1 10); do
    if curl -fsS -o /dev/null -w '' "http://localhost:${DASH_PORT}/health" 2>/dev/null; then
        READY=true
        break
    fi
    sleep 1
done

# Prepare the narrowly scoped HTTPS controller during the privileged installer,
# not from an HTTP request. Issuance/public exposure still require panel consent.
# Optional capability: never prompt for credentials or block a working node.
if [ "$(uname -s)" = Linux ] && [ "$(id -u)" -gt 0 ] \
    && [ -d /run/systemd/system ] && command -v apt-get >/dev/null 2>&1 \
    && [ ! -e /.dockerenv ] && [ ! -e /run/.containerenv ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        if [[ "$DASH_PORT" =~ ^[0-9]{4,5}$ ]] && [ "$DASH_PORT" -ge 1024 ] \
            && [ "$DASH_PORT" -le 65535 ] && [ "$DASH_PORT" -ne 2019 ] \
            && [ -f "$INSTALL_DIR/scripts/setup-node-https.sh" ]; then
            info "Preparing HTTPS controls for the dashboard (no certificate or public listener yet)..."
            if timeout 300 sudo -n bash "$INSTALL_DIR/scripts/setup-node-https.sh" \
                --user "$(id -un)" --port "$DASH_PORT" >>"$LOG_FILE" 2>&1; then
                info "HTTPS controls ready — choose a domain and configure HTTPS in the dashboard"
            else
                warn "Optional HTTPS controls could not be prepared; the node remains available. Check HTTPS status in the dashboard."
            fi
        else
            warn "HTTPS controls were not prepared: the configured gateway port or helper source is unsupported."
        fi
    else
        info "HTTPS system controls need installation-level administrator access; existing HTTPS tunnels and outbound work remain available."
    fi
else
    info "Automatic HTTPS system controls are unavailable for this installation profile; existing HTTPS tunnels and outbound work remain available."
fi

# ═══════════════════════════════════════════════════════════════
# DONE — Summary
# ═══════════════════════════════════════════════════════════════
echo ""
if [ "$READY" = true ]; then
    echo -e "${GREEN}  ╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║   🐝 GSTD Node OS v${VERSION} — READY!              ║${NC}"
    echo -e "${GREEN}  ╚══════════════════════════════════════════════════╝${NC}"
else
    echo -e "${YELLOW}  ╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}  ║   🐝 GSTD Node OS v${VERSION} — Starting...          ║${NC}"
    echo -e "${YELLOW}  ╚══════════════════════════════════════════════════╝${NC}"
fi

echo ""
echo -e "  ${BOLD}👉 Open your node dashboard:${NC}"

# Try to find the Cloudflare tunnel URL from pm2 logs
TUNNEL_URL=""
if command -v pm2 &>/dev/null && pm2 describe tunnel >/dev/null 2>&1; then
    TUNNEL_URL=$(pm2 logs tunnel --lines 100 --nostream 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
fi

# Local LAN IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)

echo -e "     ${CYAN}http://localhost:${DASH_PORT}${NC}  (same machine)"
if [ -n "$LOCAL_IP" ]; then
    echo -e "     ${CYAN}http://${LOCAL_IP}:${DASH_PORT}${NC}  (local network)"
fi
if [ -n "$TUNNEL_URL" ]; then
    echo -e "     ${GREEN}${TUNNEL_URL}${NC}  (anywhere, public)"
fi
echo ""
echo -e "  ${BOLD}Your node info:${NC}"
echo -e "    Mode:       ${MODE}"
echo -e "    Node ID:    ${DIM}${NODE_ID:0:16}...${NC}"
echo -e "    Install:    ${INSTALL_DIR}"
if [ -n "$INSTALLED_MODEL" ]; then
    echo -e "    AI Model:   ${GREEN}${INSTALLED_MODEL}${NC} (ready to serve requests)"
else
    echo -e "    AI Model:   ${YELLOW}none${NC} — open dashboard → Models to install"
fi
echo ""

if [ "$USED_SYSTEMD" = true ]; then
    if [ "$SYSTEMD_MODE" = "user" ]; then SC="systemctl --user"; JC="journalctl --user"; else SC="sudo systemctl"; JC="sudo journalctl"; fi
    echo -e "  ${BOLD}Useful commands:${NC}"
    echo -e "    ${GREEN}status${NC}   $SC status gstd-node"
    echo -e "    ${GREEN}restart${NC}  $SC restart gstd-node"
    echo -e "    ${GREEN}logs${NC}     $JC -u gstd-node -f"
    echo -e "    ${GREEN}stop${NC}     $SC stop gstd-node"
else
    echo -e "  ${BOLD}Useful commands:${NC}"
    echo -e "    ${GREEN}restart${NC}  pm2 restart gstdbot"
    echo -e "    ${GREEN}logs${NC}     pm2 logs gstdbot"
    echo -e "    ${GREEN}stop${NC}     pm2 stop gstdbot"
fi

echo ""
echo -e "  ${BOLD}CLI tool (type anywhere):${NC}"
echo -e "    ${CYAN}gstd-node update${NC}   — Update to the newest version"
echo -e "    ${CYAN}gstd-node logs${NC}     — View live console output"
echo -e "    ${CYAN}gstd-node status${NC}   — Check node health"
echo -e "    ${CYAN}gstd-node rollback${NC} — Revert a broken update"

echo ""
echo -e "  ${BOLD}What your node does:${NC}"
echo -e "    🤖 ${GREEN}AI Inference${NC} — Local-first AI; network routing requires your permission"
echo -e "    💰 ${GREEN}Earn GSTD${NC}    — 85% of accepted, funded work; 10% protocol, 5% reserve"
echo -e "    📊 ${GREEN}Dashboard${NC}    — Monitor everything from your browser"
echo -e "    🛡️ ${GREEN}Security${NC}     — Rate limiting, hardened defaults"
echo ""
echo -e "  ${BOLD}First login — set your dashboard PIN in the browser${NC}"
echo -e "    ${DIM}Forgot PIN? Run:${NC} rm ~/.config/gstdbot/dashboard_pin.hash && pm2 restart gstdbot"
echo ""
echo -e "  ${BOLD}Re-run anytime to update:${NC}"
echo -e "    ${CYAN}curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash${NC}"
echo -e "    ${DIM}Safe to re-run — updates and restarts automatically${NC}"
echo ""
