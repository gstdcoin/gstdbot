# GSTD 3.7 — панель оператора / Operator dashboard

## Русский

Откройте адрес панели из установщика, обычно `http://localhost:8080`. У текущей машины — `http://100.93.119.75:8081` через Tailscale. Войдите с существующим PIN. Для первого входа используйте токен `~/.config/gstdbot/setup-token` на машине и новый PIN из 8–12 цифр. Секреты не отправляйте в чат. При первом запуске токен создаётся локально с правами 0600, если не задан явно. Для Docker он находится в /data/gstdbot/setup-token; прочитать его на своей машине можно командой `docker exec gstd-node cat /data/gstdbot/setup-token`. Токен не выводится в журналы.

### Выбор и установка модели

1. Откройте «Каталог моделей» → «Выберите модель из интернета».
2. В списке доступны проверенные локальные варианты Qwen 3.5, Gemma 4, Qwen 3 Coder, GPT OSS и небольшие модели предыдущего поколения для слабых машин.
3. Для выбранной модели показаны размер загрузки, оценка RAM и совместимость: подходит по ресурсам, нужно освободить RAM, недостаточно RAM/диска либо ресурсы удалённого Ollama неизвестны.
4. Нажмите «Скачать модель» и дождитесь прогресса. После загрузки модель появляется в списке чата.
5. «Проверить каталог в интернете» сверяет размеры с официальным реестром Ollama; частота ограничена одним обновлением в 6 часов. Обычное открытие каталога не обращается к реестру.
6. В расширенном разделе можно указать другую локальную модель по имени. Теги cloud не разрешены.

Оценка предусматривает запас для ОС и короткий текстовый контекст. Она не гарантирует скорость, совместимость драйверов или запуск большого контекста. Для неизвестного удалённого Ollama не используются характеристики этой машины как доказательство совместимости. GPU без подтверждённых драйверов не выдаётся за гарантированное ускорение; VRAM разных машин не складывается.

Источники моделей: [Qwen 3.5](https://ollama.com/library/qwen3.5), [Gemma 4](https://ollama.com/library/gemma4), [оборудование Ollama](https://docs.ollama.com/gpu), [память и контекст](https://docs.ollama.com/faq). Если Ollama сообщает о старой версии, обновите её отдельно; драйверы установщик GSTD не заменяет.

### Привязка своего кошелька

В разделе «Кошелёк начислений» вставьте публичный адрес своего TON-кошелька (Tonkeeper и т. п.), отметьте применение к новым заданиям и нажмите **«Привязать мой кошелёк»**. Дождитесь подтверждения платформы. Seed-фраза и приватный ключ не нужны.

Адрес идентичности ноды показан отдельно и остаётся прежним. Привязка определяет получателя будущей принятой оплаченной работы; уже назначенные задания и ранее начисленные средства сохраняют прежнего получателя. Это не перевод старых балансов. Подмена адреса и повтор старой команды блокируются подписью и ревизией.

Указание публичного адреса не доказывает владение кошельком. Для доступа к его балансу нужна авторизация на [платформе](https://app.gstdtoken.com/payments). Получение и вывод не удерживают дополнительную комиссию GSTD; газ TON оплачивает подписант выплаты. Только принятая оплаченная работа делится 85/10/5; локальный и бесплатный чат не создают токены.

### Нагрузка и обновление

Панель показывает CPU, RAM, вычислительные слоты, HTTP-запросы с момента запуска, uptime, регистрацию и последний heartbeat. Это локальные измерения, не денежная статистика. Обновление раз в 30 секунд работает только в видимой вкладке и не опрашивает Cloudflare.

Обновление ноды запускается вручную: проверьте версию, изучите изменения, подтвердите установку/перезапуск. Git fast-forward, npm ci и полная сборка сохраняют ключи и конфигурацию; изменённые tracked-файлы не перезаписываются. Во время вычисления обновление отклоняется. Процесс должен запускаться через PM2/systemd для автоматического возврата после перезапуска.

Docker обновляется на машине: `git pull --ff-only`, `docker compose build`, `docker compose up -d`. Не используйте Git-обновление панели внутри контейнера.

### Linux и несколько машин

Проверка среды без установки:

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash -s -- --check
```

Установка с автоматическим выбором небольшой стартовой модели:

```bash
curl -fsSL https://raw.githubusercontent.com/gstdcoin/gstdbot/main/install.sh | bash
```

Вместо автоматического выбора доступны `--model=qwen3.5:0.8b` и `--no-model`. Основные цели — Linux x86-64/ARM64 и WSL2. 32-битные ARM и нативный Windows не поддерживаются этим Bash-установщиком; для Windows нужен WSL2. macOS — best-effort и не подтверждён чистой установкой. На неизвестном дистрибутиве заранее установите Node.js 20+, npm, git и curl. Отдельные CPU, GPU и драйверы требуют проверки Ollama. Поддержка буквально любого устройства не заявляется.

Для нескольких Linux-хостов создайте `hosts.txt` (один SSH-адрес в строке) и используйте [пакетный установщик](../scripts/install-cluster.sh):

```bash
bash scripts/install-cluster.sh --hosts hosts.txt --wallet PUBLIC_TON_ADDRESS --plan
bash scripts/install-cluster.sh --hosts hosts.txt --wallet PUBLIC_TON_ADDRESS
```

SSH-доступ и записи known_hosts должны быть настроены заранее. Ключи нод создаются отдельно на каждой машине и не копируются. Существующие адреса/балансы не перезаписываются. Текущий лимит платформы — 10 живых идентичностей на один регистрационный кошелёк. Каждая машина — отдельная нода; это распределение запросов, а не объединение RAM/GPU для одной большой модели. Для прямого платного чата платформы каждой ноде нужен доступный защищённый HTTPS endpoint; пакетный установщик не создаёт туннели автоматически. Исходящая очередь заданий оплаченных кампаний не требует публичного порта. Живого кластера для end-to-end проверки сейчас нет.

## English

Open the dashboard printed by the installer (normally port 8080; this machine uses 8081). Sign in with the existing PIN. First setup uses the local setup token and an 8–12 digit PIN.

- **Models:** select a reviewed local Ollama model from the internet catalog. Read the download size, estimated RAM, resource status and metadata date, then download. Installed models appear in the chat selector. Online metadata refresh is manual and limited to once per 6 hours. The advanced field accepts other local model names; cloud tags are blocked.
- **Compatibility:** estimates include OS headroom and short text context. They do not guarantee runtime, driver support or speed. Remote Ollama hardware is not inferred from the gateway machine. Memory across machines is not pooled.
- **Your wallet:** paste your public TON address, acknowledge that the change applies to new work, and press **Bind my wallet**. Wait for platform confirmation. Node identity is preserved. Previously assigned work and existing balances keep their old recipient; no balances move. Changes use node signatures and revisions. Wallet authentication on the platform is still required to access balances and withdrawals.
- **Load:** CPU, RAM, slots, request count, uptime and heartbeat are local measurements. Visible-tab refresh does not poll Cloudflare.
- **Updates:** manual Git source updates require npm, a successful build and PM2/systemd. Docker uses an image rebuild.
- **Hardware:** Linux x86-64/ARM64 and WSL2 are primary targets. Use `bash install.sh --check` before installation. Native Windows and 32-bit ARM are unsupported by this Bash installer; macOS is best-effort. Model runtime and GPU drivers need validation.
- **Multiple Linux machines:** use `scripts/install-cluster.sh --hosts hosts.txt --wallet PUBLIC_TON_ADDRESS --plan` to validate an inventory before installation. SSH and known_hosts must already be configured. Each host gets an independent identity. The current platform cap is 10 live identities per registration wallet. Direct platform paid chat requires a reachable protected HTTPS endpoint per node; funded campaign tasks can be pulled over an outbound connection without a public port. Automatic tunnels and tensor-parallel multi-host execution are not provided. No physical cluster was available for an end-to-end deployment test.

## Local and network model directory

The model directory combines reviewed download choices, locally installed models and live platform availability. Select **Check network models** to query the platform; this is manual, cached for 60 seconds and shared across concurrent requests. Unknown registry status is distinct from zero available nodes. Local catalog reads remain offline.

The chat selector includes advertised network models after this check. Selecting a remote model does not grant permission to forward the question: explicitly select **Allow other GSTD nodes**. A paid remote model opens a separate workflow on the platform for wallet authentication and funded reservation; the operator panel does not charge a wallet or bypass accounting. Local use of a locally installed model remains local.

Exact model requests fail with `requested_model_unavailable` when unavailable or when an executor reports a different model. Select another model yourself to consent to using it. `auto` remains an explicit choice of the configured default.

Public discovery APIs:
- `https://app.gstdtoken.com/api/v1/models/available`: live models, node counts and catalogue prices.
- `https://app.gstdtoken.com/api/v1/nodes/list`: public node IDs and their current URLs. Temporary tunnel URLs may change.
- A node exposes `GET /v1/models` and `POST /v1/chat/completions`; operator controls require a PIN session.

The private `GET /api/node/model-directory` endpoint supplies cached network model data to the dashboard. The reviewed installation catalogue is not a complete internet index. Manual Ollama names remain available; compatibility is unknown for unreviewed models. Hardware matching is an estimate, not a driver or performance guarantee.

## Installation checks

Use the root `install.sh` as the canonical entry point; `scripts/install.sh` delegates to it. `--check` performs read-only platform checks. Fresh installs may be pinned to an immutable full commit SHA with `GSTD_INSTALL_REF`; this applies to cloning a new checkout, not rewriting an existing installation.

The installer uses Node.js for configuration, includes build dependencies even when `NODE_ENV=production`, preserves existing configuration fields and refuses malformed JSON. Systemd is selected only when its manager is present; otherwise PM2 is installed in the current user's `~/.local` prefix. Reboot startup still depends on the operating system's init/user-session setup. Prefer a dedicated unprivileged operator account for a real compute node.

CI's fresh-source-installer check clones the exact public GitHub commit in a disposable Linux x86-64 container, builds and starts it, then checks first operator access and the packaged catalogue. It uses an Ollama fixture and downloads no real models: it does not certify GPU drivers, inference compatibility or every operating system/architecture. A separate offline container check covers packaged runtime startup without network access.

## Готовность и два пути работы / Readiness and two work paths

В блоке **«Готовность фоновой работы»** видны среда Ollama, установленные модели, регистрация, получатель новых наград, последняя успешная проверка очереди и свободный вычислительный слот. Если адрес ещё не задан, сначала привяжите собственный публичный TON-кошелёк: без него регистрация новой ноды не завершится. Проверки используют уже полученные данные и не добавляют запросов к Cloudflare.

- **Исходящая очередь:** подписанная нода забирает задания из профинансированных кампаний. Для этого публичный IP/туннель не обязателен. Свежая успешная проверка очереди подтверждает связь, но не наличие оплаченного заказа.
- **Прямой чат:** платформа обращается к HTTPS-адресу исполнителя. Указанный адрес не доказывает внешнюю доступность: проверьте ноду в реестре и настройте защищённый маршрут по своей сетевой схеме. Не открывайте Ollama напрямую в интернет.

Счётчик отправленных результатов относится только к фоновой очереди после запуска. Он не включает прямые запросы чата и не является балансом, доказательством принятия или начисления. Оплаченную принятую работу и награды проверяйте в [«Баланс и награды»](https://app.gstdtoken.com/ru/payments?from=node). Реальный вывод в TON подписывает владелец кошелька обеспечения; личная авторизация получателя сама по себе не исполняет перевод.

The **Background work readiness** section shows Ollama, installed models, registration, reward recipient, the last successful task poll and compute capacity. A new node needs its public payout address before registration can finish. These checks reuse data already fetched and add no Cloudflare requests.

- **Outbound queue:** signed nodes pull tasks from funded campaigns without a public port. A successful poll confirms connectivity, not paid demand.
- **Direct chat:** the platform calls the executor’s HTTPS endpoint. A configured address does not prove external reachability; check the registry. Never expose Ollama directly.

Submitted-result counters cover only this process’s background queue. They exclude direct chat requests and do not prove acceptance, paid work or a money balance. Check accepted paid work and rewards on the platform. On-chain payouts require the custody owner’s signature; recipient wallet authentication alone does not execute a transfer.

## Восстановление вручную / Manual recovery gate

Это инструкция владельцу, а не подтверждение выполненного восстановления production.

1. Остановите **только свою ноду** через используемый менеджер (PM2, systemd либо Docker). Не запускайте старую и восстановленную копии одной идентичности одновременно.
2. Сохраните целиком `~/.config/gstdbot/` пользователя, от которого работает нода. Критичные файлы: `config.json`, `attestor-identity.json`, `p2p-identity.json`, `wallet.json`, `dashboard_pin.hash` и `setup-token` (если он ещё используется). Не открывайте и не выводите их содержимое в журналы или чат.
3. Если заданы отдельные `GSTD_CONFIG_DIR` или `GSTD_IDENTITY_DIR`, сохраните и эти каталоги. Сохраните конфигурацию запуска и `.env` из каталога установки; если владелец отдельно использует `node.env` в своей службе, сохраните именно тот файл. Канонический установщик не создаёт отдельный `node.env`.
4. Для Docker сохраните весь том, смонтированный в `/data/gstdbot`, включая вложенные каталоги. В контейнере настройки доступа используют `GSTD_CONFIG_DIR`, а остальные данные могут находиться под `$HOME/.config/gstdbot`; копирование всего тома сохраняет оба пути.
5. Держите копию вне машины в зашифрованном хранилище под контролем владельца. Каталоги с ключами — доступ только владельцу (0700), файлы ключей/PIN/токенов — 0600. Не помещайте копию в GitHub, общий чат или публичный каталог сайта. Проверьте, что архив читается, не публикуя его содержимое.
6. На остановленной целевой ноде восстановите каталог(и) и конфигурацию запуска **до первого запуска**, с правильным владельцем и правами. Не удаляйте повреждённые файлы, чтобы получить новую идентичность: восстановите их из проверенной копии. Сохраните исходную копию отдельно до проверки.
7. Запустите одну копию, проверьте прежний ID ноды, личный адрес новых наград, регистрацию, успешный poll и локальный тест модели. Временный адрес туннеля может смениться; прежний URL не считается доказательством доступности. Подтвердите новый маршрут в реестре.

Owner checklist: stop the existing node; keep an encrypted offline copy of its whole configuration/data directories, persistent identity keys, watch-only wallet, PIN digest and launch environment. Restore ownership and permissions before starting the replacement, and never run two copies of one identity simultaneously. A corrupt identity must be restored, not regenerated. Verify the previous node ID, payout recipient, signed registration, successful polling and inference afterward. No production restore rehearsal has been completed by writing this guide.

## HTTPS form and Let’s Encrypt

The authenticated panel includes **HTTPS and Let’s Encrypt**. This is an optional domain-only setup profile; outbound paid-campaign work and an existing HTTPS tunnel do not require it. It does not add a payment check to the public inference API: direct API calls consume node resources without creating rewards. The dashboard remains PIN protected; Ollama is not proxied directly.

1. Use a domain you control. Its public A/AAAA records and internet ports 80/443 must reach this machine. DNS, router/NAT and firewall changes remain an owner task. Another active web proxy or occupied ports are not stopped or overwritten.
2. On a non-root Debian/Ubuntu systemd installation, the panel shows one local administrator bootstrap command. Run it **on the node machine**, then press **Check HTTPS**. Do not enter a sudo password, keys or DNS-provider credentials in the form. Containers, root-run nodes and other OS/service layouts require an administrator-managed proxy.
3. Enter the domain and email, read the linked Let’s Encrypt terms, and separately allow transmission of those fields and public HTTPS exposure. The form then starts a bounded configuration job. No issuance starts merely because the helper was installed.
4. Success requires a locally verified Let’s Encrypt certificate, hostname, trusted chain, remaining validity and the proxied GSTD health response. File existence or a running service alone is insufficient. External NAT reachability is not independently confirmed. The existing HTTP gateway, working tunnel and registered public URL are not changed automatically.

The bootstrap extracts the Caddy binary from trusted APT package metadata with SHA256 verification, without executing the stock proxy package or starting its service. A root-owned socket-activated helper accepts only strict HTTPS requests from the configured node UID. The node keeps its existing service sandbox; it receives neither root shell access nor certificate private keys. The Caddy admin endpoint is a private Unix socket in a directory unavailable to the node user.

Caddy persists certificate storage and renews certificates automatically. The managed proxy is enabled for boot only after verification. Failed first issuance is stopped; a failed managed replacement restores the old configuration. A control-service crash recovers the pending job without starting another CA attempt. Issuance attempts have a ten-minute cooldown. Replacing an already configured domain is deliberately an administrator task so the form cannot remove a working hostname.

The helper binds one fixed local HTTP port. If the node moves to another port, HTTPS is marked unready; an administrator must review `/etc/gstd-node-https/bootstrap.json`, restart `gstd-node-https-control.service`, then apply the same-domain form configuration. Do not expose arbitrary localhost services through this helper.

Certificate renewal is automatic; privileged software upgrades are not. After a reviewed source update, rerun the local bootstrap to refresh the root-owned helper and binary. It restarts only the control helper, not a working proxy. Activating a new Caddy binary requires an administrator-controlled proxy restart during a maintenance window. Keep `/var/lib/gstd-node-https` private and persistent; it contains CA account and certificate material. Do not upload it to a public repository.

### Настройка HTTPS через форму

Войдите в панель ноды и откройте **HTTPS и Let’s Encrypt**. Для очереди оплаченных заданий и уже работающего HTTPS-туннеля сертификат на самой машине не обязателен.

1. Подготовьте свой домен: A/AAAA должны вести на эту машину, порты 80/443 — быть доступны из интернета. За DNS, роутер и firewall отвечает владелец.
2. Один раз выполните на машине административную команду, показанную в панели. Это устанавливает системный помощник без выпуска сертификата и открытия публичного прокси. Автоматический вариант поддерживает Debian/Ubuntu с systemd и отдельным непривилегированным пользователем ноды.
3. Нажмите **Проверить HTTPS**, заполните домен/email и отдельно подтвердите условия Let’s Encrypt и публичный доступ. Нажмите **Настроить HTTPS автоматически**. Не вводите пароль sudo или приватные ключи в форму.
4. Панель покажет результат проверки сертификата и срок действия. Caddy продлевает сертификат автоматически. После первого сбоя прокси останавливается; неудачное изменение восстанавливает прежнюю конфигурацию. Повторная заявка доступна через десять минут.

Проверка выполняется локально и не подтверждает прохождение внешнего NAT. Рабочий туннель и адрес в реестре не меняются автоматически. Прямой публичный API расходует вычислительные ресурсы без проверки оплаты GSTD и сам не создаёт наград. Для другого домена, обновления системного помощника или изменения его фиксированного порта нужен администратор. Приватные ключи остаются в системном хранилище Caddy; не публикуйте его содержимое.
