# GSTD Node OS

> Source-available node software for the GSTD AI + TON network.  
> Status: **early-stage / pre-production**. Rewards are not guaranteed and depend on real network activity; there are currently no real payouts from the sovereign core (simulated only).

[![Version](https://img.shields.io/badge/version-3.5.0-8b5cf6)](https://github.com/gstdcoin/gstdbot/releases)
[![License](https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-orange)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-06b6d4)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Claude%20Code-7c3aed)](https://github.com/gstdcoin/gstdbot/tree/main/mcp)
[![GSTD Network](https://app.gstdtoken.com/badge.svg)](https://gstdtoken.com)

## ⚡ MCP Server for Claude Code

Run Llama 3, Mistral, CodeLlama, Qwen, DeepSeek and **50+ open-source models** directly from Claude Code — free, no API key.

```bash
claude mcp add --transport http gstd https://app.gstdtoken.com/mcp
```

→ [Full MCP documentation](https://github.com/gstdcoin/gstdbot/tree/main/mcp)

---

## Run a Node

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

---

## What a node can contribute

| You provide | Intended compensation (not guaranteed) |
|---|---|
| AI inference (served via GSTD network) | GSTD per accepted task, when tasks exist |
| Blockchain node hosting (TON, XRPL, ETH…) | Share of RPC revenue (experimental, behind `GSTD_NAAS_ENABLED`) |
| Storage shards | Experimental, not production |
| Independent verification of other nodes' results | Share of the task budget (sovereign core, simulated ledger) |

Income depends on real demand; there may be no tasks at a given time. Nothing here is an investment offer or a promise of income. The on-chain split in `contracts/SettlementMaster.tact` is 85% workers / 10% treasury / 5% protocol (source-verified; the deployed bytecode and the owner's `UpdateShares` power are not verified here).

### Sovereign core (new, experimental)

`src/sovereign/` is a self-contained, centrally-independent task/verification/ledger layer: signed envelopes, gossip over direct HTTP between nodes, deterministic accrual accounting, and no calls to any platform, Cloudflare or Telegram endpoint. It is covered by real multi-process tests (`npm run test:sovereign`). See [docs/SOVEREIGN_NETWORK_AUDIT.md](docs/SOVEREIGN_NETWORK_AUDIT.md) for what is and is not proven.

```bash
npm run sovereign -- --data-dir ./.sov --port 7701 --roles data,verify --peers http://<other-node>:7701
# MCP server (stdio) for AI agents, talking to a running node
npm run sovereign:mcp -- --node http://127.0.0.1:7701
```

The rest of the node (gateway, swarm agent, dashboard, Telegram) still uses the central platform; see [CENTRAL_DEPENDENCIES.md](CENTRAL_DEPENDENCIES.md).

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
├── Wallet Manager     — TON wallet, earnings tracker
├── Dashboard          — web UI at localhost:8080 (PIN-protected)
├── Telegram Bot       — remote node management via Telegram
└── Security Layer     — AES-256, brute-force lockout, SSH hardening
```

---

## What Runs Automatically

### AI Inference
Your node sends a heartbeat with its wallet address every 2 minutes and polls `app.gstdtoken.com/api/v1/tasks/poll` every 5 seconds using `POST` with its `X-Wallet-Address` header. When an inference task arrives, the node runs it through local Ollama and submits a non-empty result to `POST /api/v1/tasks/complete`. Failed or empty inference results are not submitted as completed tasks.

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
Nodes discover each other directly via libp2p — mDNS (LAN) and a Kademlia DHT (WAN), with the platform's node registry as an explicit last-resort fallback only used when P2P discovery finds nothing. Once connected, tasks can route directly between nodes — no platform roundtrip. The mesh self-heals: if a node goes offline, tasks reroute automatically. WAN-wide DHT bootstrap needs a stable seed address — see `src/p2p/node.ts` for the current status of that rollout.

---

## Hardware Tiers

Node tier is determined by hardware capability (hardware multiplier), not uptime. More powerful hardware unlocks more modules. Bonus percentages below are design parameters, not guaranteed earnings:

| Tier | Hardware Multiplier | Max Modules | Earnings Bonus |
|---|---|---|---|
| ⚡ Spark | ×0–0.75 | 2 | +0% |
| 🔥 Flame | ×0.75–1.5 | 4 | +5% |
| ⛈️ Storm | ×1.5–2.5 | 6 | +15% |
| 🏔️ Titan | ×2.5–4.0 | 8 | +30% |
| 👑 Sovereign | ×4.0+ | Unlimited | +50% |

The hardware multiplier is calculated from CPU cores, RAM, disk, and GPU presence. A Raspberry Pi 4 is typically Spark or Flame; a 32-core server with GPU reaches Titan or Sovereign.

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
nano .env   # set your node ID and GSTD_DASHBOARD_SETUP_TOKEN
npm start
```

### Docker

For a fresh node, set a one-time dashboard setup token before starting it. Generate
one with `openssl rand -hex 32`, keep it private, and enter it in the dashboard's
first-setup prompt. Remove the token from the container environment after setup.

```bash
docker run -d \
  -e GSTD_API_URL=https://app.gstdtoken.com/api/v1 \
  -e GSTD_WALLET_ADDRESS=YOUR_TON_WALLET \
  -e GSTD_DASHBOARD_SETUP_TOKEN=YOUR_RANDOM_64_CHARACTER_HEX_TOKEN \
  -p 8080:8080 \
  --name gstd-node \
  ghcr.io/gstdcoin/gstd-node:latest
```

Open `http://localhost:8080` to see your dashboard.
Initial PIN setup is disabled until `GSTD_DASHBOARD_SETUP_TOKEN` is configured.
Existing PIN-based logins do not require this token.

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
│   ├── platform-link.ts    # Heartbeat + registration with Cloudflare Worker platform
│   └── scheduler.ts        # Cron-style task scheduler
├── swarm/
│   ├── agent.ts            # Task polling, processing, earnings, latency tracking
│   ├── orchestrator.ts     # Multi-node load balancing
│   └── sovereign.ts        # P2P mesh, governance, node economics
├── training/
│   ├── federated.ts        # Experimental trainer — API execution is paused
│   ├── aggregator.ts       # FedAvg gradient aggregation
│   ├── specialization.ts   # Domain specialization tracking (EMA)
│   ├── thermal-router.ts   # Experimental training peer routing (paused)
│   ├── health.ts           # Node health self-diagnostics + autonomy level
│   └── offline-queue.ts    # SQLite offline task queue (network resilience)
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
│   └── manager.ts          # TON wallet, earnings ledger
├── memory/
│   └── collective.ts       # Shared knowledge (L1+L2+L3)
└── channels/
    └── telegram.ts         # Telegram bot — AI chat via GSTD network
```

---

## How Nodes Work Together

Peer discovery (how a node finds other nodes to route tasks to directly) and
the task queue (how the platform assigns priority inference jobs to a node)
are two separate systems. Peer discovery is P2P-first as of the
decentralized-discovery work — DHT/mDNS between nodes, with the platform's
node registry only consulted as a last resort. The priority task queue below
is unrelated to peer discovery and still runs through the platform as
described.

```
                    app.gstdtoken.com  (Cloudflare Worker + KV)
                    ┌───────────────────────────────────────┐
                    │ Node Registry (KV) -- P2P last resort │
                    │ Priority Task Queue (KV per node)     │
                    │ Task Results (KV with TTL)            │
                    │ Stats + Network Info                  │
                    └──────────────┬────────────────────────┘
                                   │  HTTPS REST API
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
       Node A                  Node B                   Node C
      AI Inference           NaaS Docker             GPU Compute
      ┌──────────┐           ┌──────────┐            ┌──────────┐
      │   P2P    │◄─────────►│   P2P    │◄──────────►│   P2P    │
      └──────────┘  DHT/mDNS └──────────┘  DHT/mDNS   └──────────┘
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

## What is different

GSTD combines several node roles in one codebase. Status of each, honestly:

| Feature | Status |
|---|---|
| AI inference routing (ThermalRouter) | Implemented in the legacy gateway; relies on the central platform for discovery/tasks |
| Sovereign verified-task core | Implemented and multi-process tested locally (`src/sovereign/`); no real payouts |
| Federated fine-tuning | Paused pending isolated worker sandboxing |
| Blockchain NaaS | Experimental, behind `GSTD_NAAS_ENABLED` |
| Any hardware (phone/Pi/laptop/server) | Roles are suggested by hardware; weak devices get verify/relay roles. Not yet validated on real Raspberry Pi hardware |
| One-command install | `install.sh` |

**Key components:**

- **ThermalRouter** — routes inference requests by an entropy-based score over node capacity. No benchmark against other networks has been published; no comparative claims are made.

- **MetaCognitive quality gating (research only)** — the distributed fine-tuning marketplace is paused. New jobs, gradients, peer registration, and training task dispatch are disabled until isolated worker sandboxing and settlement verification are implemented.

- **Any hardware** — hardware is detected and roles/modules are matched to it. A GPU is not required for verification or relay roles.

---

## Ecosystem

| Repo | Description |
|---|---|
| [gstdcoin/contracts](https://github.com/gstdcoin/contracts) | TON smart contracts — token, DAO, settlement |
| [gstdcoin/gstd-bridge](https://github.com/gstdcoin/gstd-bridge) | Cross-chain bridge validators (Rust) |
| [gstdcoin/ai](https://github.com/gstdcoin/ai) | Dashboard + Cloudflare Worker platform API |
| [gstdcoin/web](https://github.com/gstdcoin/web) | Landing page |
| **gstdcoin/gstdbot** | **Node OS (this repo)** |

---

## Contributing

This is a community-driven, source-available project. Any contribution helps — code, docs, translations, running a node.

1. Fork the repo
2. Make your changes
3. Open a PR — describe what you changed and why
4. The community reviews and merges

---

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE), with an additional permission for taking part in the GSTD network (including receiving GSTD rewards). Commercial use by companies needs a separate license. Bundled third-party skills and models keep their own licenses.
