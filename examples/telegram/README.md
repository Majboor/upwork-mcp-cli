# Telegram + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Get Upwork job alerts in Telegram via the official MCP" width="100%"></p>

Get **Upwork job alerts** pushed straight to a **Telegram** chat or channel — no scraping, no browser bot — using the **Upwork official MCP** and [`upwork-cli`](../../). The [`upwork-to-telegram.mjs`](./upwork-to-telegram.mjs) script searches a list of keywords, remembers what it has already seen, and sends only the **new** jobs to your bot with a formatted HTML message (title, budget, proposal count, client country, skills, snippet).

It's a good starting point if you want **automate Upwork** alerts on a phone instead of a desktop notification — the script is dependency-free (just global `fetch` and `node:child_process`), so it runs anywhere Node runs, including a small VPS or a Raspberry Pi.

## Quick start

1. **Create a bot** — open Telegram, message **[@BotFather](https://t.me/BotFather)**, send `/newbot`, and follow the prompts. You'll get a token that looks like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
2. **Get your chat id** — send any message to your new bot (open a DM with it first, or add it to a group/channel and post there), then visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and read the `"chat":{"id": ...}` field from the JSON response.
3. **Run it**, from the repo root, after `upwork login`:

```sh
export TELEGRAM_BOT_TOKEN="123456789:AA..."
export TELEGRAM_CHAT_ID="123456789"

chmod +x examples/telegram/upwork-to-telegram.mjs
node examples/telegram/upwork-to-telegram.mjs         # searches, dedupes, sends to Telegram
```

Run it with the two Telegram env vars unset and it still searches Upwork and prints what it found — it just skips sending and prints setup steps instead, so you can sanity-check the search side first.

Customize the search terms:

```sh
KEYWORDS="react,next.js,shopify" LIMIT=15 node examples/telegram/upwork-to-telegram.mjs
```

### Schedule it with cron

```cron
# crontab -e   (macOS/Linux)
*/30 * * * * cd /path/to/upwork-cli && TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node examples/telegram/upwork-to-telegram.mjs >> ~/upwork-telegram.log 2>&1
```

Prefer to keep secrets out of the crontab line? Export them in `~/.profile` / a wrapper shell script that the cron job sources instead.

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `TELEGRAM_BOT_TOKEN` | *(required)* | Token from @BotFather. Without it the script prints setup instructions and skips sending. |
| `TELEGRAM_CHAT_ID` | *(required)* | Destination chat/group/channel id. Without it the script prints setup instructions and skips sending. |
| `KEYWORDS` | `python automation,web scraping,API integration,automation expert,data pipeline` | comma-separated search terms |
| `LIMIT` | `10` | results per keyword |

## How it works

Each run calls `find_jobs search -p query=<keyword> -p limit=<LIMIT> --org talent --raw` per keyword via `upwork-cli` (preferring `upwork` on `PATH`, falling back to this repo's `bin/upwork.js`), unwraps the MCP envelope's `content[0].text` JSON string, and diffs job `id`s against `~/.upwork-cli/alerts/telegram-seen.txt`. Only unseen jobs are sent — one `HTML`-formatted `sendMessage` call per job to `https://api.telegram.org/bot<token>/sendMessage`, with a short delay between sends to stay under Telegram's per-chat rate limit. Seen state is written before delivery is attempted, so a Telegram outage doesn't cause the same job to re-alert forever.

---

Part of [`upwork-cli`](../../) — see also [Automate Upwork](../../docs/automate-upwork.md) for the full step-by-step guide to automating Upwork with the official MCP.
