# GSTD Node OS — Current Architecture
**Date:** 2026-08-28

---

## Component Map

```
src/
├── index.ts                  ← Main entry point, wires everything together (~700 lines)
│
├── gateway/                  ← HTTP server (user-facing + admin)
│   ├── server.ts             ← Express server, 4784 lines — dashboard, AI API, update API
│   ├── router.ts             ← Inference routing: local Ollama → model selection → response
│   ├── fastify.ts            ← Fastify wrapper (used for some endpoints)
│   └── sessions.ts           ← Session tracking
│
├── p2p/                      ← Peer-to-peer layer (libp2p)
│   ├── node.ts               ← GstdP2PNode: libp2p config, transports, DHT, mDNS
│   ├── identity.ts           ← Ed25519 key derivation, sign(), verify()
│   ├── p2p-identity.ts       ← Persists libp2p peerId to ~/.config/gstdbot/p2p-identity.json
│   ├── peers.ts              ← Bootstrap peers: GitHub env → platform fallback
│   ├── attestation.ts        ← Sign task results with node Ed25519 key
│   └── quorum-coordinator.ts ← Collect 2-of-3 peer attestations for task results
│
├── core/                     ← Node lifecycle and central connectivity
│   ├── platform-link.ts      ← Heartbeat + command polling from platform.gstdtoken.com
│   ├── scheduler.ts          ← Task scheduling wrapper
│   ├── event-bus.ts          ← Internal EventEmitter
│   ├── usage-tracker.ts      ← Per-user request rate limiting
│   ├── model-failover.ts     ← Automatic model fallback on failure
│   └── diagnostics.ts        ← Self-check at startup
│
├── swarm/                    ← Swarm task execution
│   ├── agent.ts              ← Main task agent: polls central, executes inference, quorum
│   ├── orchestrator.ts       ← Coordinates multi-node execution
│   └── client.ts             ← Swarm client API
│
├── naas/                     ← Node-as-a-Service [EXPERIMENTAL]
│   ├── uptime_daemon.ts      ← Heartbeat/register to platform; command execution
│   ├── orchestrator.ts       ← Docker container management
│   ├── hardware_profiler.ts  ← Reads CPU/GPU/disk stats
│   ├── revenue_flywheel.ts   ← Multi-chain token conversion
│   ├── rpc_proxy.ts          ← Blockchain RPC proxy
│   ├── data_sharder.ts       ← Data sharding
│   └── node_license.ts       ← License management
│
├── channels/                 ← User interfaces
│   ├── telegram.ts           ← Telegram bot (grammy), 1885 lines
│   ├── miniapp.ts            ← Telegram Mini App bridge, 1268 lines
│   └── guardian.ts           ← Content moderation
│
├── wallet/                   ← TON wallet
│   ├── wallet.ts             ← TonWallet: init from mnemonic/address, send, balance
│   ├── manager.ts            ← WalletManager: earnings tracking, rewards queries
│   └── tonconnect.ts         ← TonConnect v2 integration
│
├── blockchain/               ← On-chain modules
│   ├── token.ts              ← GSTD token price/info queries
│   └── bridge.ts             ← Cross-chain bridge verifier [EXPERIMENTAL]
│
├── training/                 ← Federated learning [EXPERIMENTAL]
│   ├── federated.ts          ← Distributed model training
│   ├── aggregator.ts         ← Gradient aggregation
│   ├── specialization.ts     ← Model specialization
│   ├── thermal-router.ts     ← Entropy-based shard assignment
│   ├── health.ts             ← Training health monitor
│   └── offline-queue.ts      ← Queues training when offline
│
├── lib/                      ← Shared utilities
│   ├── model-registry.ts     ← Model manifest: hash, license, hardware requirements
│   ├── demand-tracker.ts     ← Per-model demand scoring
│   ├── platform-auth.ts      ← Verify signed commands from platform
│   ├── platform-health.ts    ← Circuit breaker for platform API calls
│   └── wallet-link-headers.ts← Auth headers for platform requests
│
├── compute/marketplace.ts    ← GPU compute marketplace [EXPERIMENTAL]
├── apps/manager.ts           ← Docker app manager [EXPERIMENTAL]
├── skills/marketplace.ts     ← Skills/plugin marketplace [EXPERIMENTAL]
├── memory/collective.ts      ← Distributed memory [EXPERIMENTAL]
├── network/remote.ts         ← Remote access manager
├── network/resources.ts      ← Resource monitoring
├── validators/manager.ts     ← Blockchain lite client manager [EXPERIMENTAL]
├── fees/ledger.ts            ← Fee tracking
├── revenue/engine.ts         ← Revenue calculation
├── dashboard/server.ts       ← Dashboard HTTP handlers
├── security/hardening.ts     ← Security utilities
├── storage/vault.ts          ← Encrypted local storage [EXPERIMENTAL]
├── storage/ipfs.ts           ← IPFS integration [EXPERIMENTAL]
├── tools/quality-eval.ts     ← LLM quality evaluation
├── agent/agent.ts            ← Agent loop
├── node-lite/index.ts        ← Lightweight standalone node
└── cli/index.ts              ← CLI tool
```

---

## Data Flow — Current

### Startup
```
index.ts
  → load config (GSTD_WALLET_ADDRESS, GSTD_SWARM_URL, etc.)
  → init TON wallet (optionally from GSTD_WALLET_MNEMONIC)
  → load P2P identity (Ed25519 from ~/.config/gstdbot/p2p-identity.json)
  → start gateway HTTP server (port 8080)
  → start P2P node (libp2p, port 4001)
  → start NaaS UptimeDaemon (register + heartbeat to platform.gstdtoken.com)
  → start SwarmAgent (poll platform.gstdtoken.com for tasks)
  → start PlatformLink (heartbeat loop)
  → start Telegram bot (optional)
  → schedule auto-update check (2 min, then hourly)
```

### Task execution (current)
```
platform.gstdtoken.com  ←── external user or Telegram
    ↓ task queued in KV
SwarmAgent.pollTasks()   ← polls every 5s
    ↓ task received
SwarmAgent.executeTask()
    ↓ inference via Ollama API (localhost:11434)
    ↓ result
QuorumCoordinator        ← if co-executors configured
    ↓ collect 2-of-3 Ed25519 attestations
    ↓ quorum result
platform.gstdtoken.com  ← result reported
```

### P2P (current — separate from task flow)
```
libp2p node
    ↓ mDNS (LAN) + Kademlia DHT (WAN)
    ↓ connects to bootstrap peer at node.gstdtoken.com
    ↓ peer discovery
    ↓ (currently: peer identity + attestation only)
    ↓ no P2P task routing
```

---

## Key Interfaces

### GatewayConfig (src/index.ts)
```typescript
{
  nodeId: string;           // stable UUID
  version: string;          // "3.5.0"
  installDir: string;       // ~/gstdbot
  walletAddress: string;    // TON address (payout only)
  swarmUrl: string;         // platform.gstdtoken.com
  apiUrl: string;           // platform.gstdtoken.com/api/v1
  enableTelegram: boolean;
  enableP2P: boolean;
  enableNaaS: boolean;
  listenPort: number;       // 8080
}
```

### P2PNodeConfig (src/p2p/node.ts)
```typescript
{
  nodeId: string;
  walletAddress: string;
  listenPort: number;         // 4001
  enableMdns: boolean;
  privateKey?: PrivateKey;    // Ed25519 from p2p-identity.ts
  httpServer?: http.Server;   // attach WS to existing HTTP server
  wsAnnounceHost?: string;    // e.g. node.gstdtoken.com
}
```

### Bootstrap peers (hardcoded)
```
/dns4/node.gstdtoken.com/tcp/443/wss/p2p/12D3KooWJwoerHaucUfo8rD6ycXCqdfAK4zhqUW3sYFXX8zJDTmF
```

---

## What is Missing for P2P-First Operation

| Missing | Impact |
|---------|--------|
| Canonical task format (signed, with expiry + replay protection) | Tasks can't be P2P-routed safely |
| P2P task routing (libp2p streams/pubsub) | No path from requester to executor without central |
| Task sandbox (CPU/RAM/disk limits) | Arbitrary tasks can consume all resources |
| Signed result format | Results not verifiable without trusting the reporting node |
| Verification classes (deterministic vs consensus) | All tasks treated the same |
| Reputation tracking (based on verified work, not uptime) | No quality signal |
| TON settlement (verified work → on-chain) | Revenue not trustless |
| Platform API feature flag | Platform API always in critical path |
