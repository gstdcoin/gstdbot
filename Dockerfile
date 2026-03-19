# ═══════════════════════════════════════════════════════
# GSTD Node OS — Production Dockerfile
# Ready-to-run: docker run -p 8080:8080 gstdcoin/node
# ═══════════════════════════════════════════════════════

# ─── Stage 1: Build ──────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc --skipLibCheck

# ─── Stage 2: Runtime ────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# System deps (minimal)
RUN apk add --no-cache curl git bash tini

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps 2>/dev/null || npm install --omit=dev --legacy-peer-deps

# Copy built application
COPY --from=builder /app/dist/ ./dist/

# Copy web dashboard & assets
COPY web/ ./web/
COPY scripts/ ./scripts/
COPY skills/ ./skills/

# Create data directory for persistent storage
RUN mkdir -p /data/gstdbot && mkdir -p /app/data

# ─── Environment ─────────────────────────────────────
ENV NODE_ENV=production
ENV GSTD_API_PORT=8080
ENV SWARM_ENABLED=true
ENV GSTD_MEMORY=true
ENV GSTD_DATA_DIR=/data/gstdbot

# ─── Expose & Health ─────────────────────────────────
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1

# ─── Labels ──────────────────────────────────────────
LABEL org.opencontainers.image.title="GSTD Node OS"
LABEL org.opencontainers.image.description="Sovereign AI Node — earn GSTD by processing AI queries"
LABEL org.opencontainers.image.url="https://gstdbot.gstdtoken.com"
LABEL org.opencontainers.image.source="https://github.com/gstdcoin/gstdbot"
LABEL org.opencontainers.image.version="3.4.0"
LABEL org.opencontainers.image.vendor="GSTD"

ENV NODE_OPTIONS="--no-deprecation"

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
