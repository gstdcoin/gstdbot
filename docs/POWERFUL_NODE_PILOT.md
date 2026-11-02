# Powerful-node pilot / Подключение мощной ноды

GSTD currently needs independent operators with Linux GPU servers or workstations.
This is an early operational pilot, not a promise of utilization or profit.
Only accepted funded work earns GSTD: 85% executor, 10% protocol, 5% reserve.
Installing a model or staying online does not create rewards.

## Join with the existing panel

1. Use the canonical installer linked from the repository README. Linux x86-64 and
   ARM64 are supported paths; GPU drivers/runtime support still need verification.
   WSL2 and macOS have their own runtime limits. A cluster is multiple independently
   installed nodes; it does not automatically combine GPU memory across machines.
2. Open the operator panel and set the PIN. Bind your own public TON reward wallet;
   no seed phrase is needed. Keep PIN, setup token and node identity private.
3. Pick a model in the catalogue. Check disk/RAM estimates, architecture support and
   the model licence before downloading. For another public GGUF repository, use
   the Hugging Face form. Gated/private/split files are not supported by that form.
4. Install only a model you have resources and rights to serve. Run a local test
   with the exact model selected. Resource estimates do not prove throughput.
5. For direct paid platform chat, configure a stable public domain with the panel's
   HTTPS form. Expose only the protected gateway; never expose Ollama port11434,
   Redis, SSH or secrets. Outbound-only workers support a different campaign flow
   and are not automatically available as direct-chat model endpoints.
6. Check that the platform model directory lists your exact model and that local
   logs show real completed work. Model labels alone do not prove execution.
   Do not publish private prompts as benchmarks.
7. Check payments before assuming income: current withdrawals are owner-signed.
   Autonomous contract withdrawals are under development. Mainnet end-to-end
   deposit/work/payout verification remains a launch prerequisite.

## Приглашение операторам

Нужны независимые Linux-ноды с GPU и достаточной RAM/VRAM под выбранную модель.
Установка, кошелёк, модели, HTTPS, нагрузка и обновления доступны через панель.
Доход и наличие заданий не гарантируются. Награда возникает только за принятую
оплаченную работу; бесплатные запросы и присутствие в сети её не создают.

Начните с одной модели и локальной проверки. Затем проверьте точное название в
сетевом каталоге и доступность HTTPS. Не передавайте PIN, токены, seed-фразы,
приватные ключи или пользовательские запросы.

## Useful voluntary pilot feedback

Report OS/architecture, GPU and VRAM, RAM, installed Ollama version, exact model
tag/GGUF filename, local first-token latency and tokens/second, and whether the
model appears in the public registry. Hardware claims remain unverified until
measured. Do not submit credentials, private IP inventories or customer prompts.

Before onboarding users at scale, test at least two physical independent machines:
remove one during a request; verify a clear error/refund, no duplicate charge,
and recovery without changing the node identity. Single-host process tests do
not establish multi-host or cloud-region resilience.
