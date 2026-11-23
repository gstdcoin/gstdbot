# Approved updates and the new domain

The dashboard checks the fresh platform-signed release, not the newest commit in `main`. Documentation or unapproved source commits must not cause an available-update notification. The platform's version-check metadata uses the same `nodeReleaseApproved.json` pin as its signer; its installer URL is pinned to that commit.

When the installed commit already matches the approved pin, the update button stays disabled. An update request that nevertheless reaches the node returns `up_to_date` without installing packages, building or restarting. A newer local source checkout is not silently downgraded to an older approved release. Tracked changes block application; untracked local configuration/identity is preserved.

The node fetches the exact approved commit even when `main` has advanced, validates the fetched object, and still requires a fast-forward history. Signature, freshness, branch, operator PIN/session, compute-idle, build and rollback gates remain in place. The browser gets a fresh verified manifest through its authenticated local API rather than a cross-origin request to a hardcoded platform host.

Current canonical API: `https://app.gstdtoken.xyz/api/v1`; swarm origin: `https://app.gstdtoken.xyz`. The updated process normalizes only the known former official `GSTD_API_URL` and `GSTD_SWARM_URL` values. It does not rewrite configuration files, keys or custom/credential-bearing endpoints. Already installed older daemons need a separately approved source update or operator configuration change/restart; changing repository text does not alter a running process.

Read-only investigation on server `bot` on 2026-11-23 found version 3.7.2 at approved commit `ccf459c`, a clean tracked checkout, an advanced remote `main`, and both environment settings still pointing to `app.gstdtoken.com`. This explains the false update notification and remaining old-domain dependency. No daemon restart, PIN retrieval, signed release promotion or installed-source modification was performed by that investigation.

After DNS/HTTPS activation, validate the new platform manifest signature and publish an approved release only after its exact source passes CI. Keep the same release public root and persistent node identity. Never disable signature enforcement to make an update pass.
