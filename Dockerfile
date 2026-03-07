# ═══════════════════════════════════════════════════════
# GSTD Node OS — Dockerfile
# Multi-stage build: compile TypeScript → run minimal
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

# Install system dependencies
RUN apk add --no-cache curl git bash

# Copy built files
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./package.json

# Copy web dashboard
COPY web/ ./web/
COPY scripts/ ./scripts/
COPY skills/ ./skills/ 2>/dev/null || true

# Default environment
ENV NODE_ENV=production
ENV GSTD_DASHBOARD_PORT=8080
ENV GSTD_API_PORT=18789
ENV SWARM_ENABLED=true
ENV GSTD_MEMORY=true

# Expose ports
EXPOSE 8080 18789

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -sf http://localhost:8080/health || exit 1

# Start GSTD Node OS
CMD ["node", "dist/index.js"]
