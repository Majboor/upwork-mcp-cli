# Zapier + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Send Upwork jobs to Zapier via the official MCP" width="100%"></p>

Get **new Upwork job alerts into Zapier** — no third-party scraper, straight from the **Upwork official MCP** via [`upwork-cli`](../../). Zapier has no native Upwork MCP trigger, so [`upwork-to-zapier.mjs`](./upwork-to-zapier.mjs) bridges the gap the simple way: it searches Upwork for your keywords, remembers which jobs it already sent, and pushes each **new** one as plain JSON to a Zapier **Catch Hook**. Once a job lands there, any of Zapier's **6000+ apps** — Sheets, Airtable, Gmail, a CRM, SMS, Slack, whatever — can act on it. It's a lightweight way to **automate Upwork** job hunting without standing up a server, and this **Upwork Zapier integration** stays entirely on your machine: your Upwork tokens never leave it.

**Keywords:** Upwork official MCP · automate Upwork · Upwork Zapier integration.

## Quick start

1. In Zapier, create a Zap: trigger app **"Webhooks by Zapier"** → event **"Catch Hook"**. Skip the optional "pick off a child key" field, continue, and copy the custom webhook URL Zapier gives you (`https://hooks.zapier.com/hooks/catch/…/…/`).
2. Run it, from the repo root, after `upwork login`:

```sh
ZAPIER_HOOK_URL="https://hooks.zapier.com/hooks/catch/…/…/" node examples/zapier/upwork-to-zapier.mjs
```

Customize the search terms:

```sh
ZAPIER_HOOK_URL="https://hooks.zapier.com/hooks/catch/…/…/" \
  KEYWORDS="react,next.js,shopify" LIMIT=15 node examples/zapier/upwork-to-zapier.mjs
```

Without `ZAPIER_HOOK_URL` set, the script still runs the search but skips posting — it prints setup instructions and a "would post" JSON preview instead, so you can sanity-check your keywords before wiring up a real Zap. Once you've run it for real at least once, go back to the Zap editor and click **"Test trigger"** — Zapier will show the flat fields (`id`, `title`, `budget`, …) from that first job, ready to map into whatever action steps you add next.

### Schedule it with cron

Run every 30 minutes and log the output:

```cron
# crontab -e   (macOS/Linux)
*/30 * * * * cd /path/to/upwork-cli && ZAPIER_HOOK_URL="https://hooks.zapier.com/hooks/catch/…/…/" node examples/zapier/upwork-to-zapier.mjs >> ~/upwork-zapier.log 2>&1
```

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `ZAPIER_HOOK_URL` | *(unset)* | Zapier Catch Hook URL. Required to actually POST; if unset the script runs in dry-run mode. |
| `KEYWORDS` | `n8n automation,GoHighLevel,AI automation` | comma-separated search terms |
| `LIMIT` | `10` | results per keyword, per run |

`ORG` (account alias, default `talent`) and `STATE_DIR` (default `~/.upwork-cli/alerts`) can also be overridden, matching the [cron example](../cron/).

## How it works

Each run calls `upwork find_jobs search … --raw` per keyword, parses the JSON string nested in `content[0].text`, and diffs job IDs against `~/.upwork-cli/alerts/zapier-seen.txt`. Only unseen IDs go out — and each one is sent as its own HTTP POST, a single flat JSON object (`id`, `title`, `budget`, `proposals`, `country`, `skills`, `snippet`, `keyword`), rather than a batched array. Catch Hook triggers fire once per POST and Zapier's field-mapping UI samples a flat object best, so one job in equals one Zap run out. A job ID is only appended to the "seen" file after its POST succeeds, so a failed request gets retried on the next run instead of being silently dropped. Secrets (the hook URL) live only in the environment, never in the repo.

---

Part of [`upwork-cli`](../../), an OAuth wrapper over the official Upwork MCP. See also [Automate Upwork](../../docs/automate-upwork.md) and the [cron alerts example](../cron/) for a Zapier-free variant.
