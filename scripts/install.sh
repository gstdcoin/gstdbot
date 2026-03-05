#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GSTD Node — One-Line Installer
# https://gstdbot.gstdtoken.com
# ═══════════════════════════════════════════════════════════════
set -e

VERSION="1.0.0"
REPO="https://github.com/gstdcoin/gstd-node"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BOLD}GSTD Node${NC} v${VERSION}                          ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${GREEN}Sovereign AI • Swarm Intelligence${NC}           ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

info()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}[$1/5]${NC} ${BOLD}$2${NC}"; }

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID; OS_VER=$VERSION_ID
    elif [ "$(uname)" = "Darwin" ]; then
        OS="macos"; OS_VER=$(sw_vers -productVersion)
    else
        OS="unknown"
    fi
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)  ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        armv7l)  ARCH="armv7" ;;
    esac
    info "OS: ${OS} ${OS_VER} (${ARCH})"
}

install_deps() {
    if command -v node &>/dev/null; then
        NODE_VER=$(node -v)
        info "Node.js already installed: $NODE_VER"
    else
        warn "Installing Node.js 20 LTS..."
        if [ "$OS" = "macos" ]; then
            brew install node@20 2>/dev/null || curl -fsSL https://fnm.vercel.app/install | bash
        else
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null
            sudo apt-get install -y nodejs 2>/dev/null || sudo dnf install -y nodejs 2>/dev/null
        fi
        info "Node.js installed: $(node -v)"
    fi

    if command -v ollama &>/dev/null; then
        info "Ollama already installed"
    else
        warn "Installing Ollama (local AI engine)..."
        curl -fsSL https://ollama.com/install.sh | sh
        info "Ollama installed"
    fi
}

install_gstd() {
    if command -v gstd-node &>/dev/null; then
        info "GSTD Node already installed, updating..."
    fi
    npm install -g @gstdcoin/gstd-node@latest 2>/dev/null || {
        warn "npm global install failed, trying with sudo..."
        sudo npm install -g @gstdcoin/gstd-node@latest
    }
    info "GSTD Node installed: $(gstd-node --version 2>/dev/null || echo $VERSION)"
}

pull_model() {
    warn "Pulling Llama 3.1 8B model (this may take a few minutes)..."
    ollama pull llama3.1:8b 2>/dev/null && info "Model ready: llama3.1:8b" || warn "Model pull skipped (can be done later)"
}

show_next() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}  ${BOLD}Installation complete!${NC}                      ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}Next steps:${NC}"
    echo -e "  ${CYAN}1.${NC} gstd-node setup        ${GREEN}# Configure node${NC}"
    echo -e "  ${CYAN}2.${NC} gstd-node wallet init   ${GREEN}# Create/import wallet${NC}"
    echo -e "  ${CYAN}3.${NC} gstd-node start         ${GREEN}# Start earning!${NC}"
    echo ""
    echo -e "  ${BOLD}Dashboard:${NC}  http://localhost:8080"
    echo -e "  ${BOLD}Docs:${NC}       https://gstdbot.gstdtoken.com"
    echo -e "  ${BOLD}Telegram:${NC}   https://t.me/GstdAppBot"
    echo ""
}

# ─── Main ─────────────────────────────────────
banner
step 1 "Detecting system..."
detect_os

step 2 "Installing dependencies..."
install_deps

step 3 "Installing GSTD Node..."
install_gstd

step 4 "Pulling AI model..."
pull_model

step 5 "Done!"
show_next
