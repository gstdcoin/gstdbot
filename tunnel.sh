#!/bin/bash
# Managed localhost.run SSH tunnel for gstdbot
# Writes current URL to /tmp/gstd_tunnel_url.txt
# If VERCEL_TOKEN and VERCEL_PROJECT_ID are set, auto-updates GSTD_NODE_URL env var

URL_FILE="/tmp/gstd_tunnel_url.txt"
VERCEL_TOKEN="${VERCEL_TOKEN:-}"
VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_j2gQqRULHdMowbDHZt7wSqs2z3Bf}"
LOG="/home/bot/gstdbot/logs/tunnel.log"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

update_vercel() {
  local url="$1"
  if [ -z "$VERCEL_TOKEN" ]; then
    log "No VERCEL_TOKEN — skipping auto-update. Set manually: GSTD_NODE_URL=$url"
    return
  fi
  log "Updating Vercel GSTD_NODE_URL=$url"
  # Remove existing env var, then add new one
  curl -s -X DELETE "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?key=GSTD_NODE_URL&target=production" \
    -H "Authorization: Bearer $VERCEL_TOKEN" > /dev/null 2>&1
  local result
  result=$(curl -s -X POST "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env" \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"GSTD_NODE_URL\",\"value\":\"$url\",\"type\":\"plain\",\"target\":[\"production\"]}")
  if echo "$result" | grep -q '"key"'; then
    log "Vercel GSTD_NODE_URL updated successfully"
    # Trigger redeploy
    curl -s -X POST "https://api.vercel.com/v13/deployments" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"ai\",\"gitSource\":{\"type\":\"github\",\"ref\":\"main\",\"repoId\":\"$(curl -s 'https://api.vercel.com/v9/projects/ai' -H \"Authorization: Bearer $VERCEL_TOKEN\" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(\"link\",{}).get(\"repoId\",\"\"))')\"}}" \
      > /dev/null 2>&1
    log "Vercel redeploy triggered"
  else
    log "Vercel update failed: $result"
  fi
}

while true; do
  log "Starting localhost.run SSH tunnel..."
  TMPOUT=$(mktemp)

  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=20 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 80:127.0.0.1:8080 nokey@localhost.run 2>&1 > "$TMPOUT" &
  SSH_PID=$!

  # Wait for URL (up to 20s)
  TUNNEL_URL=""
  for i in $(seq 1 20); do
    sleep 1
    TUNNEL_URL=$(grep -oP 'https://[a-z0-9]+\.lhr\.life' "$TMPOUT" 2>/dev/null | head -1)
    [ -n "$TUNNEL_URL" ] && break
  done

  if [ -n "$TUNNEL_URL" ]; then
    log "Tunnel active: $TUNNEL_URL"
    echo "$TUNNEL_URL" > "$URL_FILE"
    update_vercel "$TUNNEL_URL"
    # Update GSTD_PUBLIC_URL in .env so gstdbot knows its own URL after restart
    ENV_FILE="/home/bot/gstdbot/.env"
    if grep -q "^GSTD_PUBLIC_URL=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^GSTD_PUBLIC_URL=.*|GSTD_PUBLIC_URL=$TUNNEL_URL|" "$ENV_FILE"
    else
      echo "GSTD_PUBLIC_URL=$TUNNEL_URL" >> "$ENV_FILE"
    fi
    log "Updated GSTD_PUBLIC_URL=$TUNNEL_URL in .env"
  else
    log "Failed to get tunnel URL. Log:"
    cat "$TMPOUT" >> "$LOG"
  fi

  rm -f "$TMPOUT"

  # Wait for SSH process to die
  wait $SSH_PID
  EXIT_CODE=$?
  log "Tunnel exited (code $EXIT_CODE). Restarting in 10s..."
  sleep 10
done
