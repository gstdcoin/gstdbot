# 🐝 GSTD Node OS

> **Sovereign AI Platform** — Your Personal Decentralized AI Node.  
> Run AI models, earn GSTD tokens, join the collective intelligence swarm.

[![Version](https://img.shields.io/badge/version-3.4.0-8b5cf6)](https://github.com/gstdcoin/gstdbot/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-22c55e)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-06b6d4)](https://nodejs.org)

```
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

---

## 🏗 Architecture

```
Your Hardware
├── 📊 Dashboard (localhost:8080) — full node control panel with wallet/PIN auth
├── 🤖 AI Engine — 8 Groq models + local Ollama + OpenClaw gateway
├── 🌐 Swarm Agent — P2P task processing → earn GSTD
├── 🧠 Collective Memory — Redis + ChromaDB, shared knowledge across nodes
├── 💰 GSTD Wallet — TON-based, earnings tracker, staking
├── 📦 App Store — 77 apps (11 Premium), Docker-based
├── 🔒 Security — AES-256, wallet auth, brute-force protection, SSH hardening
├── 📱 Telegram Management — remote node control via Telegram bot
├── 🔄 Swarm Orchestrator — load balancing, P2P relay, model distribution
├── 🔐 SSL & DynDNS — Let's Encrypt auto-SSL + 5 DynDNS providers
├── 🩺 Self-Diagnostics — 8 health checks with auto-fix
├── ⚙️ Resource Control — CPU/RAM sharing config + earnings calculator
└── 💬 Channels — Telegram bot + Web chat
```

## ✨ Key Features

| Feature                  | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| **🌐 Swarm Network**     | Nodes form P2P mesh, share AI tasks, distribute load           |
| **🧠 Collective Memory** | Answer found by one node → available to all                    |
| **💰 GSTD Tokens**       | Earn for uptime, AI tasks, verification, storage               |
| **🤖 8 AI Models**       | Llama 3.3/4, Qwen3, GPT-OSS, Kimi K2 — all free via Groq       |
| **🔬 SmartMix**          | 3-7 models reach consensus for verified answers                |
| **📦 77 Apps**           | Browsers, social media, AI tools, DeFi, wallets, TON services  |
| **⭐ Premium Apps**      | 11 premium apps unlocked at 1000 GSTD balance                  |
| **📱 Telegram Control**  | Manage your node remotely via Telegram commands                |
| **🔒 Security**          | AES-256 encryption, rate limiting, sandboxed Docker containers |
| **🔐 Wallet Auth**       | Login with TON wallet — crypto signatures, owner/viewer roles  |
| **🌐 Let's Encrypt SSL** | One-click HTTPS, auto-certificate, works from dashboard        |
| **🔀 Dynamic DNS**       | DuckDNS, No-IP, Dynu, FreeDNS, Cloudflare — built-in           |
| **🩺 Self-Diagnostics**  | 8 auto-checks with auto-fix: disk, memory, Docker, Git, logs   |
| **⚙️ Resource Control**  | Configure CPU/RAM sharing, real-time earnings calculator       |
| **🔄 Live Updates**      | Update core/dashboard/apps individually without data loss      |
| **🔐 2FA PIN Reset**     | Reset dashboard PIN via linked Telegram (6-digit code)         |
| **📊 Control Panel**     | Real-time CPU/RAM/GPU/Disk, wallet, tasks, app launcher        |
| **🔑 SSH Management**    | Read/harden SSH config, system updates — all from dashboard    |
| **🔁 One-Cmd Reinstall** | `bash reinstall.sh` — preserves data, rebuilds from GitHub     |
| **🔷 TON Validator**     | Run validator with 1M GSTD — staking, 12-20% APY, signed TX    |
| **🧠 Model Training**    | Train custom AI on swarm GPUs with 10M GSTD — tokens to nodes  |
| **🏢 Enterprise Swarm**  | Rent swarm compute with 100M GSTD — fault-tolerant, SLA-grade  |

## 💎 Super-Premium Tiers

| Tier                    | Requirement      | Capability                                                |
| ----------------------- | ---------------- | --------------------------------------------------------- |
| 🔷 **TON Validator**    | 1,000,000 GSTD   | Run validator, accept staking, earn 12-20% APY commission |
| 🧠 **Model Training**   | 10,000,000 GSTD  | Train custom AI models on distributed GPU/CPU resources   |
| 🏢 **Enterprise Swarm** | 100,000,000 GSTD | Rent fault-tolerant swarm compute for data centers        |

- **Commission**: 5% platform fee, 95% distributed to participating nodes
- **Security**: All transactions require wallet signature verification
- **Rewards**: Nodes claim rewards on-demand via signed wallet transactions
- **Swarm Memory**: Training results stored in distributed memory, accessible network-wide

## 🚀 Quick Start

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
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

## 📦 App Store (77 apps, 11 ⭐ Premium)

| Category    | Apps | Highlights                                            |
| ----------- | ---- | ----------------------------------------------------- |
| 🤖 AI       | 10   | OpenClaw⭐, Ollama⭐, AI Hub⭐, Stable Diffusion⭐    |
| 🌐 Web      | 4    | Chromium⭐, Firefox⭐, Tor, Web Proxy                 |
| 💬 Social   | 12   | Telegram⭐, Discord⭐, Matrix, Mastodon, WhatsApp, X  |
| 💎 DeFi     | 8    | Tonkeeper⭐, GSTD Swap⭐, Ston.fi, DeDust, Buy Crypto |
| 🛠️ Tools    | 10   | Documents, Spreadsheet, Calendar, Notes, Kanban       |
| 🎬 Media    | 6    | Photo, Music, Reader, Downloader, Video               |
| ☁️ Cloud    | 6    | Drive, Backup, Sync, Git, S3, Database                |
| 🌐 Network  | 6    | VPN, Monitor, TON Liteserver⭐, TON Explorer          |
| 🛡️ Security | 6    | Firewall, IDS, SSL, 2FA, Audit                        |
| ⚙️ System   | 5    | Knowledge, Automation, Terminal, Scheduler, Logs      |
| 💰 Finance  | 4    | Wallet, Mining, Staking, Tracker                      |

⭐ = Premium (requires 1000 GSTD token balance)

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

## 🔒 Security

| Layer             | Protection                                       |
| ----------------- | ------------------------------------------------ |
| Wallet Auth       | TON wallet signature, owner/viewer roles         |
| PIN Auth          | SHA-256 hashed, never stored in plaintext        |
| Rate Limiting     | 120 req/min per IP, auto-block                   |
| Login Protection  | 5 attempts → 15min lockout                       |
| Encryption        | AES-256-CBC with node-unique key                 |
| Docker Sandboxing | no-new-privileges, cap-drop ALL, ro filesystem   |
| SSL / HTTPS       | Auto Let's Encrypt via dashboard                 |
| SSH Hardening     | Disable root login, password auth from dashboard |
| 2FA PIN Reset     | Via linked Telegram, 5min expiry                 |
| Audit Trail       | Immutable log, persisted to file                 |
| Self-Diagnostics  | 8 checks with auto-fix (disk, memory, logs)      |
| Request Signing   | HMAC-SHA256 with timestamp validation            |

## 📱 Telegram Management

Link your Telegram → manage node remotely:

| Command   | Action               |
| --------- | -------------------- |
| `/start`  | Start bot, main menu |
| `/new`    | New conversation     |
| `/model`  | Switch AI model      |
| `/status` | Session status       |
| `/help`   | Help & commands      |

Additional features: 💳 Balance, 💰 Top Up (Telegram Stars), 🔗 Link Wallet, 🧠 Smart Mix, 👥 Community Guardian.

## 🔌 API Reference

All endpoints available at `http://localhost:8080`

### AI Chat

| Method | Endpoint               | Description                  |
| ------ | ---------------------- | ---------------------------- |
| POST   | `/api/v1/chat`         | AI chat (auto model routing) |
| POST   | `/v1/chat/completions` | OpenAI-compatible endpoint   |
| GET    | `/v1/models`           | Available models list        |
| POST   | `/v1/dashboard/chat`   | Quick dashboard AI chat      |
| GET    | `/api/chat/history`    | Chat interaction log         |

### Collective Memory

| Method | Endpoint             | Description            |
| ------ | -------------------- | ---------------------- |
| POST   | `/api/memory/store`  | Store key/value + tags |
| POST   | `/api/memory/recall` | Semantic recall        |
| GET    | `/api/memory/stats`  | Memory module status   |

### AI Training

| Method | Endpoint               | Description            |
| ------ | ---------------------- | ---------------------- |
| GET    | `/api/training/status` | Training module status |
| GET    | `/api/training/jobs`   | Active jobs list       |
| POST   | `/api/training/start`  | Start training job     |

### Resource Sharing

| Method | Endpoint                   | Description                     |
| ------ | -------------------------- | ------------------------------- |
| GET    | `/api/resources/status`    | Module status + meter + pricing |
| GET    | `/api/resources/available` | CPU, RAM, GPU, models           |
| GET    | `/api/resources/meter`     | Usage metering                  |
| GET    | `/api/resources/pricing`   | GSTD pricing per unit           |
| POST   | `/api/resources/request`   | Submit resource request         |

### App Store

| Method | Endpoint              | Description     |
| ------ | --------------------- | --------------- |
| GET    | `/api/apps/available` | 77 apps catalog |
| GET    | `/api/apps/status`    | Installed apps  |
| POST   | `/api/apps/install`   | Install app     |

### Node Control

| Method | Endpoint             | Description                |
| ------ | -------------------- | -------------------------- |
| GET    | `/api/node/status`   | Full node status           |
| GET    | `/api/node/log`      | Activity log               |
| GET    | `/api/node/settings` | Current settings           |
| GET    | `/api/node/config`   | Node configuration         |
| POST   | `/api/node/control`  | Actions: diag, gc, restart |
| GET    | `/api/check-update`  | Check for updates          |

### Wallet Binding

Bind your external TON wallet to collect rewards from multiple nodes.

| Method | Endpoint                   | Description                                            |
| ------ | -------------------------- | ------------------------------------------------------ |
| POST   | `/api/node/bind-wallet`    | Bind your TON wallet (`{owner_wallet: "UQ..."}`)       |
| POST   | `/api/node/unbind-wallet`  | Unbind wallet from this node                           |
| GET    | `/api/node/my-nodes`       | List all nodes bound to your wallet                    |
| GET    | `/api/node/pending-rewards`| Unclaimed rewards for your wallet                      |
| POST   | `/api/node/claim-rewards`  | Claim all pending rewards to your balance              |
| GET    | `/api/node/wallet`         | Full wallet stats + binding status                     |

- **Multiple nodes**: One wallet → unlimited nodes, collect from all
- **Auto-claim**: Rewards older than 90 days auto-credited to your balance
- **Dashboard UI**: Wallet → Wallet Binding section (bind/unbind/claim)

### Remote Access

| Method | Endpoint             | Description                  |
| ------ | -------------------- | ---------------------------- |
| GET    | `/api/remote/status` | Relay, Tor, WireGuard status |
| GET    | `/api/remote/info`   | Access methods               |

### Security & Swarm

| Method | Endpoint                  | Description         |
| ------ | ------------------------- | ------------------- |
| GET    | `/api/security/status`    | Security audit log  |
| GET    | `/v1/swarm/status`        | Swarm connectivity  |
| GET    | `/api/swarm/orchestrator` | Orchestrator status |

## 🔁 Reinstall / Reset

```bash
# Reinstall (preserves all data: wallet, earnings, PIN, config)
bash reinstall.sh

# Full factory reset (deletes everything)
bash reinstall.sh --reset
```

## 📋 Changelog

### v3.4.0 (March 2026)

- ✅ **Real Contract Addresses** — GSTD Token, StonFi DEX pool, staking contract on TON mainnet
- ✅ **Zod Runtime Validation** — full P2P message schema validation
- ✅ **libp2p P2P Mesh** — real TCP-based peer discovery + mDNS
- ✅ **Fastify HTTP Engine** — high-performance gateway with typed routes
- ✅ **PM2 Process Manager** — auto-restart, cluster mode, log rotation
- ✅ **Official Wallet SDKs** — MetaMask SDK, Solana Adapter, Xaman (XRPL), TON Connect
- ✅ **PAXG Bridge** — cross-chain PAXG (ERC-20) ↔ GSTD (TON) via 4-chain bridge
- ✅ **Ethereum Chain** — ETH/PAXG support in bridge (StonFi-compatible)
- ✅ **Platform API v2** — `/agents/earn/heartbeat`, `/agents/register`, collective memory
- ✅ **Liveness Agent** — autonomous server-side agent earning GSTD 24/7

### v3.3.0 (March 2026)

- ✅ **Wallet Binding** — bind external TON wallet, collect rewards from N nodes
- ✅ **Auto-Claim** — unclaimed rewards >90 days auto-credited (background goroutine)
- ✅ **Dashboard Wallet Binding UI** — bind/unbind/claim directly from control panel
- ✅ **App Install Fix** — built-in apps install without Docker requirement
- ✅ Resource Sharing API (5 endpoints)
- ✅ Collective Memory API (store/recall/stats)
- ✅ AI Training API (status/jobs/start)
- ✅ Dashboard chat + chat history
- ✅ Remote access status/info endpoints
- ✅ Node settings/config endpoints
- ✅ App Store status endpoint
- ✅ Graceful shutdown (SIGTERM handler)
- ✅ 8 AI models (llama-3.3-70b, llama-4-scout/maverick, qwen3-32b, gpt-oss-120b/20b, kimi-k2)
- ✅ Full security audit: SSL, auth, injection protection

## 📡 Links

- 🌐 **Website**: [gstdtoken.com](https://gstdtoken.com)
- 🤖 **Telegram**: [@GstdAppBot](https://t.me/GstdAppBot)
- 💬 **Community**: [t.me/goldstandardcoin](https://t.me/goldstandardcoin)
- ⭐ **GitHub**: [github.com/gstdcoin](https://github.com/gstdcoin)
- 💎 **Tonkeeper**: [tonkeeper.com](https://tonkeeper.com)
- 🔄 **Ston.fi**: [ston.fi](https://ston.fi)

## 📝 License

Apache 2.0 — Free for personal and commercial use.
