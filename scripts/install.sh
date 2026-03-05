#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node — Idempotent Installer
# curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
#
# Features:
#  • Safe to re-run after crash/abort — picks up where it left off
#  • Detects already-installed components and skips them
#  • 3 modes: Cloud (instant), Hybrid, Sovereign
#  • Works on Linux (Debian/Ubuntu/Fedora/Arch), macOS, WSL, ARM/RPi
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="2.1.0"
CONFIG_DIR="$HOME/.config/gstdbot"
STATE_FILE="$CONFIG_DIR/.install_state"
LOG_FILE="$CONFIG_DIR/install.log"

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────
info()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()     { echo -e "  ${RED}✗${NC} $1"; }
step()    { echo -e "\n${CYAN}[$1/6]${NC} ${BOLD}$2${NC}"; }
log()     { echo "[$(date +%H:%M:%S)] $1" >> "$LOG_FILE"; }

# State management — tracks completed steps for idempotent re-runs
mark_done()  { echo "$1" >> "$STATE_FILE"; log "DONE: $1"; }
is_done()    { [ -f "$STATE_FILE" ] && grep -qx "$1" "$STATE_FILE" 2>/dev/null; }
reset_step() { [ -f "$STATE_FILE" ] && sed -i "/$1/d" "$STATE_FILE" 2>/dev/null; true; }

# Ensure config dir exists
mkdir -p "$CONFIG_DIR/skills"
echo "" >> "$LOG_FILE"
log "=== GSTD Node Installer v${VERSION} ==="

# ─── Banner ──────────────────────────────────────────────────────
echo -e "${CYAN}"
cat << 'BANNER'
╔══════════════════════════════════════════════╗
║   🐝 GSTD Node — Your Device is the         ║
║      Supercomputer                           ║
╚══════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ─── Check for previous partial install ──────────────────────────
if [ -f "$STATE_FILE" ]; then
    COMPLETED=$(wc -l < "$STATE_FILE" | tr -d ' ')
    if [ "$COMPLETED" -gt 0 ] 2>/dev/null; then
        echo -e "  ${YELLOW}↻ Resuming previous install ($COMPLETED steps done)${NC}"
        echo -e "  ${DIM}To start fresh: rm $STATE_FILE${NC}"
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

# Check minimum RAM (warn if < 2GB)
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}' || echo 0)
if [ "$TOTAL_RAM_MB" -lt 2048 ] 2>/dev/null && [ "$TOTAL_RAM_MB" -gt 0 ] 2>/dev/null; then
    warn "Low RAM (${TOTAL_RAM_MB}MB). Cloud mode recommended."
fi

# ═══════════════════════════════════════════════════════════════
# STEP 2: Install / Verify Node.js
# ═══════════════════════════════════════════════════════════════
step 2 "Setting up Node.js..."

install_nodejs() {
    log "Installing Node.js..."
    case $PKG in
        apt)
            # Check if nodesource is already set up
            if ! node -v 2>/dev/null | grep -q "v2[0-9]"; then
                curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - 2>/dev/null
                sudo apt-get install -y nodejs 2>/dev/null
            fi
            ;;
        dnf)
            curl -fsSL https://rpm.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - 2>/dev/null
            sudo dnf install -y nodejs 2>/dev/null
            ;;
        pacman)
            sudo pacman -S --noconfirm nodejs npm 2>/dev/null
            ;;
        apk)
            sudo apk add --no-cache nodejs npm 2>/dev/null
            ;;
        brew)
            brew install node@22 2>/dev/null || {
                curl -fsSL https://fnm.vercel.app/install | bash 2>/dev/null
                export PATH="$HOME/.local/share/fnm:$PATH"
                eval "$(fnm env 2>/dev/null)" 2>/dev/null
                fnm install 22 2>/dev/null && fnm use 22 2>/dev/null
            }
            ;;
        *)
            # Fallback: nvm
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
    # Verify Node.js still works
    if command -v node &>/dev/null; then
        NODE_VER=$(node -v 2>/dev/null)
        info "Node.js ${NODE_VER} (already installed)"
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
        # Reload PATH
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

# Verify npm
if ! command -v npm &>/dev/null; then
    err "npm not found. Please install Node.js manually: https://nodejs.org"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════
# STEP 3: Install / Verify GSTD Node
# ═══════════════════════════════════════════════════════════════
step 3 "Installing GSTD Node..."

install_gstdbot() {
    log "Installing gstdbot package..."

    # Method 1: npm global
    if npm install -g gstdbot@latest 2>>"$LOG_FILE"; then
        return 0
    fi
    warn "npm global install failed, trying with sudo..."

    # Method 2: npm global with sudo
    if sudo npm install -g gstdbot@latest 2>>"$LOG_FILE"; then
        return 0
    fi
    warn "sudo npm install failed, trying from source..."

    # Method 3: From source
    local TMPDIR
    TMPDIR=$(mktemp -d)
    if git clone --depth 1 https://github.com/gstdcoin/gstdbot.git "$TMPDIR/gstdbot" 2>>"$LOG_FILE"; then
        cd "$TMPDIR/gstdbot"
        npm install --legacy-peer-deps 2>>"$LOG_FILE"
        npm run build 2>>"$LOG_FILE"
        sudo npm link 2>>"$LOG_FILE" || npm link 2>>"$LOG_FILE"
        cd - >/dev/null
        rm -rf "$TMPDIR"
        return 0
    fi

    rm -rf "$TMPDIR"
    return 1
}

if is_done "gstdbot"; then
    if command -v gstdbot &>/dev/null; then
        GSTD_VER=$(gstdbot --version 2>/dev/null || echo "installed")
        info "GSTD Node ${GSTD_VER} (already installed)"
    else
        warn "gstdbot was marked done but not found — reinstalling"
        reset_step "gstdbot"
    fi
fi

if ! is_done "gstdbot"; then
    if command -v gstdbot &>/dev/null; then
        info "GSTD Node already installed, checking for updates..."
        npm update -g gstdbot 2>>"$LOG_FILE" && info "Updated" || info "Up to date"
    else
        if install_gstdbot; then
            info "GSTD Node installed"
        else
            err "Failed to install GSTD Node"
            err "Try manually: npm install -g gstdbot"
            err "Or from source: git clone https://github.com/gstdcoin/gstdbot.git"
            exit 1
        fi
    fi
    mark_done "gstdbot"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 4: Choose AI Mode
# ═══════════════════════════════════════════════════════════════
step 4 "Choosing AI engine..."

# Read saved mode or ask
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
    echo -e "      ${DIM}AI runs on GSTD Swarm. 8 models available immediately.${NC}"
    echo ""
    echo -e "  ${CYAN}[2]${NC} 💻 ${BOLD}Hybrid Mode${NC} ${DIM}(local + cloud, recommended)${NC}"
    echo -e "      ${DIM}Simple tasks local, complex → Swarm. ~5GB disk.${NC}"
    echo ""
    echo -e "  ${YELLOW}[3]${NC} 🔒 ${BOLD}Sovereign Mode${NC} ${DIM}(fully local, max privacy)${NC}"
    echo -e "      ${DIM}Everything on device. ~10GB disk. No internet needed.${NC}"
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

# ─── Handle Ollama based on mode ─────────────────────────────────
install_ollama() {
    if command -v ollama &>/dev/null; then
        info "Ollama already installed"
        # Make sure it's running
        if ! pgrep -x ollama &>/dev/null; then
            ollama serve &>/dev/null &
            sleep 2
        fi
        return 0
    fi

    log "Installing Ollama..."
    if curl -fsSL https://ollama.com/install.sh | sh 2>>"$LOG_FILE"; then
        info "Ollama installed"
        # Start Ollama
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
        info "Cloud mode — no local models needed!"
        info "AI powered by GSTD Swarm (8 models, instant)"
        ;;
    hybrid)
        info "Hybrid mode selected"
        if ! is_done "ollama"; then
            install_ollama && mark_done "ollama"
        else
            info "Ollama (already set up)"
        fi
        if ! is_done "model_llama"; then
            pull_model "llama3.1:8b" && mark_done "model_llama"
        fi
        ;;
    sovereign)
        info "Sovereign mode selected"
        if ! is_done "ollama"; then
            install_ollama && mark_done "ollama"
        else
            info "Ollama (already set up)"
        fi
        if ! is_done "model_llama"; then
            pull_model "llama3.1:8b" && mark_done "model_llama"
        fi
        if ! is_done "model_coder"; then
            pull_model "qwen2.5-coder:7b" && mark_done "model_coder"
        fi
        ;;
esac

# ═══════════════════════════════════════════════════════════════
# STEP 5: Configure Node
# ═══════════════════════════════════════════════════════════════
step 5 "Configuring node..."

if ! is_done "config"; then
    # Determine local models list
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
  "nodeName": "${NODE_NAME}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "swarm": {
    "enabled": true,
    "maxCPU": 80,
    "maxRAM": 70,
    "url": "https://app.gstdtoken.com/api/v1"
  },
  "dashboard": {
    "host": "0.0.0.0",
    "port": 8080,
    "enabled": true
  },
  "models": {
    "cloud": ["gstd-flash", "gstd-pro", "gstd-ultra"],
    "local": ${LOCAL_MODELS}
  }
}
CONF
    info "Config saved: $CONFIG_DIR/config.json"
    mark_done "config"
else
    info "Config (already exists)"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 6: Open Dashboard Port in Firewall
# ═══════════════════════════════════════════════════════════════
step 6 "Configuring firewall for dashboard (port 8080)..."

open_firewall_port() {
    local PORT=8080
    log "Opening firewall port $PORT..."

    # ─── ufw (Ubuntu/Debian) ─────────────────────────────────
    if command -v ufw &>/dev/null; then
        # Check if ufw is active
        if sudo ufw status 2>/dev/null | grep -q "active"; then
            # Check if port already open
            if sudo ufw status 2>/dev/null | grep -q "$PORT"; then
                info "Port $PORT already open (ufw)"
                return 0
            fi
            sudo ufw allow $PORT/tcp comment 'GSTD Node Dashboard' 2>>"$LOG_FILE"
            info "Port $PORT opened (ufw)"
        else
            info "ufw inactive — no firewall rules needed"
        fi
        return 0
    fi

    # ─── firewalld (Fedora/CentOS/RHEL) ──────────────────────
    if command -v firewall-cmd &>/dev/null; then
        if systemctl is-active firewalld &>/dev/null; then
            if sudo firewall-cmd --list-ports 2>/dev/null | grep -q "$PORT/tcp"; then
                info "Port $PORT already open (firewalld)"
                return 0
            fi
            sudo firewall-cmd --permanent --add-port=$PORT/tcp 2>>"$LOG_FILE"
            sudo firewall-cmd --reload 2>>"$LOG_FILE"
            info "Port $PORT opened (firewalld)"
        else
            info "firewalld inactive — no firewall rules needed"
        fi
        return 0
    fi

    # ─── iptables (fallback for any Linux) ───────────────────
    if command -v iptables &>/dev/null; then
        # Check if rule already exists
        if sudo iptables -C INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null; then
            info "Port $PORT already open (iptables)"
            return 0
        fi
        sudo iptables -I INPUT -p tcp --dport $PORT -j ACCEPT 2>>"$LOG_FILE"
        info "Port $PORT opened (iptables)"

        # Persist iptables rules if possible
        if command -v netfilter-persistent &>/dev/null; then
            sudo netfilter-persistent save 2>>"$LOG_FILE" || true
        elif command -v iptables-save &>/dev/null; then
            sudo iptables-save | sudo tee /etc/iptables.rules >/dev/null 2>>"$LOG_FILE" || true
        fi
        return 0
    fi

    # ─── macOS (pf) ──────────────────────────────────────────
    if [ "$(uname)" = "Darwin" ]; then
        info "macOS — port $PORT accessible by default"
        return 0
    fi

    info "No firewall detected — port $PORT should be accessible"
    return 0
}

if is_done "firewall"; then
    info "Firewall port 8080 (already configured)"
else
    open_firewall_port
    mark_done "firewall"
fi

# ─── Verify everything ──────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}✓ GSTD Node ready!${NC}                             ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"

# Quick verification
echo ""
echo -e "  ${BOLD}Verification:${NC}"
command -v node &>/dev/null && echo -e "  ${GREEN}✓${NC} Node.js $(node -v)" || echo -e "  ${RED}✗${NC} Node.js"
command -v npm &>/dev/null && echo -e "  ${GREEN}✓${NC} npm $(npm -v)" || echo -e "  ${RED}✗${NC} npm"
command -v gstdbot &>/dev/null && echo -e "  ${GREEN}✓${NC} gstdbot CLI" || echo -e "  ${YELLOW}⚠${NC} gstdbot (may need: source ~/.bashrc)"
[ -f "$CONFIG_DIR/config.json" ] && echo -e "  ${GREEN}✓${NC} Config" || echo -e "  ${RED}✗${NC} Config"

if [ "$MODE" != "cloud" ]; then
    command -v ollama &>/dev/null && echo -e "  ${GREEN}✓${NC} Ollama" || echo -e "  ${YELLOW}⚠${NC} Ollama (install: curl -fsSL https://ollama.com/install.sh | sh)"
    ollama list 2>/dev/null | grep -q "llama" && echo -e "  ${GREEN}✓${NC} AI Models" || echo -e "  ${YELLOW}⚠${NC} Models (run: ollama pull llama3.1:8b)"
fi

echo ""
echo -e "  ${BOLD}Quick Start:${NC}"
echo -e "  ${CYAN}gstdbot${NC}                    Start chatting"
echo -e "  ${CYAN}gstdbot gateway${NC}            Dashboard (localhost:8080)"
echo -e "  ${CYAN}gstdbot swarm join${NC}         Earn GSTD tokens"
echo -e "  ${CYAN}gstdbot wallet init${NC}        Create TON wallet"
echo ""
echo -e "  ${BOLD}Skills:${NC}"
echo -e "  ${CYAN}gstdbot skills list${NC}        Browse 10+ AI skills"
echo -e "  ${CYAN}gstdbot skills import${NC} ${DIM}<url>${NC}  Import from GitHub"
echo -e "  ${CYAN}gstdbot skills create${NC} ${DIM}<n>${NC}    Create your own"
echo ""
echo -e "  ${BOLD}AI Models (GSTD tokens):${NC}"
echo -e "  ${DIM}gstd-flash${NC}  — 1 model        ${GREEN}Free${NC}"
echo -e "  ${DIM}gstd-pro${NC}    — 3 experts       ${YELLOW}\$0.001${NC}"
echo -e "  ${DIM}gstd-ultra${NC}  — 8 experts       ${CYAN}\$0.005${NC}"
echo ""
echo -e "  ${BOLD}Links:${NC}"
echo -e "  🌐 ${DIM}https://gstdbot.gstdtoken.com${NC}"
echo -e "  🤖 ${DIM}https://t.me/GstdAppBot${NC}"
echo -e "  📡 ${DIM}https://monitor.gstdtoken.com${NC}"
echo ""
echo -e "  ${DIM}Install log: $LOG_FILE${NC}"
echo -e "  ${DIM}State file:  $STATE_FILE (delete to re-install from scratch)${NC}"
echo ""
