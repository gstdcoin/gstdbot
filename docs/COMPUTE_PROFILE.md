# GSTD compute profile

## CPU launch

Use Node.js 22 and npm 11.13.0 (`npm install --global npm@11.13.0`), then install dependencies with `npm ci`. Install Ollama, run `ollama pull qwen2.5:0.5b`, build the node with `npm run build`, then run `npm run start:cpu`. The startup command selects CPU inference with one concurrent task, a 1,024-token default context and the small model used in the execution checks. Supply a public payout address through the node's operator setup.

`GSTD_INFERENCE_DEVICE=cpu` sets `num_gpu=0` in the worker, local chat, direct local API and warm-up requests. `auto` uses Ollama's device selection. The authenticated operator endpoint exposes `inference_device`. Advertised task resources continue to use measured CPU/RAM/disk budgets.

A node is an AI compute worker, not a financial custodian or a general-purpose remote administration panel.

## Supported
- Local Ollama inference and an OpenAI-compatible HTTP endpoint.
- Signed node identity, registration, bounded task polling, result delivery and platform-confirmed earnings.
- The active production consumer is the signed PlatformLink inference worker. The P2P discovery and verified-task research core is retained; its offline/quorum tests are simulations, not evidence of a multi-host production network or real GSTD settlement.
- Operator-authenticated diagnostics, model management and code update with rollback.
- An external, watch-only payout address. New nodes do not create a token spending seed.

## Retired or quarantined
The compute runtime does not start experimental training, arbitrary container compute, storage markets, traffic relay, NaaS, remote host control, node-local Telegram bots or the uptime reward daemon. Their archived sources are retained for reference; their HTTP surfaces return 410. Bot credentials belong only on the platform. Host reset, SSH/OS management, bridge and app installation endpoints are outside the node profile.

Non-core APIs require a dashboard operator session, including usage records and events. Being behind a localhost tunnel does not authenticate a caller. WebSockets require operator authentication and have connection/payload bounds. This release limits JSON bodies to 512 KiB. Source tests cover denied routes and private routing.

## Privacy
Direct node requests default to local inference. If it cannot answer, it does not upload the prompt. Explicit privacy: network permits forwarding through the configured task-network path. Direct peer routing remains experimental; peer HTTP management is operator-gated and must not be opened without a peer-authentication design. Cross-request response caching is off unless explicitly enabled by an internal caller. Collective memory is off by default; public knowledge publication additionally requires GSTD_SHARE_KNOWLEDGE=true. Do not use this flag for private user conversations.

A selected executor necessarily processes the plaintext question. We do not claim encrypted computation, a trusted execution environment, or immunity to a malicious operator. Platform payments retain response text for at most ten minutes for retry; the owner can delete it sooner. Financial receipts retain hashes and amounts.

## Real earnings
Only the platform's funded, accepted work creates GSTD claims. Local fee estimates and usage counters do not mint balances. The split is 85/10/5, and moving earned credits into spendable credits charges no additional fee. Earned credits can pay for another node or request an owner-signed mainnet withdrawal in https://app.gstdtoken.xyz/payments.

No hourly reward, uptime multiplier, staking APY or guaranteed profitability is offered. Operators must account for hardware, electricity, bandwidth, token liquidity and demand. The current production setup has one physical node and centralized platform/custody dependencies; it is not unstoppable or fully decentralized. See CENTRAL_DEPENDENCIES.md.

## Installation and control
Use the canonical install.sh from this repository, then link your own public TON wallet in the PIN-protected operator dashboard. Advanced installs may set GSTD_WALLET_ADDRESS for the initial watch-only address. Keep token-spending and treasury keys off the node; protected node identity keys sign protocol requests. Existing wallet files are preserved, never automatically wiped.

Code pushes run CI only. Container publication requires an explicit workflow dispatch. Update a production node only after CI passes; rollback remains available.

Automatic source updates are off by default; GSTD_AUTO_UPDATE=true is an explicit operator opt-in. The HTTP inference path permits one active request by default (configurable up to four). Operator PINs use salted scrypt; a successful legacy login migrates its digest without changing the PIN.

## 3.7 operational checks

The CLI defaults to localhost and local inference, executes no model-selected host tools and persists no chat history. `--network` is explicit. Use `gstd-node --help` to inspect the installed version’s diagnostic and lifecycle commands.

Fresh script installs save the first-setup token in `~/.config/gstdbot/setup-token` with mode 0600; the token is never printed in install logs. Existing PINs and node keys are preserved. Containers store first-setup data in their configured persistent data directory; use the operator guide to retrieve the local setup token or explicitly provide one securely.

HTTP inference and assigned work share one process-wide compute limit. A busy OpenAI-compatible endpoint returns 429 with Retry-After. A busy node does not poll for another assignment.

Local blockchain/staking and synthetic RevenueEngine startup are disabled; payments are handled by the platform. Corrupt saved node identities are not overwritten or replaced with an ephemeral peer. Restore their backups. A temporary-fixture test covers restoring signing and transport identities; this does not constitute a production Redis disaster recovery drill.

`npm run eval:quality` runs four strict deterministic samples for each installed model, through the local gateway. Set GSTD_EVAL_URL for a different local port and GSTD_EVAL_OUTPUT for a report path. This is a smoke test, not proof of general answer quality. Both malformed structured output and timeouts fail the check.

### Compare managed inference with Vast.ai

Run `node scripts/inference-benchmark.cjs measure > report.json` from a shell that writes UTF-8. Supply existing OpenAI-compatible chat completion URLs using `GSTD_BENCH_URL` and `VAST_BENCH_URL`. Set `GSTD_BENCH_MODEL` and `VAST_BENCH_MODEL` to the exact endpoint model IDs. If an endpoint reports a different alias for the same artifact, set its corresponding `*_BENCH_REPORTED_MODEL`. Verify the deployed model revision and quantization on both endpoints and record them in `BENCH_MODEL_REVISION`. The runner verifies the model ID reported in the stream. The revision is operator-supplied.

Set `GSTD_BENCH_KEY` and `VAST_BENCH_KEY` in the environment if the endpoints require bearer authentication. Use dedicated endpoints or an isolated billing window. The run sends four paired prompts per round, 10 rounds by default. Set `BENCH_ROUNDS` to 1–50. Run cold and warmed endpoints as separate experiments under the same client region and workload. Keep the endpoint, model revision, deployment configuration and test window comparable before making a public claim.

Run `node scripts/inference-benchmark.cjs cost report.json GSTD_TOTAL_USD VAST_TOTAL_USD` with the two measured USD totals. Include charges for unsuccessful attempts and any startup, idle, storage and traffic charges incurred during the dedicated test window, using the same cost boundary on both sides. For GSTD-denominated charges, record the conversion rate and time separately. Leave the cost field unknown if the bill or an equivalent actual cost record is unavailable. A free request may still have an operator infrastructure cost.

The report gives successful requests divided by all attempts, p95 time to the first content delta among successes, and total measured cost divided by successes. This latency is measured at the client. If the gateway buffers generation before sending content, the measurement includes that delay. Timeouts, incorrect answers and incomplete streams count as failures. The report contains no endpoint URLs, credentials, prompts or response text. These four acceptance prompts measure basic task completion at serial load.

The old SwarmAgent assignment consumer is not started: it advertised retired storage/verification work and could upload peer responses to the central platform. The active compute consumer is the signed PlatformLink inference worker. libp2p transport/discovery remains research infrastructure; it is not evidence of independently verified peer execution or decentralized settlement. Operator-gated peer HTTP endpoints are not a working authenticated direct-gossip network. Do not remove their authentication to make discovery appear functional.

### Work availability

Funded campaign tasks use outbound signed polling and do not require a public port. Direct platform chat calls an executor HTTPS endpoint and therefore needs a reachable protected public route. Registration alone is not proof that direct chat can reach a node.

The dashboard separates these paths and reuses local PlatformLink status: successful poll time, submitted results and error phase. Submitted results are not a balance or proof of a captured funded reward, and direct chat requests are not counted as background queue results. Online presence alone earns nothing. No additional external polling is added by the readiness UI.
