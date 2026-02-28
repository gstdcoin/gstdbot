# 🐝 GSTD Bot — Sovereign Decentralized AI Assistant

**Your personal AI agent. Runs on a planetary brain. Not on corporate servers.**

GSTD Bot is a decentralized AI assistant powered by a swarm of real devices. Unlike traditional assistants that proxy requests to OpenAI/Anthropic, GSTD Bot uses sovereign models running on the GSTD Swarm network. Your data stays private, the network gets stronger with every user, and node operators earn GSTD tokens.

[Website](https://gstdbot.gstdtoken.com) · [Web Chat](https://chat.gstdtoken.com) · [Telegram Bot](https://t.me/GstdAppBot) · [Dashboard](https://app.gstdtoken.com) · [Monitor](https://monitor.gstdtoken.com) · [Docs](https://gstdbot.gstdtoken.com/docs)

---

## Why GSTD Bot over OpenClaw?

| Feature | GSTD Bot | OpenClaw |
|---------|----------|----------|
| **Infrastructure** | Decentralized Swarm (247+ nodes) | Single machine |
| **AI Models** | 6 sovereign + commercial fallback | API proxy only |
| **Privacy** | TEE confidential compute (Cocoon) | Local only |
| **Earn money** | ✓ GSTD tokens for node operators | ✗ |
| **Memory** | Collective Hive Memory | Local session memory |
| **Skills** | Marketplace with GSTD tokenomics | Community skills |
| **Self-improving** | ✓ DPO training from usage | ✗ Static models |
| **Blockchain** | ✓ TON + GSTD token verified | ✗ |
| **Scalability** | Planetary | Single machine |
| **Sovereignty** | 100% — no corporate dependency | Depends on APIs |

## Features

### 🐝 Sovereign-First Routing
Every request goes through the Omega Neural Router:
1. **L1 Cache** — instant responses for known queries
2. **L2 Swarm (Ollama)** — sovereign models on decentralized nodes
3. **L3 Cocoon TEE** — hardware-encrypted GPU for heavy tasks
4. **L4 Commercial** — fallback to OpenAI/Anthropic (last resort)

### 💬 Multi-Channel Support
- **Telegram** — native deep integration (DMs, groups, inline, WebApp)
- **Web Chat** — chat.gstdtoken.com
- **OpenAI-compatible API** — /v1/chat/completions endpoint
- _Coming soon: WhatsApp, Discord, Slack_

### 🧠 Persistent Hive Memory
The Swarm remembers collectively. Every interaction improves the Experience Vault. Context persists across sessions, and the AI evolves with each conversation.

### 🛡️ TEE Confidential Compute
Heavy tasks run inside Cocoon TEE — hardware-encrypted GPU enclaves where even the node operator cannot see your data. Verified on TON blockchain.

### ⚡ Sovereign Neural Router
Auto-selects the best model for your task:
- `qwen2.5-coder:7b` — code generation & review
- `deepseek-r1:14b` — deep reasoning & analysis
- `llama3.1:8b` — general conversations
- `cocoon-auto` — TEE GPU for confidential tasks

### 💰 Earn While You Compute
Connect your device as a Swarm node and earn GSTD tokens. Gold-backed reserves add real value.

### 🔧 Skills Marketplace
Install skills to extend the bot. Each skill runs sovereignly on the Swarm:

| Skill | Description | Cost |
|-------|-------------|------|
| DeFi Monitor | Real-time DeFi signals across TON, ETH, SOL | 0.01 GSTD |
| Web Researcher | Deep research with source verification | 0.02 GSTD |
| Code Generator | Write, review, debug in any language | Free |
| Planetary Signals | Monitor 30 global threat signals | 0.05 GSTD |
| Content Writer | SEO-optimized multilingual writing | 0.01 GSTD |
| Token Analyzer | On-chain analysis & smart money tracking | 0.03 GSTD |
| Image Generator | Text-to-image on Swarm GPUs | 0.1 GSTD |

---

## Quick Start

### Use the Bot (easiest)
Open [@GstdAppBot](https://t.me/GstdAppBot) in Telegram and start chatting.

### Use the Web Chat
Go to [chat.gstdtoken.com](https://chat.gstdtoken.com)

### Use the API (OpenAI-compatible)
```bash
curl https://gstdbot.gstdtoken.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Run Your Own Node
```bash
# Install
curl -fsSL https://gstdbot.gstdtoken.com/install.sh | bash

# Or with npm
npm install -g gstdbot@latest

# Onboard
gstdbot onboard --install-daemon

# Check status
gstdbot status
```

### Run from Source
```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
npm install
npm run build
npm start
```

---

## Architecture

```
Telegram / Web Chat / API clients
         │
         ▼
┌─────────────────────────────────┐
│       Omega Gateway             │
│   (Control Plane + Router)      │
│   ws://0.0.0.0:18789            │
└──────────────┬──────────────────┘
               │
    ┌──────────┼──────────────┐
    │          │              │
    ▼          ▼              ▼
┌────────┐ ┌────────┐ ┌──────────────┐
│L1 Cache│ │L2 Swarm│ │L3 Cocoon TEE │
│ (Redis)│ │(Ollama)│ │  (GPU TEE)   │
└────────┘ └────────┘ └──────────────┘
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                    ▼         ▼         ▼
              ┌─────────┐ ┌───────┐ ┌──────┐
              │ Hive    │ │Skills │ │Token │
              │ Memory  │ │Market │ │Econ  │
              └─────────┘ └───────┘ └──────┘
```

### Key Subsystems

- **Omega Gateway** — WebSocket control plane for sessions, channels, tools, events
- **Neural Router** — semantic analysis for automatic model selection
- **Swarm Network** — decentralized compute across 247+ nodes
- **Experience Vault** — collective memory with DPO training pipeline
- **Cocoon Bridge** — TEE integration for confidential GPU compute
- **Skills Engine** — modular skill system with marketplace
- **Token Economy** — GSTD token for payments, rewards, governance

---

## Configuration

Minimal `~/.gstdbot/config.json`:

```json
{
  "agent": {
    "model": "auto",
    "sovereignty": "full"
  },
  "swarm": {
    "enabled": true,
    "contribute": true,
    "ollama_url": "http://localhost:11434"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "bot_token": "YOUR_BOT_TOKEN"
    }
  },
  "gateway": {
    "port": 18789,
    "api_port": 8080
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GSTD_HOME` | Home directory | `~/.gstdbot` |
| `GSTD_MODEL` | Default model | `auto` |
| `GSTD_SWARM_URL` | Swarm endpoint | `http://localhost:11434` |
| `GSTD_COCOON_ENABLED` | Enable TEE | `true` |
| `GSTD_SOVEREIGNTY_MODE` | Routing priority | `full` |
| `OLLAMA_URL` | Ollama endpoint | `http://localhost:11434` |

---

## CLI Reference

```bash
gstdbot onboard              # Interactive setup wizard
gstdbot status               # Show node status
gstdbot gateway              # Start the gateway
gstdbot doctor               # Diagnose issues
gstdbot skills list          # List installed skills
gstdbot skills install <id>  # Install a skill from marketplace
gstdbot skills create        # Create a new skill
gstdbot chat                 # Start interactive chat
gstdbot send <message>       # Send a one-off message
gstdbot swarm join           # Join the swarm as a node
gstdbot swarm status         # Show swarm metrics
gstdbot sovereignty          # Show sovereignty index
```

### Chat Commands (in Telegram/WebChat)
```
/status          — session status + model info
/new             — reset conversation
/model <name>    — switch model (auto/flash/pro/ultra/cocoon)  
/think <level>   — off|low|medium|high
/skills          — list available skills
/sovereignty     — show sovereignty index
/balance         — show GSTD balance
/earn            — join as compute node
```

---

## Skills Development

Create a skill in `~/.gstdbot/skills/<name>/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
author: your-name
price: 0.01
currency: GSTD
tags: [utility, automation]
---

# My Skill

Instructions for the AI agent on how to use this skill.

## Tools
- `my_tool_name` — description of what this tool does

## Examples
User: "Use my-skill to do X"
Assistant: [uses the skill]
```

Publish to marketplace:
```bash
gstdbot skills publish ./my-skill
```

---

## Security Model

- **Default**: sovereign models only, no data leaves the Swarm
- **TEE compute**: hardware-encrypted enclaves for sensitive tasks
- **DM pairing**: unknown senders must be approved before interaction
- **Sandbox mode**: skills run in isolated environments
- **Blockchain audit**: all TEE computations are verifiable on TON

---

## Development

```bash
# Clone
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot

# Install dependencies
npm install

# Build
npm run build

# Development mode (auto-reload)
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

---

## Project Structure

```
gstdbot/
├── src/
│   ├── gateway/          # Omega Gateway (control plane)
│   ├── agent/            # AI agent runtime
│   ├── channels/         # Channel integrations (Telegram, etc.)
│   ├── tools/            # Built-in tools (browser, exec, etc.)
│   ├── skills/           # Skills engine
│   ├── swarm/            # Swarm network client
│   ├── config/           # Configuration management
│   └── cli/              # CLI interface
├── skills/               # Built-in skills
│   ├── web-research/
│   ├── code-gen/
│   ├── defi-monitor/
│   ├── planetary-signals/
│   ├── content-writer/
│   ├── token-analyzer/
│   └── image-gen/
├── web/                  # Landing page + web chat
├── docs/                 # Documentation
├── scripts/              # Install & deployment scripts
└── README.md
```

---

## Links

- 🌐 Website: [gstdbot.gstdtoken.com](https://gstdbot.gstdtoken.com)
- 💬 Web Chat: [chat.gstdtoken.com](https://chat.gstdtoken.com)
- 🤖 Telegram: [@GstdAppBot](https://t.me/GstdAppBot)
- 📊 Monitor: [monitor.gstdtoken.com](https://monitor.gstdtoken.com)
- 🎛️ Dashboard: [app.gstdtoken.com](https://app.gstdtoken.com)

---

## License

Apache-2.0 — see [LICENSE](./LICENSE)

---

Built by the GSTD Swarm 🐝 — Sovereign. Decentralized. Unstoppable.
