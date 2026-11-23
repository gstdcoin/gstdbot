# ═══════════════════════════════════════════════════════
# GSTD Node OS — Production Dockerfile
# Build from this checkout: docker compose up -d --build
# ═══════════════════════════════════════════════════════

# ─── Stage 1: Build ──────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN node_modules/.bin/tsc

# ─── Stage 2: Runtime ────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# System deps (minimal)
RUN apk add --no-cache curl git bash tini

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application
COPY --from=builder /app/dist/ ./dist/

# Copy web dashboard & assets
COPY web/ ./web/
COPY data/model-catalog.json ./data/model-catalog.json
COPY scripts/ ./scripts/

# Create data directory for persistent storage
RUN mkdir -p /data/gstdbot /app/data && chown -R node:node /data/gstdbot /app/data

# ─── Environment ─────────────────────────────────────
ENV NODE_ENV=production
ENV GSTD_API_PORT=8080
ENV SWARM_ENABLED=true
ENV GSTD_MEMORY=false
ENV GSTD_CONFIG_DIR=/data/gstdbot
ENV HOME=/data/gstdbot
ENV GSTD_DATA_DIR=/data/gstdbot

# ─── Expose & Health ─────────────────────────────────
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1

# ─── Labels ──────────────────────────────────────────
LABEL org.opencontainers.image.title="GSTD Node OS"
LABEL org.opencontainers.image.description="Sovereign AI Node — earn GSTD by processing AI queries"
LABEL org.opencontainers.image.url="https://app.gstdtoken.xyz"
LABEL org.opencontainers.image.source="https://github.com/gstdcoin/gstdbot"
LABEL org.opencontainers.image.version="3.7.0"
LABEL org.opencontainers.image.vendor="GSTD"

ENV NODE_OPTIONS="--no-deprecation"

USER node

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
