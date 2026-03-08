# 🐝 GSTD Node OS

> **Sovereign AI Platform** — Your Personal Decentralized AI Node.  
> Run AI models, earn GSTD tokens, join the collective intelligence swarm.

[![Version](https://img.shields.io/badge/version-3.3.0-8b5cf6)](https://github.com/gstdcoin/gstdbot/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-22c55e)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-06b6d4)](https://nodejs.org)

```
curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash
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

| Command      | Action                    |
| ------------ | ------------------------- |
| `/status`    | Node uptime, RAM, version |
| `/restart`   | Restart node              |
| `/update`    | Pull + build + restart    |
| `/apps`      | List installed apps       |
| `/earnings`  | GSTD earned               |
| `/pin_reset` | 2FA PIN reset             |

## 🔁 Reinstall / Reset

```bash
# Reinstall (preserves all data: wallet, earnings, PIN, config)
bash reinstall.sh

# Full factory reset (deletes everything)
bash reinstall.sh --reset
```

## 📡 Links

- 🌐 **Landing**: [gstdbot.gstdtoken.com](https://gstdbot.gstdtoken.com)
- 🤖 **Telegram**: [@GstdAppBot](https://t.me/GstdAppBot)
- 💬 **Web Chat**: [chat.gstdtoken.com](https://chat.gstdtoken.com)
- 📊 **Monitor**: [monitor.gstdtoken.com](https://monitor.gstdtoken.com)
- 🏠 **Dashboard**: [app.gstdtoken.com](https://app.gstdtoken.com)
- ⭐ **GitHub**: [github.com/gstdcoin](https://github.com/gstdcoin)
- 💎 **Tonkeeper**: [tonkeeper.com](https://tonkeeper.com)
- 🔄 **Ston.fi**: [ston.fi](https://ston.fi)

## 📝 License

Apache 2.0 — Free for personal and commercial use.
