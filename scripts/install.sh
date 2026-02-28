#!/bin/bash
# GSTD Bot — Install Script
# curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║   🐝 GSTD Bot — Installation         ║"
echo "║   Sovereign Decentralized AI Agent   ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing via nvm...${NC}"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${YELLOW}Node.js >= 20 required. Current: $(node -v)${NC}"
    echo "Install with: nvm install 22"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Install gstdbot
echo -e "\n${BOLD}Installing GSTD Bot...${NC}"
npm install -g gstdbot@latest 2>/dev/null || {
    echo -e "${YELLOW}npm install failed, trying from source...${NC}"
    TMPDIR=$(mktemp -d)
    git clone https://github.com/gstdcoin/gstdbot.git "$TMPDIR/gstdbot"
    cd "$TMPDIR/gstdbot"
    npm install
    npm run build
    npm link
    cd -
    echo -e "${GREEN}✓${NC} Installed from source"
}

echo -e "${GREEN}✓${NC} GSTD Bot installed"

# Check Ollama
if command -v ollama &> /dev/null; then
    echo -e "${GREEN}✓${NC} Ollama found"
    
    # Pull recommended models
    echo -e "\n${BOLD}Pulling sovereign models...${NC}"
    echo -e "  This may take a while on first run."
    
    ollama pull llama3.1:8b 2>/dev/null && echo -e "  ${GREEN}✓${NC} llama3.1:8b" || echo -e "  ${YELLOW}⚠${NC} llama3.1:8b (manual: ollama pull llama3.1:8b)"
    ollama pull qwen2.5-coder:7b 2>/dev/null && echo -e "  ${GREEN}✓${NC} qwen2.5-coder:7b" || echo -e "  ${YELLOW}⚠${NC} qwen2.5-coder:7b (manual: ollama pull qwen2.5-coder:7b)"
else
    echo -e "${YELLOW}⚠${NC} Ollama not found — install from https://ollama.com for local AI"
fi

# Run onboarding
echo -e "\n${BOLD}Running onboarding...${NC}\n"
gstdbot onboard

echo -e "\n${GREEN}${BOLD}✓ Installation complete!${NC}"
echo -e "${CYAN}"
echo "  Quick start:"
echo "    gstdbot gateway        — Start serving"
echo "    gstdbot status         — Check everything"
echo "    gstdbot chat           — Start chatting"
echo "    gstdbot swarm join     — Earn GSTD tokens"
echo ""
echo "  Web: https://gstdbot.gstdtoken.com"
echo "  Bot: https://t.me/GstdAppBot"
echo -e "${NC}"
