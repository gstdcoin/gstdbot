# Decentralized Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WAN-wide peer discovery (Kademlia DHT) to the existing libp2p mesh, bridge its discoveries into the already-working, load-bearing `PeerManager` routing system, and add an explicit last-resort central-registry fallback — so nodes find and route to each other without depending on `app.gstdtoken.com` for the common case.

**Architecture:** During plan-writing, reading the actual code changed the spec's original "build a new unified `peer-registry.ts` module" into a smaller, lower-risk design: `PeerManager` (`src/p2p/peers.ts`) already has real, working, load-bearing routing (`getBestPeer()`/`forwardToPeer()`, wired into `gateway/router.ts` for actual chat-completion forwarding) — building a second parallel peer-tracking system and migrating routing onto it would be a large, risky rewrite for a discovery-focused sub-project. Instead: (1) add DHT to the libp2p side for real WAN discovery, (2) extend the libp2p heartbeat protocol to also carry each node's public HTTP URL (it doesn't today — libp2p heartbeats only carry `multiaddrs`, which `PeerManager` cannot dial since it routes over plain HTTP, not libp2p streams), (3) bridge libp2p-discovered peers into `PeerManager.registerPeer()` once their HTTP URL is known, tagging every peer with a `source` field for honest visibility, and (4) add a new last-resort central-KV seed step to `PeerManager.start()`, since no such fallback exists today (today: zero peers results if both env seeds and the GitHub seed file are empty/unreachable — there is no fallback beyond those two).

**Tech Stack:** TypeScript (Node.js 20), libp2p (`@libp2p/kad-dht` — new dependency, standard libp2p ecosystem module), vitest (already configured, used in prior sub-projects this session).

**Spec:** `docs/superpowers/specs/2026-08-25-decentralized-discovery-design.md`

## Global Constraints

- Bootstrap peer addresses must be hardcoded in source (compiled into the software), never fetched from an external service at runtime.
- No task may invent placeholder/fake bootstrap addresses — the DNS prerequisite from the spec is real and unresolved; the relevant constant ships empty with a clear comment, and one task is explicitly marked BLOCKED on a human prerequisite.
- A node with zero discovered peers (via any layer) must still boot successfully and serve local requests — this is already true today (per the resilience-fix sub-project) and must not regress.
- Every fallback-layer transition must be logged clearly (`console.log`/`logActivity`) so an operator can see which discovery layer actually found peers, matching the honesty pattern established in the resilience-fix and dashboard-reliability-fix sub-projects this session.

---

### Task 1: Add Kademlia DHT to the libp2p mesh + hardcoded bootstrap constant

**Files:**
- Modify: `package.json` (add `@libp2p/kad-dht` dependency)
- Modify: `src/p2p/node.ts:17-25` (imports, bootstrap constant), `:186-233` (peerDiscovery construction + createLibp2p call)

**Interfaces:**
- Produces: `DEFAULT_BOOTSTRAP_PEERS: string[]` — a new exported constant, currently empty, that Task 6 (DNS-blocked) will eventually populate. Merged into `GSTD_DEFAULT_BOOTSTRAP` the same way the existing `GSTD_BOOTSTRAP_PEERS` env var already is.

- [ ] **Step 1: Add the dependency**

```bash
cd /home/bot/gstdbot
npm install @libp2p/kad-dht
```

- [ ] **Step 2: Add the hardcoded bootstrap constant**

Find in `src/p2p/node.ts` (lines 20-25):

```ts
// ─── Well-known GSTD bootstrap nodes ─────────────────────────────
// Add your node's multiaddr to GSTD_BOOTSTRAP_PEERS env var to
// contribute to bootstrap infrastructure.
const GSTD_DEFAULT_BOOTSTRAP: string[] = (
    process.env.GSTD_BOOTSTRAP_PEERS || ''
).split(',').map(s => s.trim()).filter(Boolean);
```

Replace it with:

```ts
// ─── Well-known GSTD bootstrap nodes ─────────────────────────────
// Add your node's multiaddr to GSTD_BOOTSTRAP_PEERS env var to
// contribute to bootstrap infrastructure.
//
// DEFAULT_BOOTSTRAP_PEERS ships hardcoded (compiled into the software,
// never fetched from a live service) so a brand-new node can join the
// DHT with zero configuration. It is EMPTY today: populating it requires
// a stable DNS record pointing at a project-run node's current address
// (the current bootstrap candidate uses a Cloudflare tunnel URL that
// changes on every restart -- a hardcoded multiaddr needs something
// stable to point at first). See docs/superpowers/specs/2026-08-25-decentralized-discovery-design.md
// section 2 and this plan's Task 6. DO NOT populate this with a
// tunnel URL or any other non-stable address -- an empty list here is
// honest; a stale one silently breaks bootstrap for every new node.
const DEFAULT_BOOTSTRAP_PEERS: string[] = [];

const GSTD_DEFAULT_BOOTSTRAP: string[] = [
    ...DEFAULT_BOOTSTRAP_PEERS,
    ...(process.env.GSTD_BOOTSTRAP_PEERS || '').split(',').map(s => s.trim()).filter(Boolean),
];
```

- [ ] **Step 3: Add DHT to the peer discovery layers**

Find in `src/p2p/node.ts` (lines 180-214):

```ts
        const { createLibp2p } = await import('libp2p');
        const { tcp }          = await import('@libp2p/tcp');
        const { noise }        = await import('@chainsafe/libp2p-noise');
        const { yamux }        = await import('@chainsafe/libp2p-yamux');
        const { identify }     = await import('@libp2p/identify');

        const peerDiscovery: any[] = [];

        // Layer 1: mDNS (LAN)
        if (this.config.enableMdns) {
            try {
                const { mdns } = await import('@libp2p/mdns');
                peerDiscovery.push(mdns({ interval: 20_000 }));
                console.log('    🔍 Discovery: mDNS (LAN)');
            } catch {
                console.log('    ⚠ mDNS unavailable');
            }
        }

        // Layer 2: Bootstrap (WAN)
        if (this.config.bootstrapPeers.length > 0) {
            try {
                const { bootstrap } = await import('@libp2p/bootstrap');
                peerDiscovery.push(bootstrap({
                    list: this.config.bootstrapPeers,
                    timeout: 10_000,
                    tagName: 'gstd-bootstrap',
                    tagValue: 50,
                    tagTTL: 300_000,
                }));
                console.log(`    🌐 Bootstrap: ${this.config.bootstrapPeers.length} known peer(s)`);
            } catch {
                console.log('    ⚠ Bootstrap unavailable');
            }
        }
```

Replace it with (adds a Layer 3 DHT block after the existing two, and imports `kadDHT`):

```ts
        const { createLibp2p } = await import('libp2p');
        const { tcp }          = await import('@libp2p/tcp');
        const { noise }        = await import('@chainsafe/libp2p-noise');
        const { yamux }        = await import('@chainsafe/libp2p-yamux');
        const { identify }     = await import('@libp2p/identify');
        const { kadDHT }       = await import('@libp2p/kad-dht');

        const peerDiscovery: any[] = [];

        // Layer 1: mDNS (LAN)
        if (this.config.enableMdns) {
            try {
                const { mdns } = await import('@libp2p/mdns');
                peerDiscovery.push(mdns({ interval: 20_000 }));
                console.log('    🔍 Discovery: mDNS (LAN)');
            } catch {
                console.log('    ⚠ mDNS unavailable');
            }
        }

        // Layer 2: Bootstrap (WAN)
        if (this.config.bootstrapPeers.length > 0) {
            try {
                const { bootstrap } = await import('@libp2p/bootstrap');
                peerDiscovery.push(bootstrap({
                    list: this.config.bootstrapPeers,
                    timeout: 10_000,
                    tagName: 'gstd-bootstrap',
                    tagValue: 50,
                    tagTTL: 300_000,
                }));
                console.log(`    🌐 Bootstrap: ${this.config.bootstrapPeers.length} known peer(s)`);
            } catch {
                console.log('    ⚠ Bootstrap unavailable');
            }
        } else {
            console.log('    ⚠ Bootstrap: 0 known peers (DEFAULT_BOOTSTRAP_PEERS is empty -- see src/p2p/node.ts)');
        }
```

Then, inside the `createLibp2p({...})` call a few lines below, find:

```ts
        this.node = await createLibp2p({
            addresses: {
                listen:   listenAddrs,
                announce: announceAddrs.length > 0 ? announceAddrs : undefined,
            },
            transports:          [tcp()],
            connectionEncrypters:[noise()],
            streamMuxers:        [yamux()],
            peerDiscovery:       peerDiscovery.length > 0 ? peerDiscovery : undefined,
            services:            { identify: identify() },
        });
```

Replace it with (DHT is registered as a `service`, not a `peerDiscovery` entry -- that's how `@libp2p/kad-dht` integrates; it discovers peers via DHT queries once bootstrap/mDNS have provided at least one initial connection, and is safe to always enable, degrading to a no-op when there are no peers to query yet):

```ts
        this.node = await createLibp2p({
            addresses: {
                listen:   listenAddrs,
                announce: announceAddrs.length > 0 ? announceAddrs : undefined,
            },
            transports:          [tcp()],
            connectionEncrypters:[noise()],
            streamMuxers:        [yamux()],
            peerDiscovery:       peerDiscovery.length > 0 ? peerDiscovery : undefined,
            services:            {
                identify: identify(),
                dht: kadDHT({ clientMode: false }),
            },
        });
        console.log('    🕸️  DHT: enabled (Kademlia, server mode)');
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors. (`@libp2p/kad-dht` ships its own types; if `services.dht` reports a type error because `this.node: any` already erases type-checking here, that's expected and fine -- `this.node` is declared `private node: any = null;` per the existing code.)

- [ ] **Step 5: Manual local verification**

Run: `cd /home/bot/gstdbot && timeout 15 node_modules/.bin/tsx -e "
import { GstdP2PNode } from './src/p2p/node.js';
const n = new GstdP2PNode({ nodeId: 'test-node', walletAddress: 'test', listenPort: 14001, enableMdns: false });
n.start().then(id => { console.log('OK, peer id:', id); process.exit(0); }).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
" 2>&1 | tail -20` (if `tsx` isn't installed, use `npx tsx` instead of `node_modules/.bin/tsx`; if neither works, compile first with `npx tsc --skipLibCheck` and run the equivalent against `dist/p2p/node.js` instead).
Expected: prints `    🕸️  DHT: enabled (Kademlia, server mode)` among the startup log lines, and `OK, peer id: <...>` — confirms DHT initializes without throwing even with zero bootstrap peers and mDNS disabled.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add package.json package-lock.json src/p2p/node.ts
git commit -m "feat: add Kademlia DHT to libp2p mesh for WAN-wide peer discovery"
```

---

### Task 2: Carry each node's public HTTP URL over the libp2p heartbeat protocol

**Files:**
- Modify: `src/p2p/node.ts:39-51` (`HeartbeatSchema`), `:141-148` (`PeerRecord` interface), `:397-409` (`handleHeartbeat`), `:411-438` (`broadcastHeartbeat`), `:440-467` (`sendHeartbeatTo`)

**Interfaces:**
- Produces: `P2PHeartbeat.httpUrl?: string` -- an optional field on the existing exported `P2PHeartbeat` type. Task 3 consumes this: `'heartbeat:received'` events now may carry an `httpUrl`, which is the field Task 3's bridge checks before calling `PeerManager.registerPeer()`.

**Why this task exists:** `PeerManager.forwardToPeer()` (`src/p2p/peers.ts:181-209`) routes over plain HTTP (`fetch(peer.url + '/v1/ollama/completions')`) -- it cannot dial a libp2p multiaddr. Today's `P2PHeartbeat` only carries `multiaddrs` (libp2p-native addresses), so a peer discovered purely via libp2p/DHT has no address `PeerManager` could ever use. This task closes that gap by having each node also announce its existing public HTTP URL (the same tunnel URL `PeerManager` itself already tracks and publishes) over the libp2p heartbeat, so Task 3's bridge has something real to register.

- [ ] **Step 1: Add `httpUrl` to the heartbeat schema**

Find in `src/p2p/node.ts` (lines 39-51):

```ts
const HeartbeatSchema = z.object({
    type: z.literal('heartbeat'),
    nodeId: z.string().min(1).max(128),
    walletAddress: z.string().max(128),
    timestamp: z.number().int().positive(),
    version: z.string().max(32),
    capabilities: z.array(z.string().max(32)).max(20),
    uptime: z.number().nonnegative(),
    cpuCores: z.number().int().min(1).max(1024),
    ramGb: z.number().nonnegative().max(16384),
    gpuAvailable: z.boolean(),
    multiaddrs: z.array(z.string().max(256)).max(10).optional(),
});
```

Replace it with:

```ts
const HeartbeatSchema = z.object({
    type: z.literal('heartbeat'),
    nodeId: z.string().min(1).max(128),
    walletAddress: z.string().max(128),
    timestamp: z.number().int().positive(),
    version: z.string().max(32),
    capabilities: z.array(z.string().max(32)).max(20),
    uptime: z.number().nonnegative(),
    cpuCores: z.number().int().min(1).max(1024),
    ramGb: z.number().nonnegative().max(16384),
    gpuAvailable: z.boolean(),
    multiaddrs: z.array(z.string().max(256)).max(10).optional(),
    // Public HTTP URL (the same tunnel URL PeerManager already tracks) --
    // lets a peer discovered purely via libp2p/DHT become routable over
    // PeerManager's HTTP-based forwardToPeer(). Absent for nodes with no
    // public HTTP endpoint.
    httpUrl: z.string().max(256).optional(),
});
```

- [ ] **Step 2: Add `httpUrl` to the `PeerRecord` interface**

Find in `src/p2p/node.ts` (lines 141-148):

```ts
interface PeerRecord {
    nodeId: string;
    walletAddress: string;
    lastSeen: number;
    capabilities: string[];
    multiaddrs: string[];
    latencyMs: number;
}
```

Replace it with:

```ts
interface PeerRecord {
    nodeId: string;
    walletAddress: string;
    lastSeen: number;
    capabilities: string[];
    multiaddrs: string[];
    latencyMs: number;
    httpUrl?: string;
}
```

- [ ] **Step 3: Store `httpUrl` when a heartbeat is received**

Find in `src/p2p/node.ts` (lines 397-409):

```ts
    private handleHeartbeat(data: P2PHeartbeat): void {
        this.stats.heartbeatsExchanged++;
        this.stats.messagesReceived++;
        this.peers.set(data.nodeId, {
            nodeId: data.nodeId,
            walletAddress: data.walletAddress,
            lastSeen: Date.now(),
            capabilities: data.capabilities,
            multiaddrs: data.multiaddrs || [],
            latencyMs: 0,
        });
        this.emit('heartbeat:received', data);
    }
```

Replace it with:

```ts
    private handleHeartbeat(data: P2PHeartbeat): void {
        this.stats.heartbeatsExchanged++;
        this.stats.messagesReceived++;
        this.peers.set(data.nodeId, {
            nodeId: data.nodeId,
            walletAddress: data.walletAddress,
            lastSeen: Date.now(),
            capabilities: data.capabilities,
            multiaddrs: data.multiaddrs || [],
            latencyMs: 0,
            httpUrl: data.httpUrl,
        });
        this.emit('heartbeat:received', data);
    }
```

- [ ] **Step 4: Announce `httpUrl` when broadcasting (both call sites)**

The node's own public HTTP URL is read the same way `PeerManager` already does it -- from `/tmp/gstd_tunnel_url.txt` (updated live by `tunnel.sh`), falling back to `process.env.GSTD_PUBLIC_URL`. Add a small local helper and use it in both heartbeat-sending methods.

Find in `src/p2p/node.ts` (lines 411-426, the start of `broadcastHeartbeat`):

```ts
    async broadcastHeartbeat(): Promise<void> {
        if (!this.node) return;
        const os = await import('os');
        const hb: P2PHeartbeat = {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            walletAddress: this.config.walletAddress,
            timestamp: Date.now(),
            version: this.config.version,
            capabilities: this.getCapabilities(),
            uptime: process.uptime(),
            cpuCores: os.cpus().length,
            ramGb: Math.round(os.totalmem() / (1024 ** 3)),
            gpuAvailable: false,
            multiaddrs: this.node.getMultiaddrs().map((a: any) => a.toString()),
        };
```

Replace it with:

```ts
    async broadcastHeartbeat(): Promise<void> {
        if (!this.node) return;
        const os = await import('os');
        const hb: P2PHeartbeat = {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            walletAddress: this.config.walletAddress,
            timestamp: Date.now(),
            version: this.config.version,
            capabilities: this.getCapabilities(),
            uptime: process.uptime(),
            cpuCores: os.cpus().length,
            ramGb: Math.round(os.totalmem() / (1024 ** 3)),
            gpuAvailable: false,
            multiaddrs: this.node.getMultiaddrs().map((a: any) => a.toString()),
            httpUrl: this.getPublicHttpUrl(),
        };
```

Find in `src/p2p/node.ts` (lines 440-455, the start of `sendHeartbeatTo`):

```ts
    private async sendHeartbeatTo(peerId: string): Promise<void> {
        if (!this.node) return;
        const os = await import('os');
        const hb: P2PHeartbeat = {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            walletAddress: this.config.walletAddress,
            timestamp: Date.now(),
            version: this.config.version,
            capabilities: this.getCapabilities(),
            uptime: process.uptime(),
            cpuCores: os.cpus().length,
            ramGb: Math.round(os.totalmem() / (1024 ** 3)),
            gpuAvailable: false,
            multiaddrs: this.node.getMultiaddrs().map((a: any) => a.toString()),
        };
```

Replace it with:

```ts
    private async sendHeartbeatTo(peerId: string): Promise<void> {
        if (!this.node) return;
        const os = await import('os');
        const hb: P2PHeartbeat = {
            type: 'heartbeat',
            nodeId: this.config.nodeId,
            walletAddress: this.config.walletAddress,
            timestamp: Date.now(),
            version: this.config.version,
            capabilities: this.getCapabilities(),
            uptime: process.uptime(),
            cpuCores: os.cpus().length,
            ramGb: Math.round(os.totalmem() / (1024 ** 3)),
            gpuAvailable: false,
            multiaddrs: this.node.getMultiaddrs().map((a: any) => a.toString()),
            httpUrl: this.getPublicHttpUrl(),
        };
```

Then add the new `getPublicHttpUrl()` private method. Place it directly above `private handleHeartbeat(data: P2PHeartbeat): void {` (so it's grouped with the other heartbeat-related methods):

```ts
    private getPublicHttpUrl(): string | undefined {
        try {
            const { readFileSync } = require('fs');
            const fromFile = readFileSync('/tmp/gstd_tunnel_url.txt', 'utf-8').trim();
            if (fromFile.startsWith('http')) return fromFile;
        } catch { /* file may not exist yet */ }
        return process.env.GSTD_PUBLIC_URL || undefined;
    }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add src/p2p/node.ts
git commit -m "feat: carry public HTTP URL over libp2p heartbeat protocol"
```

---

### Task 3: Bridge libp2p-discovered peers into PeerManager, with honest source tracking

**Files:**
- Modify: `src/p2p/peers.ts:36-47` (`PeerInfo` interface), `:140-151` (`registerPeer`), `:309-322` (`placeholder`), `:95-97` and `:271` (seed/gossip call sites that construct peers without an explicit source)
- Modify: `src/index.ts` (wire the bridge where `p2pNode` and the gateway's `peerManager` both exist)

**Interfaces:**
- Consumes: `P2PHeartbeat.httpUrl` from Task 2, and `GstdP2PNode`'s existing `'heartbeat:received'` event (already emitted, unchanged by this task).
- Produces: `PeerInfo.source: 'p2p-mesh' | 'http-gossip' | 'kv-fallback'` -- a new required field. `registerPeer(nodeId, url, capabilities, source)` gains a fourth parameter.

**Why `'p2p-mesh'` and not separate `'dht'`/`'mdns'`/`'bootstrap'` values (a deliberate simplification from the spec):** libp2p's `peer:discovery` event (and the `'heartbeat:received'` event this task actually bridges from) does not expose which specific discovery mechanism (DHT query vs. mDNS vs. bootstrap list) found a given peer -- by the time a heartbeat is exchanged, the peer is just "a connected libp2p peer." Attempting to track this distinction would require patching libp2p's internal discovery-service dispatch, which is out of scope for this sub-project. `'p2p-mesh'` honestly represents everything found via `GstdP2PNode` (DHT+mDNS+bootstrap combined) as one source, distinct from `'http-gossip'` (found via `PeerManager`'s own HTTP gossip/seeding) and `'kv-fallback'` (Task 4, the central registry).

- [ ] **Step 1: Add `source` to `PeerInfo` and thread it through every place a `PeerInfo` is constructed**

Find in `src/p2p/peers.ts` (lines 36-47):

```ts
export interface PeerInfo {
    nodeId:       string;
    url:          string;   // public HTTP URL, e.g. https://abc123.lhr.life
    capabilities: string[]; // e.g. ['llama3.2:3b', 'llama3.1:8b']
    version:      string;
    cpuCores:     number;
    ramGb:        number;
    uptime:       number;
    tasksHandled: number;
    lastSeen:     number;   // Date.now()
    latencyMs:    number;   // measured round-trip
}
```

Replace it with:

```ts
export type PeerSource = 'p2p-mesh' | 'http-gossip' | 'kv-fallback';

export interface PeerInfo {
    nodeId:       string;
    url:          string;   // public HTTP URL, e.g. https://abc123.lhr.life
    capabilities: string[]; // e.g. ['llama3.2:3b', 'llama3.1:8b']
    version:      string;
    cpuCores:     number;
    ramGb:        number;
    uptime:       number;
    tasksHandled: number;
    lastSeen:     number;   // Date.now()
    latencyMs:    number;   // measured round-trip
    source:       PeerSource; // which discovery layer found this peer -- honest visibility, not routing logic
}
```

Find in `src/p2p/peers.ts` (lines 140-151, `registerPeer`):

```ts
    registerPeer(nodeId: string, url: string, capabilities: string[]): void {
        if (nodeId === this.selfInfo.nodeId) return;
        const existing = this.peers.get(nodeId);
        this.peers.set(nodeId, {
            nodeId, url, capabilities,
            version: '?', cpuCores: 0, ramGb: 0,
            uptime: 0, tasksHandled: 0,
            lastSeen: Date.now(),
            latencyMs: existing?.latencyMs || 999,
        });
        this.saveToDisk();
    }
```

Replace it with (source defaults to `'http-gossip'`, the existing caller's meaning -- callers that need a different source pass it explicitly, e.g. Task 3 Step 3's bridge):

```ts
    registerPeer(nodeId: string, url: string, capabilities: string[], source: PeerSource = 'http-gossip'): void {
        if (nodeId === this.selfInfo.nodeId) return;
        const existing = this.peers.get(nodeId);
        this.peers.set(nodeId, {
            nodeId, url, capabilities,
            version: '?', cpuCores: 0, ramGb: 0,
            uptime: 0, tasksHandled: 0,
            lastSeen: Date.now(),
            latencyMs: existing?.latencyMs || 999,
            source,
        });
        this.saveToDisk();
    }
```

Find in `src/p2p/peers.ts` (lines 309-322, `placeholder` -- used by the env/GitHub seed loop at lines 93-97 and the gossip-learned-peer path at line 271, both genuinely `'http-gossip'` sources):

```ts
    private placeholder(url: string, nodeId?: string, capabilities?: string[]): PeerInfo {
        return {
            nodeId:       nodeId || url,
            url,
            capabilities: capabilities || [],
            version:      '?',
            cpuCores:     0,
            ramGb:        0,
            uptime:       0,
            tasksHandled: 0,
            lastSeen:     0, // will be updated on first successful ping
            latencyMs:    9999,
        };
    }
```

Replace it with:

```ts
    private placeholder(url: string, nodeId?: string, capabilities?: string[]): PeerInfo {
        return {
            nodeId:       nodeId || url,
            url,
            capabilities: capabilities || [],
            version:      '?',
            cpuCores:     0,
            ramGb:        0,
            uptime:       0,
            tasksHandled: 0,
            lastSeen:     0, // will be updated on first successful ping
            latencyMs:    9999,
            source:       'http-gossip',
        };
    }
```

Find in `src/p2p/peers.ts` (line 118, inside `receiveHeartbeat`, the `peer: PeerInfo = {` literal -- also genuinely `'http-gossip'`, this is the existing HTTP heartbeat receipt path):

```ts
        const existing = this.peers.get(payload.nodeId);
        const peer: PeerInfo = {
            nodeId:       payload.nodeId,
            url:          payload.url,
            capabilities: payload.capabilities,
            version:      payload.version,
            cpuCores:     payload.cpuCores,
            ramGb:        payload.ramGb,
            uptime:       payload.uptime,
            tasksHandled: payload.tasksHandled,
            lastSeen:     Date.now(),
            latencyMs:    measuredLatency || existing?.latencyMs || 999,
        };
```

Replace it with:

```ts
        const existing = this.peers.get(payload.nodeId);
        const peer: PeerInfo = {
            nodeId:       payload.nodeId,
            url:          payload.url,
            capabilities: payload.capabilities,
            version:      payload.version,
            cpuCores:     payload.cpuCores,
            ramGb:        payload.ramGb,
            uptime:       payload.uptime,
            tasksHandled: payload.tasksHandled,
            lastSeen:     Date.now(),
            latencyMs:    measuredLatency || existing?.latencyMs || 999,
            source:       existing?.source === 'p2p-mesh' ? 'p2p-mesh' : 'http-gossip',
        };
```

(This last line preserves `'p2p-mesh'` as the recorded source if a peer was originally found via the bridge and later ALSO sends an HTTP heartbeat -- the more specific, earlier-discovered source wins rather than being silently overwritten to the generic HTTP path.)

- [ ] **Step 2: Guard against loading old `peers.json` entries with no `source` field**

Find in `src/p2p/peers.ts` (lines 290-300, `loadFromDisk`):

```ts
    private loadFromDisk(): void {
        try {
            if (!existsSync(PEERS_FILE)) return;
            const raw = JSON.parse(readFileSync(PEERS_FILE, 'utf-8'));
            if (Array.isArray(raw)) {
                for (const p of raw) {
                    if (p.nodeId && p.url) this.peers.set(p.nodeId, p);
                }
            }
        } catch { /* ignore corrupt file */ }
    }
```

Replace it with (a `peers.json` written before this task shipped won't have a `source` field -- default it rather than carrying an `undefined` into a type declared as required):

```ts
    private loadFromDisk(): void {
        try {
            if (!existsSync(PEERS_FILE)) return;
            const raw = JSON.parse(readFileSync(PEERS_FILE, 'utf-8'));
            if (Array.isArray(raw)) {
                for (const p of raw) {
                    if (p.nodeId && p.url) this.peers.set(p.nodeId, { ...p, source: p.source || 'http-gossip' });
                }
            }
        } catch { /* ignore corrupt file */ }
    }
```

- [ ] **Step 3: Wire the bridge in `src/index.ts`**

Find the P2P mesh startup section in `src/index.ts` (added/modified by the resilience-fix sub-project earlier this session -- search for `retryMeshInBackground` and the `if (swarm) swarm.setP2PNode(p2pNode);` lines to locate both the success path and the retry-success path):

```bash
grep -n "swarm.setP2PNode\|p2pNode.start()" src/index.ts
```

At EACH place `swarm.setP2PNode(p2pNode)` (or the retry equivalent) is called after a successful `p2pNode.start()`, add a listener that bridges heartbeats into the gateway's `PeerManager`. The gateway server instance (holding `peerManager`) must already exist by this point in `main()` -- confirm via `grep -n "new GatewayServer\|gatewayServer" src/index.ts` and use whatever the existing local variable name is (do not invent a new one; if the gateway server exposes `peerManager` as a private field with no public getter, add a small public getter `getPeerManager(): PeerManager | null` to `src/gateway/server.ts` right next to the existing `private peerManager: PeerManager | null = null;` field, and use that).

Add this wiring immediately after each successful `p2pNode.start()` call (both the initial synchronous attempt and the background retry's eventual success):

```ts
p2pNode.on('heartbeat:received', (data: any) => {
    if (!data.httpUrl) return; // no HTTP address to route to -- nothing to bridge
    const pm = gatewayServer.getPeerManager?.() ?? null; // use the real variable name found above
    pm?.registerPeer(data.nodeId, data.httpUrl, data.capabilities || [], 'p2p-mesh');
});
```

- [ ] **Step 4: Add the `getPeerManager()` getter if needed**

If Step 3's grep showed `peerManager` has no existing public accessor, find in `src/gateway/server.ts`:

```ts
    private peerManager: PeerManager | null = null;
```

Add directly below it:

```ts
    private peerManager: PeerManager | null = null;

    getPeerManager(): PeerManager | null {
        return this.peerManager;
    }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/bot/gstdbot
git add src/p2p/peers.ts src/index.ts src/gateway/server.ts
git commit -m "feat: bridge libp2p-discovered peers into PeerManager with source tracking"
```

---

### Task 4: Last-resort central-registry fallback in PeerManager

**Files:**
- Modify: `src/p2p/peers.ts:74-106` (`start()`)

**Interfaces:** None new -- uses the existing `registerPeer`/`placeholder` pattern from Task 3, with `source: 'kv-fallback'`.

**Why this task exists:** confirmed by reading the code (Task-writing investigation) that no central-KV fallback exists today -- `PeerManager.start()` only seeds from `GSTD_SEED_PEERS` (env) and the GitHub seed file. If both are empty or unreachable, a node has zero peers with no further fallback (mDNS is a separate system, not part of `PeerManager`). This task adds the explicit last-resort step the spec calls for.

- [ ] **Step 1: Add the central-registry fallback step**

Find in `src/p2p/peers.ts` (lines 74-106, `start()`):

```ts
    async start(): Promise<void> {
        // 1. Seed peers from env
        const envSeeds = (process.env.GSTD_SEED_PEERS || '')
            .split(',').map(s => s.trim()).filter(s => s.startsWith('http'));

        // 2. Also fetch seed URL from GitHub (Pi bootstrap node publishes its tunnel URL there)
        const githubSeeds: string[] = [];
        try {
            const resp = await fetch(
                `https://raw.githubusercontent.com/gstdcoin/ai/main/gstd-seed-peers.txt?t=${Math.floor(Date.now() / 60000)}`,
                { signal: AbortSignal.timeout(4000) }
            );
            if (resp.ok) {
                const urls = (await resp.text()).split('\n').map(s => s.trim()).filter(s => s.startsWith('http'));
                githubSeeds.push(...urls);
            }
        } catch { /* GitHub unavailable — use env seeds */ }

        const allSeeds = [...new Set([...envSeeds, ...githubSeeds])];
        for (const url of allSeeds) {
            if (url !== this.selfInfo.url) {
                this.peers.set(url, this.placeholder(url));
            }
        }

        // 3. Ping all known peers immediately
        await this.pingAll();

        // 4. Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.heartbeatAll(), HEARTBEAT_INTERVAL);

        console.log(`[Peers] Started. Known peers: ${this.peers.size} (${githubSeeds.length} from GitHub) | Self: ${this.selfInfo.url}`);
    }
```

Replace it with (adds step 2.5: only attempted if env+GitHub together yielded zero peers, clearly logged either way):

```ts
    async start(): Promise<void> {
        // 1. Seed peers from env
        const envSeeds = (process.env.GSTD_SEED_PEERS || '')
            .split(',').map(s => s.trim()).filter(s => s.startsWith('http'));

        // 2. Also fetch seed URL from GitHub (Pi bootstrap node publishes its tunnel URL there)
        const githubSeeds: string[] = [];
        try {
            const resp = await fetch(
                `https://raw.githubusercontent.com/gstdcoin/ai/main/gstd-seed-peers.txt?t=${Math.floor(Date.now() / 60000)}`,
                { signal: AbortSignal.timeout(4000) }
            );
            if (resp.ok) {
                const urls = (await resp.text()).split('\n').map(s => s.trim()).filter(s => s.startsWith('http'));
                githubSeeds.push(...urls);
            }
        } catch { /* GitHub unavailable — use env seeds */ }

        const allSeeds = [...new Set([...envSeeds, ...githubSeeds])];
        for (const url of allSeeds) {
            if (url !== this.selfInfo.url) {
                this.peers.set(url, this.placeholder(url));
            }
        }

        // 2.5. Last resort: central registry, ONLY if env + GitHub seeding found nothing.
        // This is deliberately the bottom of the fallback chain, not a routine source --
        // logged clearly so an operator can see the network degraded to it.
        if (allSeeds.length === 0) {
            console.log('[Peers] No env/GitHub seeds found — falling back to central registry (app.gstdtoken.com)');
            try {
                const apiBase = process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com';
                const resp = await fetch(`${apiBase}/api/v1/nodes/list`, { signal: AbortSignal.timeout(8000) });
                if (resp.ok) {
                    const data: any = await resp.json();
                    const nodes: any[] = Array.isArray(data) ? data : (data.nodes || []);
                    let added = 0;
                    for (const n of nodes) {
                        const url = n.node_url || n.url;
                        const nodeId = n.node_id || n.id;
                        if (url && nodeId && url !== this.selfInfo.url && !this.peers.has(nodeId)) {
                            this.peers.set(nodeId, { ...this.placeholder(url, nodeId, n.capabilities || []), source: 'kv-fallback' });
                            added++;
                        }
                    }
                    console.log(`[Peers] Central registry fallback added ${added} peer(s)`);
                }
            } catch (e: any) {
                console.log(`[Peers] Central registry fallback failed: ${e.message} — starting with 0 peers, relying on P2P discovery`);
            }
        }

        // 3. Ping all known peers immediately
        await this.pingAll();

        // 4. Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.heartbeatAll(), HEARTBEAT_INTERVAL);

        console.log(`[Peers] Started. Known peers: ${this.peers.size} (${githubSeeds.length} from GitHub) | Self: ${this.selfInfo.url}`);
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/bot/gstdbot
git add src/p2p/peers.ts
git commit -m "feat: add central-registry as explicit last-resort peer-seed fallback"
```

---

### Task 5: Unit tests for source-tracking and fallback logic

**Files:**
- Create: `src/p2p/peers.test.ts`

**Interfaces:**
- Consumes: `PeerManager`, `PeerInfo`, `PeerSource` from Task 3's `src/p2p/peers.ts`.

- [ ] **Step 1: Read the existing test conventions**

Run: `cat src/lib/platform-health.test.ts` (from the resilience-fix sub-project earlier this session) to match this repo's vitest import style and structure exactly.

- [ ] **Step 2: Write the test file**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PeerManager } from './peers.js';

describe('PeerManager source tracking', () => {
    let pm: PeerManager;

    beforeEach(() => {
        pm = new PeerManager({
            nodeId: 'self-node',
            url: 'https://self.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 0,
            tasksHandled: 0,
        });
    });

    it('registerPeer defaults to http-gossip source', () => {
        pm.registerPeer('peer-a', 'https://peer-a.example.com', ['llama3.2:3b']);
        const peers = pm.getAllPeers();
        expect(peers).toHaveLength(1);
        expect(peers[0].source).toBe('http-gossip');
    });

    it('registerPeer accepts an explicit source', () => {
        pm.registerPeer('peer-b', 'https://peer-b.example.com', ['llama3.2:3b'], 'p2p-mesh');
        const peers = pm.getAllPeers();
        expect(peers[0].source).toBe('p2p-mesh');
    });

    it('does not overwrite self', () => {
        pm.registerPeer('self-node', 'https://should-not-register.example.com', []);
        expect(pm.getAllPeers()).toHaveLength(0);
    });

    it('receiveHeartbeat preserves an existing p2p-mesh source rather than downgrading to http-gossip', () => {
        pm.registerPeer('peer-c', 'https://peer-c.example.com', ['llama3.2:3b'], 'p2p-mesh');
        pm.receiveHeartbeat({
            nodeId: 'peer-c',
            url: 'https://peer-c.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 100,
            tasksHandled: 5,
        });
        const peers = pm.getAllPeers();
        expect(peers[0].source).toBe('p2p-mesh');
    });

    it('receiveHeartbeat from a genuinely new peer records http-gossip', () => {
        pm.receiveHeartbeat({
            nodeId: 'peer-d',
            url: 'https://peer-d.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 100,
            tasksHandled: 5,
        });
        const peers = pm.getAllPeers();
        expect(peers[0].source).toBe('http-gossip');
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd /home/bot/gstdbot && npx vitest run src/p2p/peers.test.ts`
Expected: all 5 tests pass. (Note: `PeerManager`'s constructor calls `this.loadFromDisk()`, which reads a real file path under `GSTD_CONFIG_DIR`/`~/.config/gstdbot/peers.json` -- if this test run picks up a real, non-empty `peers.json` from this machine's actual node, the "does not overwrite self" and count-based assertions could see extra entries. If any test fails with an unexpected peer count, set `GSTD_CONFIG_DIR` to a throwaway temp directory before running: `GSTD_CONFIG_DIR=/tmp/gstd-test-$(date +%s) npx vitest run src/p2p/peers.test.ts` — and note this in your report so a future run knows to do the same.)

- [ ] **Step 4: Confirm the full suite is still clean**

Run: `cd /home/bot/gstdbot && npx vitest run`
Expected: all test files pass (the 2 existing files from prior sub-projects plus this new one).

- [ ] **Step 5: Commit**

```bash
cd /home/bot/gstdbot
git add src/p2p/peers.test.ts
git commit -m "test: add PeerManager source-tracking coverage"
```

---

### Task 6: BLOCKED — stable DNS record for production bootstrap addressing

**Files:** None — this task cannot be completed by an implementer, human or agent, without external action first.

**This task is explicitly blocked on a human prerequisite the plan cannot satisfy:**

`DEFAULT_BOOTSTRAP_PEERS` (Task 1) ships empty because there is no stable address to point it at yet. To populate it with a real value like `/dns4/bootstrap1.yourdomain.example/tcp/4001/p2p/<peer-id>`, the following must happen OUTSIDE this codebase, by the project operator:

1. Choose a domain/subdomain you control (not `app.gstdtoken.com` — that's the application being decommissioned as a dependency, not a P2P bootstrap address).
2. Create a DNS A/AAAA record for that subdomain pointing at this Pi's current public IP, OR set up a dynamic-DNS service if the IP isn't static, OR route it through a stable reverse proxy/tunnel with a fixed hostname (distinct from the current per-restart Cloudflare tunnel URL).
3. Confirm port `4001` (or whatever `GSTD_P2P_PORT` is configured to) is reachable from the public internet at that address (may require router/firewall port-forwarding if this Pi is behind NAT).
4. Once (1)-(3) are done, get this node's own libp2p peer ID (printed at boot: `🌐 P2P Node: <peerId>...` — the full ID is available via `p2pNode.start()`'s return value or `GstdP2PNode.getStats()`), and construct the multiaddr: `/dns4/<your-subdomain>/tcp/<port>/p2p/<full-peer-id>`.
5. Add that multiaddr to `DEFAULT_BOOTSTRAP_PEERS` in `src/p2p/node.ts` (Task 1), commit, and this node becomes a real, working bootstrap point for every future new node on the network.

- [ ] **Step 1: STOP here if you are an agent executing this plan.** Do not invent, guess, or fabricate a domain/IP/multiaddr to unblock this task. Report this task as BLOCKED to the human operator with the five numbered steps above, and continue to Task 7 (final verification) without it — Tasks 1-5 do not depend on this one being complete; they were explicitly designed not to.

---

### Task 7: Local integration test — DHT/mDNS-only discovery, single-node survivability

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Full clean build and test suite**

```bash
cd /home/bot/gstdbot
npx tsc --skipLibCheck
npx vitest run
```
Expected: both clean.

- [ ] **Step 2: Single-node survivability check**

With no other gstdbot instances running and `DEFAULT_BOOTSTRAP_PEERS` still empty (Task 6 unresolved, as expected), start a node locally in isolation and confirm it boots without a fatal error and serves a basic request:

```bash
cd /home/bot/gstdbot
GSTD_NODE_ID=survivability-test GSTD_P2P_PORT=15001 GSTD_DASHBOARD_PORT=15080 timeout 30 node dist/index.js 2>&1 | tee /tmp/survivability-test.log &
sleep 15
curl -s -o /dev/null -w "dashboard health -> %{http_code}\n" http://localhost:15080/api/node/status
wait
grep -c "FATAL\|Uncaught" /tmp/survivability-test.log || echo "0 fatal errors"
```
Expected: dashboard health returns `200`, and `grep -c "FATAL\|Uncaught"` finds `0` (or the fallback echo prints, meaning grep found nothing). The DHT/bootstrap log lines should show `0 known peer(s)` (expected, Task 6 unresolved) without the process crashing.

- [ ] **Step 3: Two-node local discovery test (mDNS, since DHT has no reachable bootstrap yet)**

```bash
cd /home/bot/gstdbot
GSTD_NODE_ID=node-a GSTD_P2P_PORT=15001 GSTD_DASHBOARD_PORT=15080 GSTD_P2P_MDNS=true timeout 30 node dist/index.js > /tmp/node-a.log 2>&1 &
sleep 3
GSTD_NODE_ID=node-b GSTD_P2P_PORT=15002 GSTD_DASHBOARD_PORT=15081 GSTD_P2P_MDNS=true timeout 30 node dist/index.js > /tmp/node-b.log 2>&1 &
sleep 20
grep -i "peer:connected\|heartbeat:received\|Bootstrap connections" /tmp/node-a.log /tmp/node-b.log | head -20
wait
```
Expected: at least one log line in either file showing the two local instances discovered and connected to each other via mDNS (both are on the same machine, so mDNS's LAN discovery should find them within the 20s window). This confirms discovery works without any call to `app.gstdtoken.com` or GitHub having succeeded (both nodes' own logs can be checked for the absence of a "Central registry fallback" line, confirming P2P/mDNS found peers before that fallback was needed — though note both instances also have zero env/GitHub seeds configured here, so `PeerManager`'s central-KV fallback WOULD fire for each independently; this step is specifically testing the libp2p/mDNS layer, not asserting the KV fallback never fires for `PeerManager`'s separate peer list).

- [ ] **Step 4: Report completion**

No further action if Steps 1-3 pass. This closes out Tasks 1-5 and 7 of the "decentralized-discovery" sub-project. Task 6 remains explicitly open, blocked on the human DNS prerequisite described there — report its five steps clearly to the user rather than letting it silently disappear from tracking. Remaining sub-projects from the original decomposition (C: decentralized inference routing, D: decentralized task/reward attestation, E: decentralized balance ledger) are separate, not started by this plan.
