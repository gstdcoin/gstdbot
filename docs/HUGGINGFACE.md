# Use a Hugging Face GGUF model with GSTD

GSTD connects model users and independent compute operators. Hugging Face is a source of model files, not an inference fallback: this integration does not send user prompts to Hugging Face or consume hosted inference credits.

## Operator: import, check, use

1. Open your authenticated node dashboard → Models from Hugging Face.
2. Paste a public repository or a single GGUF file link on its default `main` branch. Press **Check repository**. Public ungated models need no API key.
3. The default filter shows candidates that fit the node's resource estimate. You can show all files. **Use suggested file** prefers a fitting Q4_K_M variant; this is a resource/format heuristic, not a quality benchmark or proof of runtime support. A pasted exact file is preserved; another file is never silently substituted.
4. Review the source, declared license, exact filename, size and memory estimate. Check the model card for terms and architecture requirements. Public availability does not automatically permit every commercial use.
5. Press **Download model**. You can cancel this panel's transfer. Ollama may reuse already downloaded parts on retry; other direct Ollama clients are outside this panel's control. Only one panel-managed download runs per node process.
6. After installation, **Test installed model** selects its actual installed ID and the local route. It does not send a question automatically. Ask a short question and check quality and latency before relying on the model.

Model-file lists are cached for six hours; checks and errors are bounded to protect free resources. There is no background Hub crawl. Downloads consume network traffic and disk space; large contexts and parallel requests need more memory. The native Ollama alias uses the repository's mutable default branch, not a pinned revision.

## Model author: attribution without a new distribution pipeline

The node shows the source repository and declared license. Ollama downloads from the original Hugging Face repository; GSTD does not repackage your weights or claim authorship. This version does not introduce model-author royalties or change the agreed 85/10/5 distribution.

If you choose to mention GSTD in your own model card, this plain link is ready to copy:

```markdown
Run this public GGUF locally with a GSTD node: [GSTD operator guide](https://github.com/gstdcoin/gstdbot/blob/main/docs/HUGGINGFACE.md).
Paste this model's repository or file URL in the node's Hugging Face section, review compatibility and licensing, then download and test it.
```

This is an optional author-owned link, not a claim of an official Hugging Face partnership. No announcements or messages were posted on anyone's behalf.

## What the benefit means

- Users can run a selected model locally and explicitly choose when to use another network node.
- Operators can match weights to their equipment and offer their installed models to the network. Downloading a model, keeping a node online or a local test does not create a reward.
- Authors receive visible source/license attribution. A separate author-payment program is not implemented.
- Accepted funded work gives 85% to the executor, 10% to the protocol and 5% to reserve. Paid demand, profitability and withdrawal funding are not guaranteed by this integration.

Node signatures identify an executor; they do not prove model weights or answer correctness. Test a model and inspect its source before offering it for paid work. Wallet ownership and withdrawals use the platform's separate verified-wallet and backed-ledger flow.

## Русский: короткий маршрут

Панель ноды → Модели из Hugging Face → вставьте ссылку репозитория или GGUF-файла → Проверить → выберите предложенный или другой подходящий файл → Скачать → Проверить установленную модель.

Ключ для публичных ungated-моделей не нужен. В интерфейсе видны источник, заявленная лицензия, размер и оценка памяти. Подбор не гарантирует скорость, качество или поддержку архитектуры. Загрузка и отправка вопроса всегда запускаются отдельным действием. Награды появляются только за принятую обеспеченную работу, а не за установку модели. Отдельных выплат авторам моделей в этой версии нет.

## Official references

- https://huggingface.co/docs/hub/ollama
- https://huggingface.co/docs/hub/gguf
- https://huggingface.co/docs/hub/rate-limits
- https://github.com/ollama/ollama/blob/main/docs/api.md
