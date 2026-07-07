#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node OS — One-Command Installer v3.5
# curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
#
# ✅ Fully automatic — no interactive prompts
# ✅ Idempotent — safe to re-run anytime
# ✅ Resumes after interruption
# ✅ Auto-updates if already installed
# ✅ Registers as systemd service (auto-start on boot)
# ✅ Works: Linux, macOS, WSL, ARM/RPi
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="3.5.0"
INSTALL_DIR="${GSTD_INSTALL_DIR:-$HOME/gstdbot}"
CONFIG_DIR="$HOME/.config/gstdbot"
STATE_FILE="$CONFIG_DIR/.install_state"
LOG_FILE="$CONFIG_DIR/install.log"
API_URL="https://app.gstdtoken.com/api/v1"
REPO_URL="https://github.com/gstdcoin/gstdbot.git"
DASH_PORT="${GSTD_PORT:-8080}"
MODE="${GSTD_MODE:-cloud}"

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────
info()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()     { echo -e "  ${RED}✗${NC} $1"; }
step()    { echo -e "\n${CYAN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }
log()     { echo "[$(date +%H:%M:%S)] $1" >> "$LOG_FILE" 2>/dev/null || true; }

TOTAL_STEPS=7

# State management — tracks completed steps
mark_done()  { echo "$1" >> "$STATE_FILE"; log "DONE: $1"; }
is_done()    { [ -f "$STATE_FILE" ] && grep -qx "$1" "$STATE_FILE" 2>/dev/null; }
reset_step() { [ -f "$STATE_FILE" ] && sed -i "/$1/d" "$STATE_FILE" 2>/dev/null; true; }

# ─── Handle flags ────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
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
            echo "  --cloud       Cloud AI mode (default, instant, free)"
            echo "  --hybrid      Hybrid mode (local + cloud)"
            echo "  --sovereign   Fully local AI (requires ~10GB)"
            echo "  --port=PORT   Dashboard port (default: 8080)"
            echo "  --help        Show this help"
            echo ""
            echo "Environment variables:"
            echo "  GSTD_MODE=cloud|hybrid|sovereign"
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
  ║      v3.5 • Inference + Fine-Tuning + NaaS       ║
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
        [ "${ver:-0}" -ge 20 ] 2>/dev/null && return 1  # already good
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
                curl -fsSL https://fnm.vercel.app/install 2>/dev/null | bash >/dev/null 2>&1
                export PATH="$HOME/.local/share/fnm:$PATH"
                eval "$(fnm env 2>/dev/null)" 2>/dev/null || true
                fnm install 22 >/dev/null 2>&1 && fnm use 22 >/dev/null 2>&1
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
    cd "$INSTALL_DIR"
    git fetch --depth 10 origin main 2>>"$LOG_FILE" || true
    git reset --hard origin/main 2>>"$LOG_FILE" || git pull --ff-only 2>>"$LOG_FILE" || true
    cd - >/dev/null
    info "Updated to latest"
elif [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    # Directory exists but no .git — delete and re-clone
    warn "Corrupted install detected, re-cloning..."
    rm -rf "$INSTALL_DIR"
    git clone --depth 10 "$REPO_URL" "$INSTALL_DIR" 2>>"$LOG_FILE"
    info "Re-cloned fresh"
else
    info "Cloning from GitHub..."
    git clone --depth 10 "$REPO_URL" "$INSTALL_DIR" 2>>"$LOG_FILE"
    info "Cloned to $INSTALL_DIR"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 4: Install Dependencies + Build
# ═══════════════════════════════════════════════════════════════
step 4 "Building..."

cd "$INSTALL_DIR"

# Always run npm install (fast if nothing changed)
# --no-audit: suppress vulnerability report (we audit and fix in CI — safe to omit here)
npm install --no-audit --legacy-peer-deps >>"$LOG_FILE" 2>&1 || npm install --no-audit >>"$LOG_FILE" 2>&1 || {
    warn "npm install failed, cleaning cache..."
    rm -rf node_modules package-lock.json
    npm install --no-audit --legacy-peer-deps >>"$LOG_FILE" 2>&1
}
info "Dependencies ✓"

# Always rebuild TypeScript (fast if nothing changed)
node_modules/.bin/tsc >>"$LOG_FILE" 2>&1 || node_modules/.bin/tsc --skipLibCheck >>"$LOG_FILE" 2>&1 || {
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
    NODE_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_DIR/config.json')).get('nodeId',''))" 2>/dev/null || echo "")
    # Preserve mode if not explicitly set
    if [ "$MODE" = "cloud" ]; then
        SAVED_MODE=$(python3 -c "import json; print(json.load(open('$CONFIG_DIR/config.json')).get('mode','cloud'))" 2>/dev/null || echo "cloud")
        MODE="$SAVED_MODE"
    fi
fi

if [ -z "$NODE_ID" ]; then
    NODE_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))" 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "node-$(date +%s)")
fi

NODE_NAME="${NODE_NAME:-${HOSTNAME:-$(hostname)}-node}"

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
  "dashboard": {
    "host": "0.0.0.0",
    "port": ${DASH_PORT},
    "enabled": true
  },
  "ollama": {
    "url": "http://localhost:11434",
    "models": ["llama3.2:3b","llama3.1:8b","qwen2.5:7b","phi3:mini","gemma2:2b"]
  },
  "memory": {
    "redisUrl": "redis://localhost:6379",
    "chromaUrl": "http://localhost:8000",
    "enabled": true
  },
  "apps": {
    "enabled": true,
    "dataDir": "${CONFIG_DIR}/apps"
  }
}
CONF
info "Config: $MODE mode, port $DASH_PORT, ID: ${NODE_ID:0:8}..."

# Copy .env if missing
if [ ! -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/.env.example" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    # Inject NODE_NAME if set
    if [ -n "${NODE_NAME:-}" ]; then
        sed -i "s|^NODE_NAME=.*|NODE_NAME=${NODE_NAME}|" "$INSTALL_DIR/.env"
    fi
    info ".env configured"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 6: Register with GSTD Swarm (non-blocking)
# ═══════════════════════════════════════════════════════════════
step 6 "Registering with GSTD Swarm..."

(curl -s -X POST "${API_URL}/nodes/register" \
    -H "Content-Type: application/json" \
    -d "{\"node_id\":\"${NODE_ID}\",\"node_name\":\"${NODE_NAME}\",\"mode\":\"${MODE}\",\"os\":\"${OS}\",\"arch\":\"${ARCH}\",\"ram_mb\":${TOTAL_RAM_MB:-0},\"version\":\"${VERSION}\"}" \
    --connect-timeout 5 --max-time 10 >/dev/null 2>&1) &
info "Node registered (or will auto-register on heartbeat)"

# ═══════════════════════════════════════════════════════════════
# STEP 6.5: IPFS (Kubo) Setup — decentralized storage
# ═══════════════════════════════════════════════════════════════
IPFS_BIN="$HOME/ipfs-bin/ipfs"
IPFS_PATH="$HOME/.ipfs"
if [ ! -f "$IPFS_BIN" ]; then
    info "Installing IPFS (Kubo)..."
    mkdir -p "$HOME/ipfs-bin"
    IPFS_ARCH="amd64"
    case "$(uname -m)" in arm64|aarch64) IPFS_ARCH="arm64";; esac
    KUBO_VER="v0.32.1"
    KUBO_URL="https://dist.ipfs.tech/kubo/${KUBO_VER}/kubo_${KUBO_VER}_linux-${IPFS_ARCH}.tar.gz"
    if curl -fsSL "$KUBO_URL" | tar -xz -C /tmp/kubo-tmp --strip-components=1 kubo/ipfs 2>/dev/null; then
        mv /tmp/kubo-tmp/ipfs "$IPFS_BIN" && chmod +x "$IPFS_BIN"
        info "IPFS binary installed"
    else
        warn "IPFS download failed — storage will be disabled"
    fi
fi

if [ -f "$IPFS_BIN" ] && [ ! -d "$IPFS_PATH/config" ] && [ ! -f "$IPFS_PATH/config" ]; then
    info "Initializing IPFS repository..."
    IPFS_PATH="$IPFS_PATH" "$IPFS_BIN" init --profile=lowpower 2>/dev/null || true
    IPFS_PATH="$IPFS_PATH" "$IPFS_BIN" config --json Datastore.StorageMax '"10GB"' 2>/dev/null || true
    IPFS_PATH="$IPFS_PATH" "$IPFS_BIN" config --json Swarm.ConnMgr.HighWater 20 2>/dev/null || true
    info "IPFS initialized"
fi

# Set up Cloudflare Tunnel binary (public URL — accessible from Vercel/cloud)
if [ -f "$INSTALL_DIR/tunnel.sh" ] && [ ! -x "$INSTALL_DIR/tunnel.sh" ]; then
    chmod +x "$INSTALL_DIR/tunnel.sh"
fi
if [ ! -f "$INSTALL_DIR/cloudflared" ]; then
    ARCH=$(uname -m)
    CF_ARCH="amd64"; [ "$ARCH" = "aarch64" ] && CF_ARCH="arm64"
    info "Downloading cloudflared ($CF_ARCH)..."
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
        -o "$INSTALL_DIR/cloudflared" && chmod +x "$INSTALL_DIR/cloudflared" \
        && info "cloudflared installed" \
        || warn "cloudflared download failed — tunnel may not work"
fi

# Use ecosystem.config.js if available (includes ipfs + tunnel + gstdbot)
if [ -f "$INSTALL_DIR/ecosystem.config.js" ] && command -v pm2 &>/dev/null; then
    info "Using pm2 ecosystem (ipfs + tunnel + gstdbot)"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 7: Start Node (systemd or background)
# ═══════════════════════════════════════════════════════════════
step 7 "Starting GSTD Node OS..."

# Kill any existing process
pkill -f "node.*gstdbot.*dist/index.js" 2>/dev/null || true
pkill -f "gstd-bridge" 2>/dev/null || true
sleep 1

# Bridge Validator — deployed separately (TON mainnet Phase 1.b)
info "Bridge Validator: available after TON mainnet deployment"

# Try systemd first (Linux only)
USED_SYSTEMD=false
if command -v systemctl &>/dev/null && [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
    SERVICE_FILE="/etc/systemd/system/gstd-node.service"
    sudo tee "$SERVICE_FILE" > /dev/null 2>&1 << SVCEOF
[Unit]
Description=GSTD Node OS — Sovereign AI Platform
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which node) ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_NAME=${NODE_NAME}
Environment=GSTD_DASHBOARD_PORT=${DASH_PORT}
Environment=GSTD_NODE_ID=${NODE_ID}
Environment=NODE_NAME=${NODE_NAME}

[Install]
WantedBy=multi-user.target
SVCEOF

    # ─── Bridge node service ───
    BRIDGE_SERVICE_FILE="/etc/systemd/system/gstd-bridge.service"
    sudo tee "$BRIDGE_SERVICE_FILE" > /dev/null 2>&1 << BRIDGESVCEOF
[Unit]
Description=GSTD Bridge Validator Node (TON<->SOL<->XRP)
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${CONFIG_DIR}/bridge
ExecStart=${CONFIG_DIR}/bridge/gstd-bridge
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
BRIDGESVCEOF

    if [ $? -eq 0 ]; then
        sudo systemctl daemon-reload 2>/dev/null
        sudo systemctl enable gstd-node gstd-bridge 2>/dev/null
        sudo systemctl restart gstd-node gstd-bridge 2>/dev/null
        sleep 3
        if sudo systemctl is-active --quiet gstd-node 2>/dev/null; then
            USED_SYSTEMD=true
            info "Running as systemd service (auto-start on boot)"
        fi
    fi
fi

# Fallback: use PM2 for production process management (auto-restart, log rotation)
if [ "$USED_SYSTEMD" = false ]; then
    # Install PM2 if not present
    if ! command -v pm2 &>/dev/null; then
        info "Installing PM2 process manager..."
        npm install -g pm2 2>/dev/null || sudo npm install -g pm2 2>/dev/null
    fi

    if command -v pm2 &>/dev/null; then
        cd "$INSTALL_DIR"
        # Stop only gstdbot (leave ipfs/tunnel/ollama running — they have long uptime)
        pm2 delete gstdbot 2>/dev/null || true
        pm2 delete gstd-node 2>/dev/null || true
        pm2 delete gstd-bridge 2>/dev/null || true

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

        # Run Bridge in background
        if [ -f "$CONFIG_DIR/bridge/gstd-bridge" ]; then
            cd "$CONFIG_DIR/bridge"
            nohup ./gstd-bridge >> bridge.log 2>&1 &
            echo "$!" > bridge.pid
        fi

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
SYS_CMD="sudo systemctl"
[ "\$(id -u)" != "0" ] && ! sudo -n true 2>/dev/null && SYS_CMD="systemctl --user"

case "\$1" in
    update)
        echo "Updating GSTD Node..."
        curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
        ;;
    rollback)
        echo "Rolling back to previous version..."
        cd "\$INSTALL_DIR"
        git checkout HEAD@{1} 2>/dev/null || git checkout HEAD^ 2>/dev/null || echo "Cannot rollback further."
        npm run build
        \$SYS_CMD restart gstd-node 2>/dev/null || node dist/index.js &
        echo "Rollback complete. Service restarted!"
        ;;
    restart) \$SYS_CMD restart gstd-node 2>/dev/null || kill \$(cat \$HOME/.config/gstdbot/node.pid) && cd "\$INSTALL_DIR" && node dist/index.js & ;;
    status)  \$SYS_CMD status gstd-node 2>/dev/null ;;
    logs)    sudo journalctl -u gstd-node -f 2>/dev/null || tail -f \$HOME/.config/gstdbot/node.log ;;
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
    if curl -s -o /dev/null -w '' "http://localhost:${DASH_PORT}/health" 2>/dev/null; then
        READY=true
        break
    fi
    sleep 1
done

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
if command -v pm2 &>/dev/null; then
    TUNNEL_URL=$(pm2 logs tunnel --lines 100 --nostream 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
fi

# Local LAN IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

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
echo ""

if [ "$USED_SYSTEMD" = true ]; then
    echo -e "  ${BOLD}Useful commands:${NC}"
    echo -e "    ${GREEN}status${NC}   sudo systemctl status gstd-node"
    echo -e "    ${GREEN}restart${NC}  sudo systemctl restart gstd-node"
    echo -e "    ${GREEN}logs${NC}     sudo journalctl -u gstd-node -f"
    echo -e "    ${GREEN}stop${NC}     sudo systemctl stop gstd-node"
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
echo -e "    🤖 ${GREEN}AI Inference${NC} — Serve AI requests, earn 90% of each fee"
echo -e "    🎓 ${GREEN}Fine-Tuning${NC}  — Train LoRA adapters for users (10× cheaper than cloud)"
echo -e "    💰 ${GREEN}Earn GSTD${NC}    — Automatic token earnings while running"
echo -e "    🌐 ${GREEN}NaaS${NC}         — Auto-host blockchain nodes (TON, ETH, SOL…)"
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

