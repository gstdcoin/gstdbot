#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node — One-Line Installer
# curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
# ═══════════════════════════════════════════════════════════════
set -e

VERSION="2.0.0"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   🐝 GSTD Node v${VERSION}                        ║"
echo "║   Your Device is the Supercomputer           ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

info()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }

# ─── Step 1: Detect system ──────────────────────────────────────
TOTAL_STEPS=4
step 1 "Detecting system..."

OS="unknown"; ARCH=$(uname -m)
if [ -f /etc/os-release ]; then
    . /etc/os-release; OS=$ID
elif [ "$(uname)" = "Darwin" ]; then
    OS="macos"
fi
case $ARCH in x86_64) ARCH="amd64";; aarch64|arm64) ARCH="arm64";; armv7l) ARCH="armv7";; esac
info "OS: ${OS} (${ARCH})"

# Check Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d'.' -f1)
    if [ "$NODE_VER" -lt 20 ] 2>/dev/null; then
        warn "Node.js $(node -v) is too old, need >= 20"
        warn "Installing Node.js 22..."
        curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - 2>/dev/null
        sudo apt-get install -y nodejs 2>/dev/null || sudo dnf install -y nodejs 2>/dev/null
    else
        info "Node.js $(node -v)"
    fi
else
    warn "Installing Node.js 22..."
    if [ "$OS" = "macos" ]; then
        brew install node@22 2>/dev/null || {
            curl -fsSL https://fnm.vercel.app/install | bash
            export PATH="$HOME/.local/share/fnm:$PATH"
            eval "$(fnm env)" 2>/dev/null
            fnm install 22; fnm use 22
        }
    else
        curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - 2>/dev/null
        sudo apt-get install -y nodejs 2>/dev/null || sudo dnf install -y nodejs 2>/dev/null
    fi
    info "Node.js $(node -v)"
fi

# ─── Step 2: Install GSTD Node ──────────────────────────────────
step 2 "Installing GSTD Node..."

npm install -g gstdbot@latest 2>/dev/null || {
    warn "npm global failed, trying from source..."
    TMPDIR=$(mktemp -d)
    git clone --depth 1 https://github.com/gstdcoin/gstdbot.git "$TMPDIR/gstdbot" 2>/dev/null
    cd "$TMPDIR/gstdbot"
    npm install --legacy-peer-deps 2>/dev/null
    npm run build 2>/dev/null
    npm link 2>/dev/null
    cd - >/dev/null
    info "Installed from source"
}
info "GSTD Node installed"

# ─── Step 3: Choose mode ────────────────────────────────────────
step 3 "Choosing AI engine..."

echo ""
echo -e "  ${BOLD}How do you want to run AI models?${NC}"
echo ""
echo -e "  ${GREEN}[1]${NC} ☁️  ${BOLD}Cloud Mode${NC} ${DIM}(instant, no download, uses GSTD Swarm)${NC}"
echo -e "      ${DIM}AI runs on the Swarm network. Pay with GSTD tokens.${NC}"
echo -e "      ${DIM}8 models available immediately. Zero setup.${NC}"
echo ""
echo -e "  ${CYAN}[2]${NC} 💻 ${BOLD}Hybrid Mode${NC} ${DIM}(local + cloud, recommended)${NC}"
echo -e "      ${DIM}Simple tasks run locally (Ollama). Complex tasks → Swarm.${NC}"
echo -e "      ${DIM}Requires ~5GB disk. Earn GSTD by sharing compute.${NC}"
echo ""
echo -e "  ${YELLOW}[3]${NC} 🔒 ${BOLD}Sovereign Mode${NC} ${DIM}(fully local, maximum privacy)${NC}"
echo -e "      ${DIM}Everything runs on your device. Requires Ollama + models.${NC}"
echo -e "      ${DIM}Requires ~10GB disk. No internet needed after setup.${NC}"
echo ""

# Default to cloud mode for fast start
read -t 30 -p "  Choose [1/2/3] (default: 1): " MODE_CHOICE || MODE_CHOICE="1"
echo ""

case $MODE_CHOICE in
    2)
        MODE="hybrid"
        info "Hybrid mode selected — installing Ollama..."
        if command -v ollama &>/dev/null; then
            info "Ollama already installed"
        else
            curl -fsSL https://ollama.com/install.sh | sh 2>/dev/null
            info "Ollama installed"
        fi
        warn "Pulling lightweight model (llama3.1:8b, ~4.7GB)..."
        ollama pull llama3.1:8b 2>/dev/null && info "Model ready" || warn "Pull later: ollama pull llama3.1:8b"
        ;;
    3)
        MODE="sovereign"
        info "Sovereign mode — installing Ollama + models..."
        if ! command -v ollama &>/dev/null; then
            curl -fsSL https://ollama.com/install.sh | sh 2>/dev/null
        fi
        info "Ollama installed"
        warn "Pulling models (this takes 10-15 min)..."
        ollama pull llama3.1:8b 2>/dev/null && info "llama3.1:8b ✓" || warn "Failed: ollama pull llama3.1:8b"
        ollama pull qwen2.5-coder:7b 2>/dev/null && info "qwen2.5-coder:7b ✓" || warn "Failed"
        ;;
    *)
        MODE="cloud"
        info "Cloud mode selected — no local models needed!"
        info "AI powered by GSTD Swarm (8 models, instant)"
        ;;
esac

# ─── Step 4: Setup ──────────────────────────────────────────────
step 4 "Configuring node..."

# Create config directory
CONFIG_DIR="$HOME/.config/gstdbot"
mkdir -p "$CONFIG_DIR/skills"

# Write config
cat > "$CONFIG_DIR/config.json" << CONF
{
  "version": "${VERSION}",
  "mode": "${MODE}",
  "nodeName": "$(hostname)-node",
  "swarm": { "enabled": true, "maxCPU": 80, "maxRAM": 70 },
  "dashboard": { "port": 8080, "enabled": true },
  "models": {
    "cloud": ["gstd-flash", "gstd-pro", "gstd-ultra"],
    "local": $([ "$MODE" != "cloud" ] && echo '["llama3.1:8b"]' || echo '[]')
  }
}
CONF
info "Config saved to $CONFIG_DIR/config.json"

# ─── Done! ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}✓ GSTD Node installed!${NC}                         ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Get started:${NC}"
echo -e "  ${CYAN}gstdbot${NC}                    Start chatting"
echo -e "  ${CYAN}gstdbot swarm join${NC}         Earn GSTD tokens"
echo -e "  ${CYAN}gstdbot gateway${NC}            Start dashboard (localhost:8080)"
echo ""
echo -e "  ${BOLD}Import skills:${NC}"
echo -e "  ${CYAN}gstdbot skills import${NC} ${DIM}<url>${NC}      From URL or GitHub"
echo -e "  ${CYAN}gstdbot skills list${NC}                Browse marketplace"
echo -e "  ${CYAN}gstdbot skills create${NC} ${DIM}<name>${NC}     Create your own"
echo ""
echo -e "  ${BOLD}Advanced models (with GSTD tokens):${NC}"
echo -e "  ${DIM}gstd-flash${NC}  — Fast (1 model)        ${GREEN}Free${NC}"
echo -e "  ${DIM}gstd-pro${NC}    — 3-expert consensus    ${YELLOW}10 GSTD${NC}"
echo -e "  ${DIM}gstd-ultra${NC}  — 8-expert + reasoning  ${CYAN}50 GSTD${NC}"
echo ""
echo -e "  ${BOLD}Links:${NC}"
echo -e "  🌐 https://gstdbot.gstdtoken.com"
echo -e "  🤖 https://t.me/GstdAppBot"
echo -e "  📡 https://monitor.gstdtoken.com"
echo ""
