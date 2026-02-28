# 🐝 GSTD Bot — Sovereign Decentralized AI Assistant

**Your personal AI agent. Runs on a planetary brain. Not on corporate servers.**

GSTD Bot is an AI assistant that runs **on your machine** using sovereign open-source models via [Ollama](https://ollama.com). Unlike ChatGPT, Claude, or any corporate AI — your conversations stay private, your data never leaves your device, and you become part of a decentralized network that earns you GSTD tokens.

**Think OpenClaw, but decentralized and with an actual economy.**

[Website](https://gstdbot.gstdtoken.com) · [Web Chat](https://chat.gstdtoken.com) · [Telegram](https://t.me/GstdAppBot) · [Dashboard](https://app.gstdtoken.com) · [Monitor](https://monitor.gstdtoken.com)

---

## Why GSTD Bot?

| Feature | GSTD Bot | OpenClaw | ChatGPT |
|---------|----------|----------|---------|
| **Runs on your PC** | ✓ | ✓ | ✗ |
| **Privacy** | 100% local + TEE | Local only | ✗ Cloud |
| **Decentralized** | ✓ Swarm network | ✗ Single machine | ✗ Corporate |
| **Earn money** | ✓ GSTD tokens | ✗ | ✗ |
| **Skills marketplace** | ✓ With malware scanning | ✓ | ✗ |
| **Self-improving** | ✓ DPO training | ✗ | ✗ |
| **Blockchain verified** | ✓ TON | ✗ | ✗ |
| **Free** | ✓ | ✓ | ✗ $20/mo |

## Quick Start (3 minutes)

### 1. Install Ollama (your local AI brain)
```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.1:8b
```

### 2. Install GSTD Bot
```bash
# Option A: npm (recommended)
npm install -g gstdbot

# Option B: From source
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
npm install
npm run build
npm link
```

### 3. Setup
```bash
gstdbot onboard
```

### 4. Start chatting!
```bash
gstdbot
```

That's it. You now have a sovereign AI assistant on your PC. No API keys. No subscriptions. No corporate surveillance.

---

## How It Works

```
You type a message
        │
        ▼
┌──────────────────────┐
│   GSTD Bot (local)   │      ← runs on YOUR machine
│   Neural Router       │
└──────────┬───────────┘
           │
   ┌───────┼───────────┐
   │       │           │
   ▼       ▼           ▼
L1 Cache  L2 Ollama   L3 Cocoon TEE      ← all sovereign
(instant) (local GPU) (encrypted GPU)
                       │
                       ▼
              L4 Commercial fallback     ← last resort only
              (disabled by default)
```

### Routing Priority (Sovereign-First)
1. **L1 Cache** — instant response for repeated queries
2. **L2 Swarm (Ollama)** — your local sovereign models
3. **L3 Cocoon TEE** — hardware-encrypted GPU enclaves (optional)
4. **L4 Commercial** — OpenAI/Anthropic fallback (disabled by default)

The Neural Router automatically selects the best model for your task:
- **Code** → `qwen2.5-coder:7b` (fast, specialized)
- **Reasoning** → `deepseek-r1:14b` (deep analysis)
- **General** → `llama3.1:8b` (balanced)

---

## Interactive Chat

```bash
gstdbot
```

```
╔═══════════════════════════════════════════╗
║   🐝 GSTD Bot — Sovereign AI Assistant   ║
║   Decentralized · Private · Unstoppable   ║
╚═══════════════════════════════════════════╝
  Type your message. Commands: /new /model /skills /status /exit

You: Write a Python fibonacci function

GSTD: Here's an efficient fibonacci implementation:

def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

  🐝 qwen2.5-coder:7b · 1247ms · swarm
```

### Chat Commands
| Command | Description |
|---------|-------------|
| `/new` | Reset conversation |
| `/model auto\|flash\|pro\|ultra` | Switch model |
| `/skills` | List active skills |
| `/status` | Session info |
| `/exit` | Quit |

---

## CLI Reference

```bash
gstdbot                    # Interactive chat (default)
gstdbot send "Hello"       # One-shot message
gstdbot gateway            # Start the API server
gstdbot onboard            # Setup wizard
gstdbot status             # System status
gstdbot doctor             # Diagnose issues
gstdbot sovereignty        # Show sovereignty index
gstdbot skills list        # Browse skills
gstdbot skills install X   # Install a skill
gstdbot skills scan file   # Security scan a skill
gstdbot skills create name # Create a new skill
gstdbot swarm join         # Join as compute node (earn GSTD)
gstdbot swarm status       # Network status
```

---

## Skills Marketplace

Skills extend your bot's capabilities. Each skill is a `SKILL.md` file with instructions for the AI agent.

### Built-in Skills

| Skill | Description | Price |
|-------|-------------|-------|
| 💻 Code Generator | Write, review, debug code in any language | Free |
| 🔍 Web Researcher | Deep research with source verification | 0.02 GSTD |
| 📊 DeFi Monitor | Real-time DeFi signals across TON, ETH, SOL | 0.01 GSTD |
| 📝 Content Writer | SEO-optimized multilingual writing | 0.01 GSTD |
| 📈 Token Analyzer | On-chain analysis & smart money tracking | 0.03 GSTD |
| 🌍 Planetary Signals | 30+ global threat signals monitoring | 0.05 GSTD |
| 🎨 Image Generator | Text-to-image on Swarm GPUs (beta) | 0.1 GSTD |

### Create Your Own Skill

```bash
gstdbot skills create my-skill
```

This creates `~/.gstdbot/skills/my-skill/SKILL.md`:

```yaml
---
name: my-skill
description: What this skill does
version: 0.1.0
author: you
price: 0
currency: GSTD
tags: [custom]
---

# My Skill
Instructions for the AI on how to use this skill.

## Examples
User: "Example request"
→ Expected behavior
```

### Security Scanning

**Every skill is scanned for malware before activation.** The scanner checks for:

- 🔴 Reverse shells and backdoors
- 🔴 Crypto miners
- 🔴 Wallet drainers
- 🔴 Data exfiltration attempts
- 🔴 Obfuscated malicious code
- 🟡 Environment variable theft
- 🟡 Suspicious network calls
- 🟡 Base64-encoded payloads

```bash
# Scan before installing
gstdbot skills scan path/to/SKILL.md

# Output:
#   ✓ No threats detected — skill is safe
#   Name:    my-skill
#   Version: 0.1.0
#   Author:  you
```

### Publish to Marketplace

Skills can be published to the GSTD Marketplace for others to install:

```bash
# Coming in v1.1
gstdbot skills publish ./my-skill
```

---

## Earn GSTD Tokens (Swarm Node)

Turn your PC into a compute node and earn GSTD tokens for processing AI requests from the network.

```bash
# Join the swarm
gstdbot swarm join
```

```
╔═══════════════════════════════════════════╗
║   🐝 GSTD Bot — Sovereign AI Assistant   ║
╚═══════════════════════════════════════════╝

  ✓ Hardware detected
  CPU:      Apple M2 Pro (10 cores)
  RAM:      16.0 GB
  GPU:      ✓ Detected
  Ollama:   ✓ Running
  Models:   llama3.1:8b, qwen2.5-coder:7b
  Node ID:  a3b8d1b6-...

  ✓ Registered with GSTD network

  🐝 You are now part of the Swarm!
  Your node will process AI requests and earn GSTD tokens.
  Keep this process running to stay active.
```

### How Earnings Work
- Each processed inference task earns GSTD tokens
- Tokens are credited to your linked TON wallet
- Gold-backed reserves ensure real value
- The more powerful your hardware, the more you earn
- GPU nodes earn 5-10x more than CPU-only nodes

### Link Your Wallet
Open [@GstdAppBot](https://t.me/GstdAppBot) in Telegram to link your TON wallet and track earnings.

---

## API Server (OpenAI-compatible)

Run a local API that's compatible with any OpenAI client:

```bash
gstdbot gateway --port 8080
```

```bash
# Use with any OpenAI client
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | Chat (streaming & non-streaming) |
| `GET /v1/models` | List available models |
| `GET /v1/sovereignty` | Sovereignty index |
| `GET /v1/skills` | Skills marketplace |
| `GET /v1/swarm/status` | Swarm network status |
| `GET /health` | Service health |
| `WS /ws` | WebSocket real-time |

---

## Configuration

Config at `~/.gstdbot/config.json`:

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
      "enabled": false,
      "bot_token": ""
    }
  },
  "gateway": {
    "port": 18789,
    "api_port": 8080
  }
}
```

### SOUL.md — Customize Your Bot

Edit `~/.gstdbot/workspace/SOUL.md` to change the bot's personality:

```markdown
# My Custom GSTD Bot

You are my personal AI assistant.
You speak casually and use emojis.
You are an expert in Python and blockchain.
```

---

## Architecture

```
gstdbot/
├── src/
│   ├── index.ts              # Main entry point
│   ├── agent/
│   │   └── agent.ts          # Core agent runtime (SOUL, memory, skills)
│   ├── gateway/
│   │   ├── server.ts         # Omega Gateway (API + WebSocket)
│   │   ├── router.ts         # Neural Router (4-tier sovereign-first)
│   │   └── sessions.ts       # Session management
│   ├── channels/
│   │   └── telegram.ts       # Telegram bot integration
│   ├── skills/
│   │   └── marketplace.ts    # Skills engine + malware scanner
│   ├── swarm/
│   │   └── client.ts         # Swarm network client
│   └── cli/
│       └── index.ts          # CLI interface
├── skills/                   # Built-in skills (7)
├── web/                      # Landing page
├── scripts/
│   └── install.sh            # One-line installer
├── Dockerfile
└── README.md                 # This file
```

### Key Components

| Component | Description |
|-----------|-------------|
| **Agent** | Core AI runtime with SOUL.md identity, memory, and skill activation |
| **Neural Router** | 4-tier routing: Cache → Swarm → Cocoon TEE → Commercial |
| **Skills Marketplace** | Install, scan, create, and manage skills with malware protection |
| **Swarm Client** | Hardware detection, node registration, heartbeat, task processing |
| **Omega Gateway** | OpenAI-compatible REST API + WebSocket server |
| **Telegram Channel** | Full Telegram bot with grammY |
| **CLI** | Interactive chat, diagnostics, and management |

---

## Security

### Threat Model
- **Your data stays local** — Ollama runs on your machine
- **No API keys required** — sovereign models are free
- **No telemetry** — zero data sent to GSTD servers unless you opt-in to Swarm
- **Skills are sandboxed** — malware-scanned before activation
- **Swarm tasks are isolated** — each inference runs in its own context
- **TEE compute** — Cocoon hardware enclaves for sensitive tasks

### Responsible Disclosure
Found a security issue? Email security@gstdtoken.com or open a private issue on GitHub.

---

## Development

```bash
git clone https://github.com/gstdcoin/gstdbot.git
cd gstdbot
npm install --legacy-peer-deps
npm run dev     # Development mode (auto-reload)
npm run build   # Production build
npm test        # Run tests
```

---

## Comparison with OpenClaw

| Feature | GSTD Bot 🐝 | OpenClaw 🦞 |
|---------|:----------:|:---------:|
| Custom skills | ✓ | ✓ |
| Skill marketplace | ✓ | ✓ |
| Malware scanning | ✓ | ✗ |
| Interactive CLI | ✓ | ✓ |
| OpenAI-compatible API | ✓ | ✓ |
| Decentralized network | ✓ | ✗ |
| Earn tokens | ✓ | ✗ |
| Collective memory | ✓ | ✗ |
| TEE confidential compute | ✓ | ✗ |
| Self-improving models | ✓ | ✗ |
| Blockchain verification | ✓ | ✗ |
| Telegram integration | ✓ | ✗ |
| Multi-language (RU/EN) | ✓ | English only |
| Web dashboard | ✓ | Desktop app |

---

## Links

- 🌐 Website: [gstdbot.gstdtoken.com](https://gstdbot.gstdtoken.com)
- 💬 Web Chat: [chat.gstdtoken.com](https://chat.gstdtoken.com)
- 🤖 Telegram: [@GstdAppBot](https://t.me/GstdAppBot)
- 📊 Monitor: [monitor.gstdtoken.com](https://monitor.gstdtoken.com)
- 🎛️ Dashboard: [app.gstdtoken.com](https://app.gstdtoken.com)
- 📦 npm: `npm install -g gstdbot`

## License

Apache-2.0

---

*Built by the GSTD Swarm 🐝 — Sovereign. Decentralized. Unstoppable.*
