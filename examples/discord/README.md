# Discord + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Send new Upwork jobs to Discord via the official MCP" width="100%"></p>

Get **Upwork Discord alerts** for new jobs — no third-party SaaS, no scraping — straight from the **Upwork official MCP** via [`upwork-cli`](../../). [`upwork-to-discord.mjs`](./upwork-to-discord.mjs) searches Upwork for your keywords, remembers which job IDs it has already posted, and sends only the **new** ones to a Discord channel as rich embeds (title, description snippet, budget, proposal count, client country, skills). It's one of the simplest ways to **automate Upwork** job hunting: point it at a webhook, put it on a schedule, and let Discord be your alert feed.

**Keywords:** Upwork official MCP · automate Upwork · Upwork Discord alerts · Upwork Discord integration · Upwork job alerts · Model Context Protocol.

## Quick start

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook** (or, on a specific channel, **Edit Channel → Integrations → Webhooks**). Pick the channel you want alerts in and copy the webhook URL.
2. Run it (from the repo root, after `upwork login`):

```sh
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…" node examples/discord/upwork-to-discord.mjs
```

Customize the search:

```sh
KEYWORDS="react,shopify,n8n automation" LIMIT=15 DISCORD_WEBHOOK_URL="…" node examples/discord/upwork-to-discord.mjs
```

Run it once with `DISCORD_WEBHOOK_URL` unset and it still searches and dedupes — it just prints what it *would* have posted plus setup instructions instead of calling Discord, so you can sanity-check your keywords before wiring up a real channel.

### Schedule it with cron

```cron
# crontab -e   (macOS/Linux) — every 30 minutes
*/30 * * * * cd /path/to/upwork-cli && DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…" node examples/discord/upwork-to-discord.mjs >> ~/upwork-discord.log 2>&1
```

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `DISCORD_WEBHOOK_URL` | *(unset)* | Discord channel webhook to post to — required to actually send alerts |
| `KEYWORDS` | `AI automation,n8n automation,GoHighLevel,ChatGPT integration,API integration` | comma-separated search terms |
| `LIMIT` | `10` | results per keyword (per `find_jobs search` call) |
| `ORG` | `talent` | account alias passed as `--org` |
| `STATE_DIR` | `~/.upwork-cli/alerts` | where posted job IDs are remembered (`discord-seen.txt`) |

## How it works

For every keyword in `KEYWORDS`, the script shells out to `upwork find_jobs search -p query=<keyword> -p limit=<LIMIT> --org <ORG> --raw`, JSON-parses the MCP envelope's `content[0].text`, and merges the results into one list deduped by job `id`. IDs already recorded in `~/.upwork-cli/alerts/discord-seen.txt` are dropped, so only genuinely new postings remain.

Each new job becomes a Discord embed — title, a trimmed description snippet, budget, proposal count, client country, skills, and the raw job ID (Upwork's search response doesn't include a public job link, so the ID is what you'd feed back into `upwork find_jobs get`) — colored green/yellow/red by how many proposals are already in, as a rough competition signal. Embeds are sent in batches of up to 10 per webhook message (Discord's limit per message), and a job ID is only appended to the "seen" file after it's successfully posted, so a failed webhook call gets retried automatically on the next run instead of being silently dropped.

---

Part of [**upwork-cli**](../../) — an OAuth wrapper over the official Upwork MCP for scripts, dashboards, and automations. See also: **[How to automate Upwork with the official MCP](../../docs/automate-upwork.md)**.
