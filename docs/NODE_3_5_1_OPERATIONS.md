# Node 3.5.1 operational contract

The supported platform API is `https://app.gstdtoken.xyz/api/v1`.
`platform.gstdtoken.xyz` is a separate legacy deployment and is not the production registry.

- Register with the operator wallet and persistent Ed25519 node identity.
- Send signed heartbeats; the uptime reporter uses the same identity as the task client.
- Poll with authenticated POST, advertise supported task kinds, run local inference and submit a non-empty result.
- The dashboard calls its own origin, so HTTPS tunnels and nondefault ports work.
- The Cloudflare quick tunnel uses IPv4 and `GSTD_DASHBOARD_PORT`; keep that port aligned with the gateway.
- Publishing rotating tunnel URLs to GitHub is opt-in (`GSTD_PUBLISH_TUNNEL_TO_GITHUB=true`). Registration and heartbeats carry the current URL without rewriting repository history.
- Updates require a clean tracked checkout and fast-forward history. A failed build rolls back before restarting.
- The version comes from the installed package, including after a configuration-file migration.

## Validation

The full node suite passed 202 tests on Linux ARM64, including subprocess failure/recovery scenarios.
The clock-boundary and resource-advertising tests no longer depend on scheduling delays or the host's live load.
The sovereign process closes active connections before waiting for shutdown, allowing publisher/worker restarts to finish.

## Boundaries

One machine can prove registration, task execution, API result acceptance and local recovery.
It cannot prove an independent multi-host mesh or independent verification of its own inference.
Presence rewards are disabled on the platform. Unfunded public test tasks carry no reward.
An accepted task or ledger entry is not an on-chain transfer; settlement needs its own funded, authorized verification.
Telegram is served by the platform webhook; node operators do not need to store a bot token.
