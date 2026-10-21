# GSTD Sovereign Network — audit and implementation status

Scope: `gstdcoin/gstdbot` branch `copilot/security-backlog-2026-10-21` (local, **not committed, not pushed, not deployed**).
`contracts` and `gstd-bridge` were **not modified** (read-only inspection of `SettlementMaster.tact`).
No real payouts, no paid APIs and no production changes were made.

## 1. Repository state at audit time

| Repo | Branch | HEAD | Note |
|---|---|---|---|
| ai | copilot/security-backlog-2026-10-21 | 3d7ec9a | local uncommitted security fixes |
| gstdbot | copilot/security-backlog-2026-10-21 | e86f1d5 | + this sovereign module (uncommitted) |
| A2A | master | ef70481 | uncommitted workflow/ReDoS fix |
| web | main | 82a05d6 | uncommitted workflow permissions |
| contracts | master | 9b6c415 | pre-existing local edit, untouched |
| gstd-bridge | main | 7ced38f | pre-existing local edit, untouched |

## 2. What the sovereign core is

`src/sovereign/` — a minimal vertical slice, run as an independent process (`npm run sovereign`):

- **Identity:** Ed25519 key per node (`identity.json`, mode 0600); `nodeId` = public key hex.
- **Objects:** signed envelopes (`node.announce`, `task.publish`, `task.lease`, `task.result`, `task.attest`, `task.finalize`); id = sha256 of canonical body.
- **State:** `Board`, an order-independent set of envelopes. Authority is derived when a task is evaluated (a lease is valid only if signed by the task's publisher; a result only if from the leased worker; an attestation only if from an independent verifier, one vote per verifier).
- **Task type:** `data.fetch` through the `npm-registry` adapter (read-only metadata of an npm package). The registry base URL is local node configuration, never taken from a task.
- **Acceptance:** `verifier-hash-match` — `quorum` independent verifiers must reproduce the same content hash. Mismatch quorum ⇒ `rejected`.
- **Lifecycle:** publish → lease (publisher picks by price → quality → hash tiebreak) → execute → verify → finalize; expired leases are re-assigned; late duplicates do not change a finalized status.
- **Transport:** direct HTTP between nodes: push on emit + pull anti-entropy (`GET /sov/sync?from=`), peer exchange (gossip), persistence of peers and objects, so a restarted node recovers its queue.
- **Ledger:** `computeAccruals` is a pure, deterministic function. Operator pool 85 % (a parameter; **not** confirmed against deployed bytecode), split 70 % execution / 30 % verification, per-node cap, remainder not minted, publisher never rewarded for its own task, idempotent by `accrualId` and by task, subsidy cap. `simulatePayout` always reports `realTransfersExecuted: 0`.
- **Proofs:** `proofBundle` / `verifyProofBundle` let a client verify a result offline without trusting the serving node.

Not a blockchain, not libp2p, no global consensus. The publisher is the coordinator of its own tasks; if it is gone, its tasks stall (there is no central service, but also no takeover).

## 3. Verified by code and real tests

Commands (Windows, Node 26):
```
npx vitest run src/sovereign                       # 25 unit tests
npx vitest run tests/sovereign --testTimeout=180000 # 12 multi-process integration tests (~20 s)
npm test                                           # full suite: 22 files / 179 tests
npx tsc --noEmit ; npx eslint src                  # 0 type errors / 0 lint errors (44 pre-existing warnings)
```
Result at the end of this round: **all green**, integration run 3 times in a row without flakes.

Integration tests start nodes as **separate OS processes** with `GSTD_API_URL` / `GSTD_SWARM_URL` pointed at a dead port and a local HTTP stand-in for the npm registry. A static test asserts that the module contains no `gstdtoken`, `cloudflare`, `workers.dev`, `api.telegram`, `app.gstd` reference.

| Scenario | Test | Result |
|---|---|---|
| A/B/C: 4 processes, discovery via peer exchange (workers/verifier only know the publisher), publish → cheapest worker executes → independent verifier accepts → identical ledger on all nodes (2 accruals, 0 real transfers) | `autonomy.int.test.ts` | PASS |
| Hash-chained history when the source changes; offline proof verification | same | PASS |
| D: idempotency / duplicate delivery | same | PASS |
| G: foreign results/leases and malformed input rejected; admin auth | same | PASS |
| H: late-joining node with a dead bootstrap still syncs | same | PASS |
| Node restart restores queue and ledger from disk | same | PASS |
| E/F/K: worker killed mid-lease → re-assigned; publisher restarted; old worker returns; exactly one execution accrual | same | PASS |
| I: lying worker (tampered hash) → `rejected`, 0 accruals, entity not served | same | PASS |
| J: two isolated 3-process islands settle separately, then are joined and converge (4 accruals everywhere) | same | PASS |

Fixed during the round: `/sov/msg` and `/sov/sync` now register the sender as a peer so connectivity becomes symmetric after one side is introduced; the harness kill logic no longer hangs on Windows.

## 4. Partially confirmed

- **85/10/5 split:** present in `contracts/SettlementMaster.tact` source (`workerShare=85`, `treasuryShare=10`, `protocolShare=5`, owner-callable `UpdateShares`). The deployed `SettlementMasterV2` bytecode and its current shares were **not** verified.
- **Hardware roles:** `suggestRoles` gives weak devices verify/relay roles; unit-level only. **Not run on a Raspberry Pi 4** — a Pi 4 run is a manual follow-up (`npm run sovereign -- --roles verify,relay`, check RAM/CPU and the same scenario with 1 Pi + 2 PCs).
- **Live production** (last check): `gstdtoken.com` 200, `app.gstdtoken.com/api/v1/health` 200; 0 nodes online.

## 5. Documented but not proven

- libp2p/DHT in `src/p2p/node.ts` (heartbeat/task/attestation protocols) — exists, **not** used by the sovereign core and not shown to carry tasks across the WAN.
- `docs/P2P_SETTLEMENT_RFC.md` design — RFC only.
- Legacy swarm agent, dashboard, Telegram, NaaS — depend on the central platform (see `CENTRAL_DEPENDENCIES.md`); only `GSTD_NAAS_ENABLED` is implemented, `GSTD_PLATFORM_ENABLED` is not.

## 6. Not implemented / not verified

- Real payouts, on-chain settlement from the sovereign ledger (forbidden without explicit approval).
- Sybil resistance: announced prices/roles are self-declared; bounded only by per-task budget, no-self-reward and the cap. Task coordinators prefer workers and verifiers on different hosts, but that is a soft preference, not protection. Open problem (needs stake or identity).
- Source-truth: matching hashes prove two nodes saw the same bytes, not that the bytes are true (a source mismatch yields `rejected`).
- NAT traversal / relays across the internet, TLS between nodes, anti-DoS beyond a per-IP rate limit, resource sandboxing of arbitrary jobs (only one fixed read-only adapter exists).
- AI inference provider: **not implemented**. Only data providers exist (`src/sovereign/providers.ts`, one built-in: `npm-registry`).
- Hardware tests (Raspberry Pi, phones), long soak tests, tests across real networks/partitions beyond localhost.
- Scenarios beyond those in the table above (e.g. disk-full, clock skew beyond the 5-minute future check) are not covered.

## 6a. Added after the first audit (implemented and tested)

- **Publisher failover:** a task manifest may name up to 3 `backups`. If coordination (leases/finalize) is silent for `max(5s, 2×leaseMs)` × (rank+1), a backup may issue leases. Backup envelopes are valid only when stamped after that window; nodes not named in the manifest are ignored; coordinators never earn rewards on their own task. Covered by `src/sovereign/failover.test.ts` and a multi-process test that kills the publisher (`tests/sovereign/failover.int.test.ts`). Limits: backups are chosen by the publisher (a colluding publisher plus backup is still a trust assumption); if the publisher and every backup are down, the task still stalls until its deadline.
- **Data provider interface:** `src/sovereign/providers.ts` (`DataProvider`, `ProviderRegistry`); announce and execution go through it.
- **MCP wrapper:** `src/sovereign/mcp.ts`, stdio JSON-RPC, tools `gstd_network_status`, `gstd_list_tasks`, `gstd_query_entity` (re-verifies the proof bundle offline) and `gstd_publish_task` (needs `GSTD_SOV_ADMIN_TOKEN` in the environment, never as an argument). Run: `npm run sovereign:mcp -- --node http://127.0.0.1:7701`.

## 7. Central dependency map (legacy runtime)

| Dependency | Used by | Status |
|---|---|---|
| app.gstdtoken.com platform API / heartbeat / task polling | `platform-link`, `swarm/agent`, `naas/uptime_daemon`, dashboard | CRITICAL for legacy runtime |
| Cloudflare Workers/KV/Pages | `ai` frontend/API, `web` | production hosting (free tier) |
| Telegram Bot API | `channels/telegram.ts` | optional channel; bot token currently shared with the platform (rotate/split) |
| TON RPC / toncenter | wallet, contracts | external, required for on-chain parts |
| npm registry | sovereign `npm-registry` adapter | external **data source**, configurable, not a coordinator |
| **Sovereign core** | `src/sovereign/*` | **none** (test-enforced) |

## 8. Must not go to production yet

Real payouts; any claim of income or "fully decentralized"; settlement from the simulated ledger; the sovereign core as a public network entry point without TLS/auth review; legacy platform with 0 online nodes and a dry-run settlement; shared Telegram token; remaining Dependabot alerts that need major upgrades (see `docs` follow-ups in each repo).

## 9. Next tasks

1. ~~Owner approval to commit/push/open PRs~~ done: changes are merged to `main` in `ai`, `gstdbot`, `web`, `A2A`, `contracts`, `gstd-bridge`.
2. Raspberry Pi 4 and multi-machine runs of `npm run test:sovereign` scenarios.
3. Verify deployed `SettlementMasterV2` shares on-chain (read-only).
4. LLM inference provider (local model / OpenAI-compatible, explicit cost and rate limits).
5. Sybil/reputation design (stake or identity) and TLS between nodes.
6. Dependency updates: done for `contracts` (lockfile + jest 30) and `gstd-bridge` (libp2p 0.57); the rest needs upstream fixes (Tact `protobufjs`).
