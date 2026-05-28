# GSTD Node OS — Development Guide

## Stack
- **Language**: TypeScript (Node.js 20)
- **P2P**: libp2p
- **Platform**: Registers/heartbeats to `https://app.gstdtoken.com/api/v1/`
- **Docker**: Multi-arch (amd64 + arm64), published to Docker Hub as `goldenbit/gstd-node`

## Local Dev
```bash
npm install
npm run dev
# Dashboard at http://localhost:8080
```

## Key env vars
```
GSTD_SWARM_URL=https://app.gstdtoken.com
GSTD_WALLET_ADDRESS=EQ...
NODE_NAME=my-node
```

## CI/CD
- `ci.yml` — TypeScript check + tests on every push (uses node_modules/.bin/tsc, not global npx)
- `docker.yml` — builds + pushes multi-arch Docker image to GHCR (ghcr.io/gstdcoin/gstd-node) on main/tags

## Task loop
1. Node registers at startup → `POST /api/v1/nodes/register`
2. Heartbeat every 8 min → `POST /api/v1/nodes/heartbeat`
3. Poll tasks → `GET /api/v1/tasks/poll` (every 5s)
4. Complete task + report earnings → `POST /api/v1/tasks/complete`

## DO NOT
- Do not change GSTD_SWARM_URL to api.gstdtoken.com — that backend doesn't exist
- Do not skip the heartbeat — nodes expire after 10 min without one
