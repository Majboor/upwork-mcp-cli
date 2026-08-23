# Upwork Job Alerts via Cron (Official MCP)

<p align="center"><img src="./media/cron.png" alt="Scheduled Upwork job alerts via cron and the official MCP" width="100%"></p>

Get **scheduled Upwork job alerts** on your machine — no third-party service — using the **Upwork official MCP** and [`upwork-cli`](../../). The [`upwork-alerts.sh`](./upwork-alerts.sh) script searches a list of keywords, remembers what it has already seen, and surfaces only the **new** jobs (with an optional macOS desktop notification).

## Quick start

```sh
# from the repo root, after `upwork login`
chmod +x examples/cron/upwork-alerts.sh
./examples/cron/upwork-alerts.sh            # prints new jobs, remembers them
```

Customize the search terms:

```sh
KEYWORDS="react,next.js,shopify" LIMIT=15 ./examples/cron/upwork-alerts.sh
```

## Schedule it with cron

Run every 30 minutes and log the output:

```cron
# crontab -e   (macOS/Linux)
*/30 * * * * cd /path/to/upwork-cli && ./examples/cron/upwork-alerts.sh >> ~/upwork-alerts.log 2>&1
```

Prefer a specific set of niches? Set `KEYWORDS` right in the crontab line:

```cron
*/30 9-18 * * 1-5 cd /path/to/upwork-cli && KEYWORDS="n8n automation,GoHighLevel,AI agent" ./examples/cron/upwork-alerts.sh >> ~/upwork-alerts.log 2>&1
```

> On macOS, cron needs Full Disk Access for `cron`/`sh` in System Settings → Privacy for notifications and file access to work reliably. Alternatively use a `launchd` plist.

## Common Upwork search keywords (starter list)

The script ships with a broad default list you can trim to your niche:

**Automation & AI:** `n8n automation` · `GoHighLevel` · `Zapier` · `Make.com` · `AI automation` · `ChatGPT integration` · `OpenAI API` · `AI agent` · `chatbot` · `automation expert`

**Dev:** `React developer` · `Next.js` · `Python automation` · `API integration` · `web scraping` · `data pipeline` · `full stack`

**No-code / platforms:** `Shopify` · `WordPress` · `Airtable` · `Bubble` · `Webflow`

Edit the `KEYWORDS` default at the top of [`upwork-alerts.sh`](./upwork-alerts.sh), or pass your own via the env var.

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `KEYWORDS` | broad list | comma-separated search terms |
| `LIMIT` | `10` | results per keyword |
| `ORG` | `talent` | account alias |
| `STATE_DIR` | `~/.upwork-cli/alerts` | where "seen" job IDs are stored |
| `NOTIFY` | `1` | macOS desktop notification on new jobs |

## How it works

Each run calls `upwork find_jobs search … --raw` per keyword, parses the job IDs, and diffs them against `~/.upwork-cli/alerts/seen.txt`. Only unseen IDs are printed/notified, so you never get the same alert twice.

---

Want scoring + AI proposals too? See the [n8n workflow](../n8n/) and [Automate Upwork](../../docs/automate-upwork.md).
