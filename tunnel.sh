#!/bin/bash
# Cloudflare Tunnel for gstdbot — replaces localhost.run
# Cloudflare's network is accessible from Vercel, AWS, and other clouds.
# Writes current URL to /tmp/gstd_tunnel_url.txt on each connect.

URL_FILE="/tmp/gstd_tunnel_url.txt"
VERCEL_TOKEN="${VERCEL_TOKEN:-}"
VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_j2gQqRULHdMowbDHZt7wSqs2z3Bf}"
LOG="/home/bot/gstdbot/logs/tunnel.log"
CF_BIN="$(dirname "$0")/cloudflared"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

update_vercel() {
  local url="$1"
  if [ -z "$VERCEL_TOKEN" ]; then
    log "No VERCEL_TOKEN — set manually: GSTD_NODE_URL=$url"
    return
  fi
  log "Updating Vercel GSTD_NODE_URL=$url"
  curl -s -X DELETE "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?key=GSTD_NODE_URL&target=production" \
    -H "Authorization: Bearer $VERCEL_TOKEN" > /dev/null 2>&1
  local result
  result=$(curl -s -X POST "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env" \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"GSTD_NODE_URL\",\"value\":\"$url\",\"type\":\"plain\",\"target\":[\"production\"]}")
  if echo "$result" | grep -q '"key"'; then
    log "Vercel GSTD_NODE_URL updated"
  else
    log "Vercel update failed: $result"
  fi
}

while true; do
  log "Starting Cloudflare Tunnel..."
  TMPOUT=$(mktemp)

  "$CF_BIN" tunnel --url "http://localhost:8080" --no-autoupdate \
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
    update_vercel "$TUNNEL_URL"
    ENV_FILE="/home/bot/gstdbot/.env"
    if grep -q "^GSTD_PUBLIC_URL=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^GSTD_PUBLIC_URL=.*|GSTD_PUBLIC_URL=$TUNNEL_URL|" "$ENV_FILE"
    else
      echo "GSTD_PUBLIC_URL=$TUNNEL_URL" >> "$ENV_FILE"
    fi
    log "Updated GSTD_PUBLIC_URL=$TUNNEL_URL in .env"
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
