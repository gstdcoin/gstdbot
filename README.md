# GSTD compute node

Share AI compute, earn GSTD from funded accepted work, and use those credits on other nodes.

**Current production profile:** local inference, authenticated operator controls, signed worker identity and 85/10/5 platform accounting. The platform records rewards; an on-chain withdrawal requires the custody owner’s signature. Nodes hold no treasury keys. There is no guaranteed yield.

- [Supported features and security boundaries](docs/COMPUTE_PROFILE.md)
- [Platform payments](https://app.gstdtoken.com/payments)
- [Deployment and central dependencies](CENTRAL_DEPENDENCIES.md)

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

Link your own public TON wallet in the operator dashboard; no seed is required. Advanced installs may set GSTD_WALLET_ADDRESS for the initial watch-only address. Keep the dashboard PIN and setup token private. Default direct requests remain local; choose network routing explicitly when you want to share a prompt with other executors.


Historical design notes are archived in docs/ARCHIVED_NODE_README.md. They do not describe enabled production features.

## Operator dashboard

Manage local models, view CPU/RAM and compute slots, configure the first public payout address and update the node manually in the PIN-protected dashboard. [English and Russian operator guide](docs/OPERATOR_PANEL.md). Bind your own public TON wallet for new rewards without changing node identity; existing balances and assigned work keep their previous recipient. The panel includes a model catalogue with resource estimates and a readiness checklist. Signed outbound workers can pull funded campaign jobs without exposing a public port; direct platform chat additionally needs a reachable protected HTTPS endpoint. Technical readiness is not a promise of paid demand.

### Optional HTTPS

The operator panel can configure a domain-based Let’s Encrypt HTTPS proxy after one local administrator bootstrap on supported non-root Debian/Ubuntu systemd installs. Certificates renew through Caddy; DNS and public ports remain an owner responsibility. It preserves the current tunnel and does not turn free direct inference into paid work. See [the HTTPS operator instructions](docs/OPERATOR_PANEL.md#https-form-and-lets-encrypt).
