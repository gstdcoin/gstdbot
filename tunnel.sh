#!/bin/bash
# Cloudflare Tunnel for gstdbot — replaces localhost.run
# Publishes the node's temporary Cloudflare Tunnel URL for peer discovery.
# Stores the URL outside /tmp so systemd PrivateTmp services can read it.

INSTALL_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
CONFIG_DIR="${GSTD_CONFIG_DIR:-$HOME/.config/gstdbot}"
mkdir -p "$CONFIG_DIR" "$INSTALL_DIR/logs"
URL_FILE="${GSTD_TUNNEL_URL_FILE:-$CONFIG_DIR/tunnel-url.txt}"
LOG="$INSTALL_DIR/logs/tunnel.log"
CF_BIN="$INSTALL_DIR/cloudflared"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

if [ ! -f "$CF_BIN" ]; then
    log "Downloading cloudflared..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64) CF_ARCH="amd64" ;;
        aarch64|arm64) CF_ARCH="arm64" ;;
        *) log "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o "$CF_BIN"
    chmod +x "$CF_BIN"
fi

GSTDAI_DIR="${GSTD_PLATFORM_SOURCE_DIR:-$HOME/gstdai}"

update_github_node_url() {
  local url="$1"
  [ "${GSTD_PUBLISH_TUNNEL_TO_GITHUB:-false}" = "true" ] || return
  [ -d "$GSTDAI_DIR/.git" ] || return

  # Update simple URL file
  echo "$url" > "$GSTDAI_DIR/node-url.txt"

  # Update nodes-registry.json for nodes/list and network/info fallback
  local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  cat > "$GSTDAI_DIR/nodes-registry.json" << JSONEOF
[
  {
    "node_id": "gstd-pi-bootstrap",
    "name": "Node-gstd-pi-bootstrap",
    "mode": "node",
    "version": "3.5.0",
    "capabilities": ["llama3.2:3b"],
    "multiaddrs": ["$url"],
    "node_url": "$url",
    "platform": "linux",
    "cpu_cores": 4,
    "has_gpu": false,
    "tasks_completed": 0,
    "uptime_hours": 0,
    "last_seen": "$ts"
  }
]
JSONEOF

  (cd "$GSTDAI_DIR" && git add node-url.txt nodes-registry.json && \
    git -c user.email="bot@gstdtoken.xyz" -c user.name="GSTD Pi Node" \
      commit -m "Update Pi node URL: $url" --no-gpg-sign && \
    git push origin main 2>&1 | tail -3) && log "GitHub node registry updated" \
    || log "GitHub update failed"
}

while true; do
  log "Starting Cloudflare Tunnel..."
  TMPOUT=$(mktemp)

  "$CF_BIN" tunnel --url "http://127.0.0.1:${GSTD_DASHBOARD_PORT:-8080}" --no-autoupdate \
    --logfile "$TMPOUT" --loglevel info 2>&1 &
  CF_PID=$!

  # Wait for URL (up to 30s)
  TUNNEL_URL=""
  for i in $(seq 1 30); do
    sleep 1
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TMPOUT" 2>/dev/null | head -1)
    [ -n "$TUNNEL_URL" ] && break
  done

  if [ -n "$TUNNEL_URL" ]; then
    log "Tunnel active: $TUNNEL_URL"
    echo "$TUNNEL_URL" > "$URL_FILE"
    update_github_node_url "$TUNNEL_URL"
    ENV_FILE="$INSTALL_DIR/.env"
    # Update GSTD_PUBLIC_URL (used by P2P heartbeat)
    if grep -q "^GSTD_PUBLIC_URL=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^GSTD_PUBLIC_URL=.*|GSTD_PUBLIC_URL=$TUNNEL_URL|" "$ENV_FILE"
    else
      echo "GSTD_PUBLIC_URL=$TUNNEL_URL" >> "$ENV_FILE"
    fi
    log "Updated GSTD_PUBLIC_URL=$TUNNEL_URL in .env"
    # Update GitHub gstdai seed file so other nodes bootstrapping can find this Pi
    if [ "${GSTD_PUBLISH_TUNNEL_TO_GITHUB:-false}" = "true" ]; then
    SEED_FILE="$GSTDAI_DIR/gstd-seed-peers.txt"
    echo "$TUNNEL_URL" > "$SEED_FILE"
    (cd "$GSTDAI_DIR" && git add gstd-seed-peers.txt && \
      git -c user.email="bot@gstdtoken.xyz" -c user.name="GSTD Pi Node" \
        commit -m "Update seed peer URL: $TUNNEL_URL" --no-gpg-sign && \
      git push origin main 2>&1 | tail -2) 2>/dev/null || true
    fi
  else
    log "Failed to get Cloudflare tunnel URL — check $TMPOUT"
    cat "$TMPOUT" >> "$LOG"
  fi

  rm -f "$TMPOUT"
  wait $CF_PID
  EXIT_CODE=$?
  log "Tunnel exited (code $EXIT_CODE). Restarting in 15s..."
  sleep 15
done
