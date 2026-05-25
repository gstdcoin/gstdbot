# GSTD Node OS

> Run a node. Earn tokens. Own the network.  
> Open-source software that turns any computer into a revenue-generating node in the GSTD decentralized AI + blockchain network.

[![Version](https://img.shields.io/badge/version-3.5.0-8b5cf6)](https://github.com/gstdcoin/gstdbot/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-22c55e)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-06b6d4)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](https://github.com/gstdcoin/gstdbot)

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

---

## Why Run a Node?

| You provide | The network pays you |
|---|---|
| AI inference (served via GSTD network) | GSTD tokens per task |
| Blockchain node hosting (TON, XRPL, ETH…) | 85% of RPC revenue |
| Compute for bridge validation | Share of bridge fees |
| Storage shards | GSTD per GB/month |
| Uptime (just stay online) | GSTD uptime rewards |

**The more you contribute, the more you earn. There is no ceiling.**

No external AI API keys required — all inference is routed through the GSTD node network itself.

---

## Architecture

```
Your Hardware
├── AI Engine          — serves inference tasks via the GSTD network protocol
├── Swarm Agent        — polls priority task queue, processes jobs, reports completion
├── P2P Mesh           — libp2p (mDNS + Bootstrap), direct node-to-node comms
├── NaaS Orchestrator  — auto-deploys blockchain nodes via Docker based on RAM
├── Bridge Sidecar     — optional cross-chain bridge validator (gstd-bridge)
├── Collective Memory  — shared knowledge base (L1 map + L2 Redis + L3 platform)
├── Wallet Manager     — TON wallet, earnings tracker, staking interface
├── Dashboard          — web UI at localhost:8080 (PIN-protected)
├── Telegram Bot       — remote node management via Telegram
└── Security Layer     — AES-256, brute-force lockout, SSH hardening
```

---

## What Runs Automatically

### AI Inference
Your node polls `app.gstdtoken.com/api/v1/tasks/poll` every 5 seconds for priority inference tasks. When a task arrives (type: `inference`), the node processes it using the configured AI backend and posts the result back to the platform. The result is returned to the requesting client within seconds.

All inference is served through the GSTD network — no external AI provider accounts or API keys required.

### Node-as-a-Service (NaaS)
Based on your hardware, the node auto-deploys blockchain infrastructure via Docker:

| Chain | Min RAM | What you earn |
|---|---|---|
| XRPL liteserver | 2 GB | XRP RPC fees |
| TON liteserver | 4 GB | TON RPC fees |
| Solana RPC | 16 GB | SOL RPC fees |
| Ethereum full node | 32 GB | ETH RPC fees |
| Bitcoin node | 8 GB | BTC RPC fees |

### P2P Mesh
Nodes discover each other via mDNS (LAN) and bootstrap peers (WAN). Once connected, tasks can route directly between nodes — no platform roundtrip. The mesh self-heals: if a node goes offline, tasks reroute automatically.

---

## Earning Tiers

The longer you run, the higher your tier and the higher your reward multiplier:

| Tier | Uptime | Multiplier |
|---|---|---|
| Bronze | 0–48h | 1.0× |
| Silver | 48–168h | 1.2× |
| Gold | 168–336h | 1.5× |
| Platinum | 336–720h | 2.0× |
| Diamond | 720h+ | 3.0× |

---

## Quick Start

### Automatic Install (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

### Manual Install

```bash
git clone https://github.com/gstdcoin/gstdbot
cd gstdbot
npm install --legacy-peer-deps
cp .env.example .env
nano .env   # set your node ID and optional Telegram token
npm start
```

### Docker

```bash
docker run -d \
  -e GSTD_API_URL=https://app.gstdtoken.com/api/v1 \
  -p 8080:8080 \
  --name gstdbot \
  ghcr.io/gstdcoin/gstdbot:latest
```

Open `http://localhost:8080` to see your dashboard.

---

## Configuration

Copy `.env.example` to `.env` and set:

```env
# Optional — auto-generated on first run
GSTD_NODE_ID=
GSTD_API_URL=https://app.gstdtoken.com/api/v1

# P2P (optional — mDNS works on LAN without this)
GSTD_P2P_PORT=4001
GSTD_P2P_ANNOUNCE_IP=1.2.3.4   # Your public IP (for WAN discovery)

# NaaS (requires Docker)
GSTD_NAAS_ENABLED=true

# Telegram management (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=
```

No external AI API keys are needed. Inference is served entirely through the GSTD node network.

---

## Source Structure

```
src/
├── index.ts                # Boot sequence
├── core/
│   ├── platform-link.ts    # Heartbeat + registration with Vercel API
│   └── scheduler.ts        # Cron-style task scheduler
├── swarm/
│   ├── agent.ts            # Task polling, processing, earnings, latency tracking
│   ├── orchestrator.ts     # Multi-node load balancing
│   └── sovereign.ts        # Staking, P2P mesh, governance
├── p2p/
│   └── node.ts             # libp2p (mDNS + Bootstrap + Gossip)
├── naas/
│   ├── hardware_profiler.ts # Detect available hardware → select chains
│   ├── orchestrator.ts     # Docker container lifecycle
│   └── revenue_flywheel.ts # Track NaaS earnings
├── gateway/
│   ├── router.ts           # NeuralRouter — all inference via GSTD network
│   └── server.ts           # Express API + WebSocket dashboard
├── wallet/
│   └── manager.ts          # TON wallet, staking, earnings ledger
├── memory/
│   └── collective.ts       # Shared knowledge (L1+L2+L3)
└── channels/
    └── telegram.ts         # Telegram bot — AI chat via GSTD network
```

---

## How Nodes Work Together

```
                    app.gstdtoken.com  (Vercel + Upstash Redis)
                    ┌──────────────────────────────────────────┐
                    │  Node Registry (KV)                      │
                    │  Priority Task Queue (KV per node)       │
                    │  Task Results (KV with TTL)              │
                    │  Stats + Network Info                    │
                    └──────────────┬───────────────────────────┘
                                   │  HTTPS REST API
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
       Node A                  Node B                   Node C
      AI Inference           NaaS Docker             GPU Compute
      ┌──────────┐           ┌──────────┐            ┌──────────┐
      │   P2P    │◄─────────►│   P2P    │◄──────────►│   P2P    │
      └──────────┘           └──────────┘            └──────────┘
           ▲                      ▲                       ▲
           │                      │                       │
         Users  ─────────────────────────────────────►  DApps
                    (tasks routed to best available node)
```

1. Node registers with platform on startup
2. Heartbeats every 8 minutes — reports load, latency, capabilities
3. Polls priority task queue every 5 seconds
4. Processes task (AI inference / compute / storage)
5. Posts result back to platform — client receives it in seconds
6. P2P mesh enables direct routing for low-latency tasks

---

## Supported AI Models

The node serves inference for any model it has available:

| Model | Notes |
|---|---|
| `llama-3.3-70b-versatile` | Default — maps from `gpt-4`, `gpt-4o`, `auto` |
| `llama-3.1-8b-instant` | Fast — maps from `gpt-3.5-turbo` |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Latest Llama 4 |
| `qwen/qwen3-32b` | Strong reasoning |
| `moonshotai/kimi-k2-instruct` | Long context |
| `openai/gpt-oss-120b` | Large |
| `openai/gpt-oss-20b` | Balanced |
| `mixtral-8x7b-32768` | Fast, large context |

Model availability is reported in the node's heartbeat. The platform routes each request to the best node that supports the requested model.

---

## Ecosystem

| Repo | Description |
|---|---|
| [gstdcoin/contracts](https://github.com/gstdcoin/contracts) | TON smart contracts — token, DAO, settlement |
| [gstdcoin/gstd-bridge](https://github.com/gstdcoin/gstd-bridge) | Cross-chain bridge validators (Rust) |
| [gstdcoin/ai](https://github.com/gstdcoin/ai) | Dashboard + Vercel serverless API |
| [gstdcoin/web](https://github.com/gstdcoin/web) | Landing page |
| **gstdcoin/gstdbot** | **Node OS (this repo)** |

---

## Contributing

This is an open-source project built by the community for the community. Any contribution helps — code, docs, translations, running a node.

1. Fork the repo
2. Make your changes
3. Open a PR — describe what you changed and why
4. The community reviews and merges

---

## License

Apache 2.0 — use it, modify it, build on it. The only thing we ask is to keep it open.
