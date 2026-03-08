#!/bin/bash
# ═══════════════════════════════════════════════════════
# GSTD Node OS — One-Command Reinstall
# Reinstalls the node from GitHub while preserving all data
# Usage: bash reinstall.sh [--reset]
# ═══════════════════════════════════════════════════════

set -e
INSTALL_DIR="${GSTD_INSTALL_DIR:-$HOME/gstdbot}"
CONFIG_DIR="$HOME/.config/gstdbot"
BACKUP_DIR="$CONFIG_DIR/backup_$(date +%s)"
NODE_PORT=8091

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "${GREEN}[GSTD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

RESET=false
[ "$1" = "--reset" ] && RESET=true

echo ""
echo "  🐝 ═══════════════════════════════════════════"
echo "  🐝  GSTD Node OS — Reinstall"
echo "  🐝  $(date)"
echo "  🐝  Install dir: $INSTALL_DIR"
echo "  🐝  Config dir:  $CONFIG_DIR"
echo "  🐝 ═══════════════════════════════════════════"
echo ""

# 0. Validate install dir
if [ ! -d "$INSTALL_DIR" ]; then
    err "Install directory $INSTALL_DIR not found. Run install.sh first."
fi

# 1. Stop running node
log "Stopping running node..."
if systemctl is-active --quiet gstd-node 2>/dev/null; then
    sudo systemctl stop gstd-node 2>/dev/null || true
else
    pkill -f "node.*dist/index.js" 2>/dev/null || true
fi
sleep 2
log "Node stopped ✓"

# 2. Backup data (unless --reset)
if [ "$RESET" = false ]; then
    log "Backing up data to $BACKUP_DIR..."
    mkdir -p "$BACKUP_DIR"
    # Backup all config files and directories
    for f in wallet.json earnings.json dashboard_pin.hash telegram_link.json \
             config.json dyndns.json resources.json transactions.json \
             staking.json access_tokens.json activity.log ssl apps security; do
        if [ -e "$CONFIG_DIR/$f" ]; then
            cp -r "$CONFIG_DIR/$f" "$BACKUP_DIR/" 2>/dev/null || true
            log "  ✓ backed up: $f"
        fi
    done
    log "Backup complete ✓ ($(ls -1 "$BACKUP_DIR" | wc -l) items)"
else
    warn "FULL RESET — all data will be deleted (wallet, config, PIN, earnings)"
    read -p "Are you sure? Type 'yes' to confirm: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Cancelled."
        exit 0
    fi
    rm -rf "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR"
    log "Config wiped ✓"
fi

# 3. Update code from GitHub
log "Pulling latest code from GitHub..."
cd "$INSTALL_DIR"
git fetch --all 2>/dev/null
# Detect default branch (main or master)
DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
git reset --hard "origin/$DEFAULT_BRANCH"
log "Code updated ✓ (branch: $DEFAULT_BRANCH, commit: $(git rev-parse --short HEAD))"

# 4. Install dependencies
log "Installing dependencies..."
npm install --legacy-peer-deps 2>&1 | tail -3
log "Dependencies installed ✓"

# 5. Build
log "Building TypeScript..."
npx tsc 2>&1 | tail -5
log "Build complete ✓"

# 6. Restore data from backup
if [ "$RESET" = false ] && [ -d "$BACKUP_DIR" ]; then
    log "Restoring data from backup..."
    for f in "$BACKUP_DIR"/*; do
        fname=$(basename "$f")
        cp -r "$f" "$CONFIG_DIR/$fname" 2>/dev/null || true
        log "  ✓ restored: $fname"
    done
    rm -rf "$BACKUP_DIR"
    log "Data restored ✓"
fi

# 7. Copy dashboard to web root (if web root exists)
if [ -d "/var/www/gstdbot" ] && [ -f "$INSTALL_DIR/web/dashboard.html" ]; then
    cp "$INSTALL_DIR/web/dashboard.html" /var/www/gstdbot/ 2>/dev/null || true
    log "Dashboard copied to /var/www/gstdbot/ ✓"
fi
if [ -f "$INSTALL_DIR/web/index.html" ] && [ -d "/var/www/gstdbot" ]; then
    cp "$INSTALL_DIR/web/index.html" /var/www/gstdbot/ 2>/dev/null || true
fi

# 8. Restart the node
if systemctl list-unit-files gstd-node.service &>/dev/null; then
    log "Restarting via systemd..."
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl restart gstd-node
    sleep 3
    if systemctl is-active --quiet gstd-node; then
        log "Node started via systemd ✓"
    else
        warn "systemd start failed — check: journalctl -u gstd-node -n 30"
    fi
else
    log "Starting node directly..."
    cd "$INSTALL_DIR"
    nohup node dist/index.js > /tmp/gstd-node.log 2>&1 &
    sleep 3
    if pgrep -f "node.*dist/index.js" > /dev/null; then
        log "Node started (PID: $(pgrep -f 'node.*dist/index.js' | head -1)) ✓"
    else
        warn "Failed to start. Check /tmp/gstd-node.log"
    fi
fi

# 9. Verify the node is responding
sleep 2
if curl -sf "http://localhost:$NODE_PORT/api/node/status" > /dev/null 2>&1; then
    VERSION=$(curl -sf "http://localhost:$NODE_PORT/api/node/status" | python3 -c "import json,sys; print(json.load(sys.stdin).get('node',{}).get('version','?'))" 2>/dev/null || echo "?")
    WALLET=$(curl -sf "http://localhost:$NODE_PORT/api/node/status" | python3 -c "import json,sys; print(json.load(sys.stdin).get('wallet',{}).get('address','?')[:16])" 2>/dev/null || echo "?")
    echo ""
    echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${GREEN}✅ Reinstall complete!${NC}"
    echo -e "  ${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  📍 Dashboard:  ${CYAN}http://localhost:$NODE_PORT${NC}"
    echo -e "  📦 Version:    $VERSION"
    echo -e "  💰 Wallet:     $WALLET..."
    echo -e "  📋 Logs:       ${CYAN}journalctl -u gstd-node -f${NC}"
    echo ""
    if [ "$RESET" = true ]; then
        echo -e "  ${YELLOW}⚠️  Fresh start — new wallet generated${NC}"
        echo -e "  ${YELLOW}   Open dashboard to set PIN and configure${NC}"
    else
        echo -e "  ✅ Your wallet, PIN, and config — all preserved"
    fi
    echo ""
else
    echo ""
    echo -e "  ${YELLOW}⚠️  Node is starting... may need a few more seconds${NC}"
    echo -e "  📍 Dashboard:  http://localhost:$NODE_PORT"
    echo -e "  📋 Check logs: journalctl -u gstd-node -n 30"
    echo ""
fi
