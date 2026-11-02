# Recovery verification

The operator panel remains the normal management interface. The command below is
an administrator-only offline check, not a required step for ordinary node use.

Run node scripts/recovery-rehearsal.cjs [configuration-directory] from the node
checkout. It copies selected identity/configuration files into a private temporary
directory, restores them to another private directory, compares SHA-256 digests,
checks JSON and identity preservation, then removes the temporary copies.
It never launches the restored identity, contacts the network, or edits live files.
No credentials or file contents are printed.

This is NOT an off-machine encrypted backup. Arrange an owner-controlled encrypted
backup before claiming disaster recovery. Back up queue/state, identity, configuration
and deployment secrets according to their storage policy. Never run a restored
duplicate identity alongside the original.

On 2026-11-02, the actual node's config.json, p2p-identity.json,
attestor-identity.json, dashboard_pin.hash, wallet.json and wallet_seed.enc passed
the copy/restore integrity check. The live node was not stopped.

The separate sovereign integration suite also passed 13 real-process tests:
worker/publisher termination, persistent queue/identity recovery, backup publisher
takeover and disconnected-island convergence. These tests use temporary isolated
nodes and a local data source. Their ledgers are NOT mainnet GSTD payments and
their results do not prove platform paid-chat recovery or two physical host resilience.

Not yet verified: physical host replacement, encrypted external-backup recovery,
Cloudflare/KV restore, real funded chain settlement and multi-region outages.
