# 🐝 GSTD Node — Your Device is the Supercomputer

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20WSL%20%7C%20Docker-lightgrey.svg)]()

**GSTD Node** is a complete platform client that transforms any device into a sovereign AI node. One command install. Built-in wallet, chat, dashboard, and Swarm networking. Earn GSTD tokens by sharing your compute power.

> **Not just a bot — a full platform client.** Install once, get everything: AI chat with 8 models, TON wallet, local dashboard, signal monitor, and swarm node engine.

🌐 **Website:** [gstdbot.gstdtoken.com](https://gstdbot.gstdtoken.com)
📡 **Monitor:** [monitor.gstdtoken.com](https://monitor.gstdtoken.com)
🤖 **Telegram:** [@GstdAppBot](https://t.me/GstdAppBot)
📊 **Dashboard:** [app.gstdtoken.com](https://app.gstdtoken.com)

---

## ⚡ One-Line Install

```bash
curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
```

Supports: 🐧 Linux · 🍎 macOS · 🪟 Windows (WSL) · 🐳 Docker · 🔧 ARM / Raspberry Pi

---

## 📦 What's Inside

| Component                      | Description                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- |
| 🤖 **AI Chat**                 | 8 Groq models. Factuality prompt + Knowledge cache. Web + Telegram + terminal |
| 🧠 **Collective Intelligence** | SmartMix: 3/5/7 models in parallel → consensus synthesis                      |
| 💰 **Wallet**                  | TON wallet auto-generated. Receive/send GSTD tokens. Telegram Stars → GSTD    |
| 📊 **Dashboard**               | Real-time system monitor at `localhost:8080`                                  |
| 🌐 **Swarm Node**              | Auto-joins network, processes tasks, earns 24/7                               |
| 🔒 **TEE Compute**             | Hardware-encrypted GPU enclaves for privacy                                   |
| 📡 **Signal Monitor**          | Track 29 planetary signals, sponsor research                                  |
| 🛠️ **Skills**                  | Extensible skill marketplace (7 built-in)                                     |
| 🔌 **API Server**              | OpenAI-compatible API gateway                                                 |
| 📚 **Knowledge Cache**         | Redis-backed shared cache between web chat & Telegram (24h TTL)               |

---

## 🚀 Quick Start

### Option A: Auto Installer (recommended)

```bash
curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
```

### Option B: npm

```bash
npm install -g gstdbot
gstdbot onboard
```

### Option C: From Source

```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot && npm install && npm run build && npm link
gstdbot onboard
```

### Option D: Docker

```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
cp .env.example .env   # edit NODE_NAME, WALLET_SEED
docker compose up -d
```

### Option E: Quick Docker

```bash
docker run -d --name gstd-node \
  -p 8080:8080 -p 11434:11434 \
  -v gstd-data:/data \
  ghcr.io/gstdcoin/gstd-node:latest
```

---

## 🖥️ CLI Reference

```
gstdbot                  # Interactive chat (default)
gstdbot send "message"   # One-shot message
gstdbot onboard          # Setup wizard (node name, wallet, resources)
gstdbot gateway          # Start API server + dashboard (localhost:8080)
gstdbot status           # System status
gstdbot doctor           # Diagnose issues

# Wallet
gstdbot wallet init      # Create or import TON wallet
gstdbot wallet balance   # Check GSTD & TON balance
gstdbot wallet send      # Send GSTD tokens
gstdbot wallet link      # Link Telegram for Stars payments

# Swarm Node
gstdbot swarm join       # Join as compute node (earn GSTD)
gstdbot swarm status     # Network status & earnings
gstdbot swarm stop       # Pause node

# Skills
gstdbot skills list      # Browse marketplace
gstdbot skills install X # Install a skill
gstdbot skills scan file # Security scan
gstdbot skills create N  # Create a new skill

# Advanced
gstdbot sovereignty      # Show sovereignty index
gstdbot config           # Edit configuration
gstdbot logs             # View node logs
```

---

## 💰 Earn GSTD Tokens

Turn your device into a compute node and earn GSTD tokens for processing AI tasks.

```bash
gstdbot swarm join
```

```
╔═══════════════════════════════════════════╗
║   🐝 GSTD Node — Sovereign AI Client     ║
╚═══════════════════════════════════════════╝

  ✓ Hardware detected
    CPU:    AMD Ryzen 9 (16 cores)
    RAM:    64.0 GB
    GPU:    ✓ NVIDIA RTX 4090 (24GB)
    Ollama: ✓ Running
    Models: llama3.1:8b, qwen2.5-coder:7b

  ✓ Wallet: UQ...a3b8 (142.5 GSTD)
  ✓ Node ID: a3b8d1b6-...
  ✓ Registered with GSTD network

  🐝 You are now part of the Swarm!
     Dashboard: http://localhost:8080
     Earning:   ~500 GSTD/day (estimated)
```

### Earnings by Hardware

| Tier           | Hardware                    | Estimated        |
| -------------- | --------------------------- | ---------------- |
| 🟢 Minimum     | 2 cores / 4 GB / no GPU     | ~50 GSTD/day     |
| 🔵 Recommended | 4+ cores / 16 GB / 8GB GPU  | ~500 GSTD/day    |
| 🟣 Power Node  | 8+ cores / 64 GB / 24GB GPU | ~5,000+ GSTD/day |

---

## 📊 Dashboard

The built-in dashboard runs at `http://localhost:8080` and provides:

- **System Monitor**: CPU/GPU/RAM usage in real-time
- **Task Queue**: Active and completed AI tasks
- **Earnings Tracker**: GSTD earned, pending, sent
- **Wallet Manager**: Balance, transactions, staking
- **Network Stats**: Swarm health, peers, sovereignty index
- **Signal Feed**: 29 planetary signals with live progress

---

## 🔌 API Server (OpenAI-compatible)

```bash
gstdbot gateway --port 8080
```

### Endpoints

| Method | Path                   | Description            |
| ------ | ---------------------- | ---------------------- |
| GET    | `/v1/models`           | List available models  |
| POST   | `/v1/chat/completions` | Chat (OpenAI format)   |
| GET    | `/health`              | Health check           |
| GET    | `/sovereignty`         | Sovereignty index      |
| GET    | `/v1/node/status`      | Node status + earnings |
| GET    | `/v1/wallet/balance`   | Wallet balance         |

### Example

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gstd-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## 🏗️ Architecture

```
gstdbot/
├── src/
│   ├── index.ts              # Main entry point
│   ├── agent/
│   │   └── agent.ts          # Core agent runtime (SOUL, memory, skills)
│   ├── gateway/
│   │   ├── server.ts         # Omega Gateway (API + WebSocket + Dashboard)
│   │   ├── router.ts         # Neural Router (Groq-only, 8 models, stripThinkTags)
│   │   └── sessions.ts       # Session management
│   ├── wallet/
│   │   └── wallet.ts         # TON wallet integration
│   ├── dashboard/
│   │   └── server.ts         # Local dashboard web server
│   ├── channels/
│   │   ├── telegram.ts       # Telegram bot (Factuality + Redis Cache + SmartMix)
│   │   └── guardian.ts       # Community Guardian (anti-spam, group moderation)
│   ├── skills/
│   │   └── marketplace.ts    # Skills engine + malware scanner
│   ├── swarm/
│   │   └── client.ts         # Swarm network client + earnings
│   ├── config/
│   │   └── index.ts          # Configuration management
│   └── cli/
│       └── index.ts          # CLI interface
├── skills/                    # Built-in skills (7)
├── web/                       # Landing page
├── scripts/
│   └── install.sh             # One-line installer
├── docker-compose.yml         # Full-stack Docker setup
├── Dockerfile
└── README.md
```

### Neural Router — Routing Hierarchy

```
User Message
    │
    ├─ L0: Redis Knowledge Cache (instant, shared with web chat)
    ├─ L1: Memory Cache (5 min TTL)
    ├─ L2: Direct Groq (if user selected specific model)
    ├─ L3: Go Backend (SmartRouter → Ollama → Phantom Nodes)
    ├─ L4: Groq Cascade (try all 8 models sequentially)
    └─ L5: Fallback message
```

### AI Models (Groq — all free)

| Model               | ID                                              | Specialty                       |
| ------------------- | ----------------------------------------------- | ------------------------------- |
| 🦙 Llama 3.3 70B    | `llama-3.3-70b-versatile`                       | General knowledge, reasoning    |
| ⚡ Llama 3.1 8B     | `llama-3.1-8b-instant`                          | Fast concise answers            |
| 🔭 Llama 4 Scout    | `meta-llama/llama-4-scout-17b-16e-instruct`     | Multi-expert architecture       |
| 🚀 Llama 4 Maverick | `meta-llama/llama-4-maverick-17b-128e-instruct` | Creative reasoning, 128 experts |
| 🐉 Qwen3 32B        | `qwen/qwen3-32b`                                | Mathematical, analytical        |
| 🧠 GPT-OSS 120B     | `openai/gpt-oss-120b`                           | Large-scale reasoning           |
| 💡 GPT-OSS 20B      | `openai/gpt-oss-20b`                            | Efficient reasoning             |
| 🌙 Kimi K2          | `moonshotai/kimi-k2-instruct`                   | Long-context reasoning          |

### Collective Intelligence (SmartMix)

| Tier        | Experts | Cost       | Strategy                      |
| ----------- | ------- | ---------- | ----------------------------- |
| 🆓 Free     | 1       | 0 GSTD     | Single model                  |
| 🔬 Standard | 3       | ~3.4 GSTD  | Council + consensus           |
| 🔥 Pro      | 5       | ~10.2 GSTD | Panel + cross-verification    |
| 🧠 Ultra    | 7       | ~17 GSTD   | Full swarm + reasoning chains |

### Platform Parity: Web Chat ↔ Telegram Bot

| Feature                        | Web Chat | Telegram Bot            |
| ------------------------------ | -------- | ----------------------- |
| 8 Groq models                  | ✅       | ✅                      |
| Factuality System Prompt       | ✅       | ✅                      |
| Redis Knowledge Cache (shared) | ✅       | ✅                      |
| Strip `<think>` tags (Qwen3)   | ✅       | ✅                      |
| SmartMix (3/5/7 experts)       | ✅       | ✅                      |
| Model selection                | ✅       | ✅ `/model`             |
| SSE Streaming                  | ✅       | — (Telegram limitation) |
| Telegram Stars → GSTD          | —        | ✅                      |
| TON wallet linking             | —        | ✅                      |

---

## ⚙️ Configuration

Config is stored in `~/.config/gstdbot/config.json`:

```json
{
  "nodeName": "my-node",
  "wallet": {
    "address": "UQ...",
    "seed": "encrypted:..."
  },
  "swarm": {
    "enabled": true,
    "maxCPU": 80,
    "maxRAM": 70,
    "gpuMode": "auto"
  },
  "models": ["llama3.1:8b"],
  "dashboard": {
    "port": 8080,
    "enabled": true
  },
  "telegram": {
    "linkedUserId": null
  }
}
```

---

## 💻 System Requirements

|          | Minimum       | Recommended   | Power Node   |
| -------- | ------------- | ------------- | ------------ |
| **CPU**  | 2 cores       | 4+ cores      | 8+ cores     |
| **RAM**  | 4 GB          | 16 GB         | 64 GB        |
| **Disk** | 20 GB         | 100 GB SSD    | 500 GB NVMe  |
| **GPU**  | Not required  | NVIDIA 8GB+   | NVIDIA 24GB+ |
| **OS**   | Ubuntu 20.04+ | Ubuntu 22.04+ | Any Linux    |

**Supported**: Intel/AMD/ARM · Ubuntu/Debian/Fedora/macOS/Windows WSL · Raspberry Pi 4+ · NVIDIA CUDA 11.7+

---

## 🔐 Security

- All local data encrypted at rest
- Wallet seed protected with OS keychain
- Skills sandboxed + malware scanned
- TEE (Trusted Execution Environment) for confidential compute
- No data leaves device without explicit consent
- Open source — verify everything

### Responsible Disclosure

Security issues → security@gstdtoken.com

---

## 🛠️ Development

```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
npm install
npm run dev          # Watch mode
npm run build        # Production build
npm test             # Run tests
npm run lint         # Lint
```

---

## 🔗 Links

- 🌐 [Website](https://gstdbot.gstdtoken.com)
- 📡 [Signal Monitor](https://monitor.gstdtoken.com)
- 📊 [Dashboard](https://app.gstdtoken.com)
- 💬 [Web Chat](https://chat.gstdtoken.com)
- 🤖 [Telegram Bot](https://t.me/GstdAppBot)
- 📖 [API Docs](https://gstdbot.gstdtoken.com/v1/models)

---

## 📄 License

Apache 2.0 — see [LICENSE](LICENSE)
