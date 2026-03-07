# 🐝 GSTD Node OS

> **Sovereign AI Platform** — Like Umbrel, but for AI swarm computing.  
> Run AI models, earn GSTD tokens, join the collective intelligence network.

[![Version](https://img.shields.io/badge/version-3.1.0-8b5cf6)](https://github.com/gstdcoin/gstdbot/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-22c55e)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-06b6d4)](https://nodejs.org)

```
curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
```

---

## 🏗 Architecture

```
Your Hardware
├── 📊 Dashboard (localhost:8080) — full node control panel
├── 🤖 AI Engine — 8 Groq models + local Ollama
├── 🌐 Swarm Agent — P2P task processing → earn GSTD
├── 🧠 Collective Memory — Redis + ChromaDB, shared knowledge
├── 💰 GSTD Wallet — TON-based, earnings tracker
├── 📦 App Manager — Docker-based apps (like Umbrel)
└── 💬 Channels — Telegram bot + Web chat
```

## ✨ Key Features

| Feature                  | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| **🌐 Swarm Network**     | Nodes form a P2P network, share AI tasks, earn tokens      |
| **🧠 Collective Memory** | Answer found by one node → available to all                |
| **💰 GSTD Tokens**       | Earn for uptime, AI tasks, verification, storage           |
| **🤖 8 AI Models**       | Llama 3.3, Llama 4 Scout/Maverick, Qwen3, GPT-OSS, Kimi K2 |
| **🔬 SmartMix**          | 3-7 models reach consensus for verified answers            |
| **📊 Control Panel**     | Real-time CPU/RAM/GPU/Disk, wallet, tasks, controls        |
| **📦 App Store**         | Docker-based apps: Chat, Monitor, Files, Knowledge         |
| **🔒 Sovereign**         | Your data stays on your hardware. Open source.             |

## 🚀 Quick Start

### One-line install

```bash
curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
```

### Docker Compose

```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
cp .env.example .env   # Edit with your keys
docker compose up -d
```

### Manual

```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
npm install --legacy-peer-deps
npx tsc
node dist/index.js
```

After starting, open **http://localhost:8080** for the control panel.

## 💰 Earning GSTD Tokens

| Action                 | Reward     |
| ---------------------- | ---------- |
| Node uptime (1 hour)   | 0.1 GSTD   |
| AI inference task      | 0.5-5 GSTD |
| Embedding/indexing     | 0.2 GSTD   |
| Data storage (1GB/day) | 0.05 GSTD  |
| Answer verification    | 0.1 GSTD   |
| SmartMix consensus     | 1-10 GSTD  |

## 🧠 Collective Memory

Three-layer knowledge system:

- **L1 — In-Memory** (instant, node-local, 24h TTL)
- **L2 — Redis** (shared across services, 7-day TTL)
- **L3 — Platform API** (global swarm, verified facts)

When a node answers with high confidence → cached and shared with all nodes.

## 📦 Built-in Apps

| App                 | Description                     | Port  |
| ------------------- | ------------------------------- | ----- |
| 💬 AI Chat          | Multi-model chat with SmartMix  | :3000 |
| 📊 Network Monitor  | Real-time swarm stats           | :3001 |
| 📁 File Manager     | Local + IPFS storage            | :3002 |
| 💰 Wallet Dashboard | Earnings, staking, transactions | :3003 |
| 🧠 Knowledge Base   | Browse collective memory        | :3004 |

## 🆚 vs Umbrel

|          | Umbrel                  | **GSTD Node OS**                         |
| -------- | ----------------------- | ---------------------------------------- |
| Focus    | Home cloud server       | AI Swarm + Token economy                 |
| AI       | Single model (OpenClaw) | **8 models + SmartMix consensus**        |
| Network  | Isolated                | **P2P Swarm** — nodes amplify each other |
| Memory   | Local files             | **Collective Memory** — shared knowledge |
| Income   | None                    | **GSTD tokens** for tasks                |
| Hardware | $699 Umbrel Pro         | **$0** — any Linux/Mac/RPi               |
| License  | PolyForm Noncommercial  | **Apache 2.0**                           |

## 📡 Links

- 🌐 **Landing**: [gstdbot.gstdtoken.com](https://gstdbot.gstdtoken.com)
- 🤖 **Telegram**: [@GstdAppBot](https://t.me/GstdAppBot)
- 💬 **Web Chat**: [chat.gstdtoken.com](https://chat.gstdtoken.com)
- 📊 **Monitor**: [monitor.gstdtoken.com](https://monitor.gstdtoken.com)
- 🏠 **Dashboard**: [app.gstdtoken.com](https://app.gstdtoken.com)

## 📝 License

Apache 2.0 — Free for personal and commercial use.
