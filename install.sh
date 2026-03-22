#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node OS — One-Command Installer v3.3
# curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
#
# ✅ Fully automatic — no interactive prompts
# ✅ Idempotent — safe to re-run anytime
# ✅ Resumes after interruption
# ✅ Auto-updates if already installed
# ✅ Registers as systemd service (auto-start on boot)
# ✅ Works: Linux, macOS, WSL, ARM/RPi
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="3.4.0"
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
            echo "Usage: curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash"
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
            echo "  GROQ_API_KEY=your-key"
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
  ║   🐝 GSTD Node OS — Sovereign AI Platform       ║
  ║      v3.3 • 27 Apps • Collective Intelligence    ║
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
npm install --legacy-peer-deps 2>>"$LOG_FILE" || npm install 2>>"$LOG_FILE" || {
    warn "npm install failed, cleaning cache..."
    rm -rf node_modules package-lock.json
    npm install --legacy-peer-deps 2>>"$LOG_FILE"
}
info "Dependencies ✓"

# Always rebuild TypeScript (fast if nothing changed)
npx tsc 2>>"$LOG_FILE" || npx tsc --skipLibCheck 2>>"$LOG_FILE" || {
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
  "groq": {
    "models": ["llama-3.3-70b-versatile","llama-3.1-8b-instant","meta-llama/llama-4-scout-17b-16e-instruct","meta-llama/llama-4-maverick-17b-128e-instruct","qwen/qwen3-32b","openai/gpt-oss-120b","openai/gpt-oss-20b","moonshotai/kimi-k2-instruct"]
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
    # Inject GROQ key if available
    if [ -n "${GROQ_API_KEY:-}" ]; then
        sed -i "s|^GROQ_API_KEY=.*|GROQ_API_KEY=${GROQ_API_KEY}|" "$INSTALL_DIR/.env"
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
# STEP 7: Start Node (systemd or background)
# ═══════════════════════════════════════════════════════════════
step 7 "Starting GSTD Node OS..."

# Kill any existing process
pkill -f "node.*gstdbot.*dist/index.js" 2>/dev/null || true
pkill -f "gstd-bridge" 2>/dev/null || true
sleep 1

# Download Bridge Node
mkdir -p "$CONFIG_DIR/bridge"
info "Downloading Bridge Validator..."
(curl -fsSL https://app.gstdtoken.com/downloads/gstd-bridge.gz | gzip -d > "$CONFIG_DIR/bridge/gstd-bridge" && chmod +x "$CONFIG_DIR/bridge/gstd-bridge") || true
if [ ! -f "$CONFIG_DIR/bridge/bridge.toml" ]; then
    "$CONFIG_DIR/bridge/gstd-bridge" --init --config "$CONFIG_DIR/bridge/bridge.toml" 2>/dev/null || true
fi

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
${GROQ_API_KEY:+Environment=GROQ_API_KEY=${GROQ_API_KEY}}

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
        # Stop old instances if running
        pm2 delete gstd-node 2>/dev/null
        pm2 delete gstd-bridge 2>/dev/null

        # Start node with PM2 (auto-restart on crash, memory limit 512MB)
        NODE_NAME="${NODE_NAME}" GSTD_DASHBOARD_PORT="$DASH_PORT" GSTD_NODE_ID="$NODE_ID" \
            pm2 start dist/index.js --name gstd-node \
            --max-memory-restart 512M \
            --log "$CONFIG_DIR/node.log" \
            --time \
            --merge-logs

        # Start Bridge with PM2
        if [ -f "$CONFIG_DIR/bridge/gstd-bridge" ]; then
            pm2 start "$CONFIG_DIR/bridge/gstd-bridge" --name gstd-bridge \
                --log "$CONFIG_DIR/bridge/bridge.log" \
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
        if pm2 pid gstd-node >/dev/null 2>&1; then
            info "Running via PM2 (auto-restart, log rotation, memory guard)"
        else
            warn "PM2 start failed. Check: pm2 logs gstd-node"
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
        curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
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
echo -e "  ${BOLD}👉 Next step — open your browser:${NC}"
echo -e "     ${CYAN}http://localhost:${DASH_PORT}${NC}"
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
    echo -e "    ${GREEN}restart${NC}  cd $INSTALL_DIR && node dist/index.js"
    echo -e "    ${GREEN}logs${NC}     tail -f $CONFIG_DIR/node.log"
    echo -e "    ${GREEN}stop${NC}     kill \$(cat $CONFIG_DIR/node.pid)"
fi

echo ""
echo -e "  ${BOLD}💥 NEW! Simple CLI Tool (Type anywhere):${NC}"
echo -e "    ${CYAN}gstd-node rollback${NC} — Instantly revert a broken update"
echo -e "    ${CYAN}gstd-node update${NC}   — Update to the newest version"
echo -e "    ${CYAN}gstd-node logs${NC}     — View live console output"
echo -e "    ${CYAN}gstd-node status${NC}   — Check node health"

echo ""
echo -e "  ${BOLD}What your node does:${NC}"
echo -e "    🤖 ${GREEN}AI Chat${NC}     — Chat with 8 free AI models"
echo -e "    💰 ${GREEN}Earn GSTD${NC}   — Automatic earnings while running"
echo -e "    🧠 ${GREEN}Memory${NC}      — Learns from the global network"
echo -e "    📊 ${GREEN}Dashboard${NC}   — Monitor everything from your browser"
echo -e "    📦 ${GREEN}52 Apps${NC}     — Full autonomous PC in your node"
echo -e "    🛡️ ${GREEN}Security${NC}    — Rate limiting, hardened defaults"
echo ""
echo -e "  ${BOLD}Re-run anytime to update:${NC}"
echo -e "    ${CYAN}curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash${NC}"
echo -e "    ${DIM}Safe to re-run — updates and restarts automatically${NC}"
echo ""

