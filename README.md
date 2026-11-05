# GSTD compute node

**Русский:** это программа вычислительной ноды, а Telegram-бот работает в репозитории ai. [Карта проекта и инструкции](https://github.com/gstdcoin/ai/blob/main/docs/INDEX.md).

Share AI compute, earn GSTD from funded accepted work, and use those credits on other nodes.

[Start here / Начните здесь](https://github.com/gstdcoin/ai/blob/main/docs/START_HERE.md) · [Public step-by-step guide](https://gstdtoken.com/docs#get-started)

**Current production profile:** local inference, authenticated operator controls, signed worker identity and 85/10/5 platform accounting. Platform-ledger withdrawals require the custody owner’s signature. The separate [mainnet escrow beta](https://app.gstdtoken.com/escrow-mainnet) uses per-job contracts and beneficiary-signed claims; it does not credit the ledger. A real mainnet payout is still unverified. Nodes hold no treasury keys. There is no guaranteed yield.

- [Supported features and security boundaries](docs/COMPUTE_PROFILE.md)
- [Platform payments](https://app.gstdtoken.com/payments)
- [Deployment and central dependencies](CENTRAL_DEPENDENCIES.md)

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

Link your own public TON wallet in the operator dashboard; no seed is required. Advanced installs may set GSTD_WALLET_ADDRESS for the initial watch-only address. Keep the dashboard PIN and setup token private. Default direct requests remain local; choose network routing explicitly when you want to share a prompt with other executors.


Historical design notes are archived in docs/ARCHIVED_NODE_README.md. They do not describe enabled production features.

## Operator dashboard

Remove unused local models using **Delete model** in the model catalogue and confirm the exact name. Deletion requires an operator session and is blocked during model downloads, active computation, or while the selected model is loaded in Ollama. Wait for automatic unloading, then refresh. Shared model files are retained; deleting a model does not necessarily free its full displayed size. Reuse requires downloading it again.

Manage local models, view CPU/RAM and compute slots, configure the first public payout address and update the node manually in the PIN-protected dashboard. [English and Russian operator guide](docs/OPERATOR_PANEL.md). Bind your own public TON wallet for new rewards without changing node identity; existing balances and assigned work keep their previous recipient. The panel includes a model catalogue with resource estimates and a readiness checklist. Signed outbound workers can pull funded campaign jobs without exposing a public port; direct platform chat additionally needs a reachable protected HTTPS endpoint. Technical readiness is not a promise of paid demand.

### Optional HTTPS

The operator panel can configure a domain-based Let’s Encrypt HTTPS proxy on supported non-root Debian/Ubuntu systemd installs; the privileged installer prepares the narrowly scoped HTTPS component automatically. Certificates renew through Caddy; DNS and public ports remain an owner responsibility. It preserves the current tunnel and does not turn free direct inference into paid work. See [the HTTPS operator instructions](docs/OPERATOR_PANEL.md#https-form-and-lets-encrypt).

### Hugging Face community

Import a public GGUF repository or file link, inspect resource estimates and declared licensing, then download and test with dashboard buttons. [Operator and model-author guide](docs/HUGGINGFACE.md). No hosted-inference key is needed for this public-model flow; installing models alone does not earn tokens.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) plus the additional GSTD network permission. Individuals and companies may participate commercially and build network applications; covered paid network compute settles in canonical GSTD. Unrelated business fees, local-only/free use and native TON gas are outside that payment condition. Other commercial core uses require a separate license. Third-party rights and earlier release licenses remain unchanged. The core is source-available, not OSI open source; the separately licensed [A2A SDK](https://github.com/gstdcoin/A2A) uses Apache-2.0.

The legacy unsigned task-push endpoint is retired (HTTP410). Current direct chat uses the shared compute limit; assigned campaign work uses the signed pull-worker flow. Operator PIN login locks after five failed attempts for fifteen minutes.

## Independent operators and recovery

[Powerful-node pilot / Подключение мощной ноды](docs/POWERFUL_NODE_PILOT.md) explains actual model availability, direct-chat HTTPS requirements and current payment limits. [Recovery verification](docs/RECOVERY_REHEARSAL.md) distinguishes offline restoration checks from an encrypted off-machine backup.
