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

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[GSTD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

RESET=false
[ "$1" = "--reset" ] && RESET=true

echo ""
echo "  🐝 ═══════════════════════════════════════════"
echo "  🐝  GSTD Node OS — Reinstall"
echo "  🐝  $(date)"
echo "  🐝 ═══════════════════════════════════════════"
echo ""

# 1. Stop running node
log "Stopping running node..."
pkill -f "node.*dist/index.js" 2>/dev/null || true
sleep 2

# 2. Backup data (unless --reset)
if [ "$RESET" = false ]; then
    log "Backing up data to $BACKUP_DIR..."
    mkdir -p "$BACKUP_DIR"
    for f in wallet.json earnings.json dashboard_pin.hash telegram_link.json config.json \
             dyndns.json resources.json transactions.json staking.json ssl; do
        cp -r "$CONFIG_DIR/$f" "$BACKUP_DIR/" 2>/dev/null || true
    done
    log "Backup complete ✓"
else
    warn "FULL RESET — all data will be deleted"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && { echo "Cancelled."; exit 0; }
    rm -rf "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR"
fi

# 3. Update code
log "Pulling latest code..."
cd "$INSTALL_DIR"
git fetch --all
git reset --hard origin/main
log "Code updated ✓"

# 4. Install dependencies
log "Installing dependencies..."
npm install --legacy-peer-deps --silent 2>/dev/null
log "Dependencies installed ✓"

# 5. Build
log "Building TypeScript..."
npx tsc
log "Build complete ✓"

# 6. Restore data
if [ "$RESET" = false ] && [ -d "$BACKUP_DIR" ]; then
    log "Restoring data from backup..."
    cp -r "$BACKUP_DIR"/* "$CONFIG_DIR/" 2>/dev/null || true
    rm -rf "$BACKUP_DIR"
    log "Data restored ✓"
fi

# 7. Copy dashboard
cp "$INSTALL_DIR/web/dashboard.html" /var/www/gstdbot/ 2>/dev/null || true

# 8. Restart via systemd or directly
if systemctl is-active --quiet gstd-node 2>/dev/null; then
    log "Restarting via systemd..."
    sudo systemctl restart gstd-node
else
    log "Starting node..."
    cd "$INSTALL_DIR"
    nohup node dist/index.js > /tmp/gstd-node.log 2>&1 &
fi

sleep 3
echo ""
echo "  ✅ Reinstall complete!"
echo "  📍 Dashboard: http://localhost:$(grep -oP '(?<=port )\d+' /tmp/gstd-node.log 2>/dev/null || echo 8080)"
echo ""
