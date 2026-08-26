# Decentralized Discovery — Design

**Repo:** gstdbot
**Scope:** Sub-project B of the "eliminate app.gstdtoken.com dependency" decomposition (A: resilience-fix, shipped; B: this spec; C: decentralized inference routing; D: decentralized task/reward attestation; E: decentralized balance ledger — C/D/E not started). This covers node discovery only — how nodes find each other. It does not change how inference requests, tasks, or rewards are routed once peers are known (that's C/D).

## Problem

Today, node discovery is fully centralized: nodes register, heartbeat, and are listed via `app.gstdtoken.com`'s Upstash KV (`node:{id}` records, 600s liveness TTL). Real P2P infrastructure already exists in gstdbot but isn't wired as the primary path:
- `src/p2p/node.ts` — a mature libp2p node (TCP, Noise, Yamux, mDNS + bootstrap discovery, an `identify` service, six custom protocols). As of the resilience-fix sub-project, it now retries with backoff instead of permanently disabling on a bind failure — but it still has no bootstrap peers configured by default, so in practice it only ever finds LAN-local peers via mDNS.
- `src/p2p/peers.ts` — a separate, simpler HTTP-based `PeerManager` that gossips over `POST /api/peers/heartbeat`, persists to `peers.json`, and seeds from `GSTD_SEED_PEERS` and a GitHub-hosted seed file. Wired into `src/gateway/server.ts`. Does not share state with `p2p/node.ts`.

Neither is the *primary* discovery mechanism — both are secondary to the central KV registry, which every node depends on to find any peer at all.

## Design

### 1. libp2p + Kademlia DHT as the primary discovery layer

Add `@libp2p/kad-dht` to `src/p2p/node.ts`'s libp2p configuration, alongside the existing mDNS and bootstrap discovery modules. This is a standard libp2p ecosystem module (used by IPFS and many other libp2p-based networks) — not custom-built DHT logic. Nodes advertise themselves on the DHT and query it to find peers WAN-wide, not just on the LAN (mDNS's current limit).

### 2. Bootstrap: hardcoded, not fetched

A small list of stable peer multiaddrs ships directly in `src/p2p/node.ts`'s source (a `DEFAULT_BOOTSTRAP_PEERS` constant), compiled into every install — never fetched from GitHub or any live service at runtime. Per the approved decision, the initial bootstrap set is this project's own already-running nodes (starting with this Pi).

**Real prerequisite, not yet satisfiable by code alone:** this Pi's current network address is a Cloudflare tunnel URL that changes on every restart (`tunnel.sh` writes it to `/tmp/gstd_tunnel_url.txt` each time). A hardcoded bootstrap multiaddr needs a *stable* address to point at. This requires a DNS record (a subdomain you control, e.g. `bootstrap1.yourdomain` — NOT routed through `app.gstdtoken.com`'s application, just a static DNS pointer) kept updated to the Pi's current address, the same way dynamic-DNS services work. **This plan cannot provision that DNS record — it requires your registrar/DNS provider access.** Until it exists, the DHT bootstrap step will have no real WAN-reachable seed and will silently fall through to the next layer in the fallback chain (mDNS/GitHub/KV) exactly as designed — so the rest of this sub-project is still fully buildable and testable now (local dev can bootstrap DHT peers directly by multiaddr without DNS), but the *production* WAN bootstrap capability is blocked on that DNS record existing. This is called out explicitly as a task in the plan with a clear "cannot be completed by an agent, needs the human operator" marker, not silently skipped.

### 3. Unify the two peer systems into one shared pool, keep both transports

`PeerManager` (`src/p2p/peers.ts`) stays — it's a useful fallback for NAT/firewall situations where direct libp2p connections can't establish, and it already persists to disk. But instead of being a second, disconnected peer list, both `PeerManager` and `GstdP2PNode`'s libp2p peerstore write into and read from one shared in-memory/on-disk "known peers" registry. A new small module, `src/p2p/peer-registry.ts`, owns this: a single source of truth for "who do we currently believe is a live peer," with an entry's `source` field (`'dht'` | `'mdns'` | `'http-gossip'` | `'kv-fallback'`) so the system (and the operator dashboard) can see which discovery layer actually found each peer — honest visibility, matching the pattern established in the resilience-fix sub-project's dashboard status work.

### 4. Fallback chain, explicit and logged

In order, each only attempted if the previous layer yields zero peers within a short timeout:
1. DHT bootstrap (WAN-wide, once the hardcoded bootstrap addresses are real)
2. mDNS (LAN-local)
3. GitHub seed-peer file (already exists, unchanged — a static "phone book," not a live coordination service)
4. Central KV registry (`GET /nodes/list`) — last resort only, and every time this layer is actually used, log it clearly (`console.log('[discovery] falling back to central registry — P2P discovery found 0 peers')`) so an operator watching logs can see the network degraded rather than this happening silently.

`node:*` registration against the central KV **stays** for now (Step 4 needs something to fall back to, and the legacy web dashboard/leaderboard on `app.gstdtoken.com` still reads it) — this sub-project makes it optional/last-resort, not removed. Full removal of that write path is a decision for a later sub-project once C/D/E make the KV registry genuinely unnecessary end-to-end.

### 5. Single-node survivability

A lone node with zero discovered peers must still boot successfully and serve local requests (chat, dashboard) — none of steps 1-4 finding nothing should be treated as fatal. This is already effectively true today (P2P failures are non-fatal per the resilience-fix sub-project's mesh-retry design) — this sub-project preserves that property explicitly as a testable requirement, not something to newly build.

## Testing

- Local dev: start 2+ gstdbot instances on the same machine (different ports) with `app.gstdtoken.com` and GitHub both blocked (e.g. via `/etc/hosts` redirect to `127.0.0.1` or a firewall rule for the test), confirm they still discover each other via DHT (once a bootstrap multiaddr is reachable between them — for local testing, the instances can bootstrap directly off each other's local multiaddr, without needing the real DNS-backed production bootstrap) and/or mDNS.
- Confirm the fallback chain logs each layer's attempt/result clearly, and confirm the central-KV-fallback log line only appears when P2P layers genuinely found nothing.
- Confirm a single node with no reachable peers at all still boots and serves `/v1/chat/completions` and the local dashboard normally (no fatal error, no crash loop).
- `npx tsc --skipLibCheck` clean, `npx vitest run` clean (existing 5 tests unaffected) plus new unit coverage for `peer-registry.ts`'s merge/source-tracking logic (pure, easily testable, no network needed).

## Out of scope

- Actually routing inference requests or tasks to discovered peers (sub-project C/D) — this sub-project only makes peers discoverable, not usable yet beyond what the existing mesh protocols already do.
- Removing the central KV registry write path entirely (deferred; it remains the final fallback and legacy dashboard data source).
- Provisioning the DNS record needed for production WAN bootstrap (explicitly flagged above as a human-operator prerequisite, not something this plan can complete).
