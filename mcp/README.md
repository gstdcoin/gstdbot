# GSTD Network — MCP Server

> Run 50+ open-source AI models on a decentralized node network — directly from Claude Code

[![GSTD Network](https://platform.gstdtoken.com/badge.svg)](https://gstdtoken.com)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-7c3aed)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../LICENSE)

## Install (one command, no API key)

```bash
claude mcp add --transport http gstd https://platform.gstdtoken.com/mcp
```

## What you get

Claude Code can now use **Llama 3, Mistral, CodeLlama, Qwen, DeepSeek, Gemma** and 50+ other open-weight models running on distributed nodes worldwide.

### 4 tools available to Claude

| Tool | What it does |
|------|-------------|
| `gstd_inference` | Run any open-source model on the GSTD network |
| `gstd_list_models` | Live list of available models across online nodes |
| `gstd_network_stats` | Nodes count, tasks completed, GSTD token price, verification rate |
| `gstd_join_network` | Step-by-step guide to run a node and earn GSTD tokens |

## Example session

```
You: Review this Python function for bugs using CodeLlama

Claude: [calls gstd_inference with model="codellama:7b"]

The function has a potential off-by-one error on line 14.
The loop condition should be `i < len(arr)` not `i <= len(arr)`...

---
⚡ Powered by GSTD Network · node d8edbeee · gstdtoken.com
```

## Live endpoint

```
https://platform.gstdtoken.com/mcp
```

Test it right now:

```bash
curl -X POST https://platform.gstdtoken.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Network stats badge

Embed live stats in your README:

```markdown
[![GSTD Network](https://platform.gstdtoken.com/badge.svg)](https://gstdtoken.com)
```

## Run a node — earn GSTD

Every inference request through this MCP server generates GSTD tokens for node operators.

```bash
# Works on Raspberry Pi 4, Linux, macOS, cloud VM
curl -sSL https://gstdtoken.com/install.sh | bash
```

**First 10 nodes: permanent 2× earning bonus.**

## Why GSTD?

- **Free** — no subscription, no API key required
- **Decentralized** — tasks distributed across nodes globally  
- **Verified** — M5 RE_EXECUTION: every result cross-checked by a second node
- **Earnable** — operators earn GSTD tokens, withdrawable to TON wallet
- **Open** — Apache 2.0, all code public

## Links

- 🌐 Website: [gstdtoken.com](https://gstdtoken.com)
- 🤖 Telegram bot: [@gstdaibot](https://t.me/gstdaibot)
- 📊 Platform dashboard: [platform.gstdtoken.com](https://platform.gstdtoken.com)
- 💬 Node software: [gstdcoin/gstdbot](https://github.com/gstdcoin/gstdbot)
