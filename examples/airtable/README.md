# Airtable + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Sync Upwork jobs to Airtable via the official MCP" width="100%"></p>

Sync **new Upwork jobs into an Airtable base** — no third-party service, no scraping — using the **Upwork official MCP** and [`upwork-cli`](../../). This is a minimal example of **Upwork automation**: [`upwork-to-airtable.mjs`](./upwork-to-airtable.mjs) is a dependency-free Node script that searches a list of keywords, remembers which jobs it has already synced, and creates only the **new** ones as records in an Airtable table via the REST API. Together with [`upwork-cli`](../../), this gives you a lightweight **Upwork Airtable integration** for building a job pipeline, tracker, or CRM without standing up a server.

## Quick start

1. In Airtable, create a base and a table (any name) with these fields:

   | Field | Type |
   |---|---|
   | `JobId` | Single line text |
   | `Title` | Single line text |
   | `Budget` | Single line text |
   | `Proposals` | Number |
   | `Country` | Single line text |
   | `Skills` | Single line text |
   | `FirstSeen` | Date |

2. Create a personal access token at [airtable.com/create/tokens](https://airtable.com/create/tokens), scoped to `data.records:write` + `data.records:read` on that base. Grab the base ID (`app…`) from the base's URL or the API docs page.
3. Run it, from the repo root, after `upwork login`:

```sh
AIRTABLE_TOKEN="pat…" AIRTABLE_BASE="app…" AIRTABLE_TABLE="Jobs" \
  node examples/airtable/upwork-to-airtable.mjs
```

Customize the search terms:

```sh
AIRTABLE_TOKEN="pat…" AIRTABLE_BASE="app…" AIRTABLE_TABLE="Jobs" \
  KEYWORDS="react,next.js,shopify" LIMIT=15 node examples/airtable/upwork-to-airtable.mjs
```

Without `AIRTABLE_TOKEN` / `AIRTABLE_BASE` / `AIRTABLE_TABLE` set, the script still runs the search but skips writing to Airtable — it prints setup instructions and a "would create" preview instead, so you can try it before wiring up Airtable.

## Schedule it with cron

Run every 30 minutes and log the output:

```cron
# crontab -e   (macOS/Linux)
*/30 * * * * cd /path/to/upwork-cli && AIRTABLE_TOKEN="pat…" AIRTABLE_BASE="app…" AIRTABLE_TABLE="Jobs" node examples/airtable/upwork-to-airtable.mjs >> ~/upwork-airtable.log 2>&1
```

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `AIRTABLE_TOKEN` | *(unset)* | Airtable personal access token (`pat…`). Required to write; if unset the script runs in dry-run mode. |
| `AIRTABLE_BASE` | *(unset)* | Airtable base ID (`app…`). Required to write. |
| `AIRTABLE_TABLE` | *(unset)* | Table name or ID within the base. Required to write. |
| `KEYWORDS` | `n8n automation,GoHighLevel,AI automation` | comma-separated search terms |

`LIMIT` (results per keyword, default `10`), `ORG` (account alias, default `talent`), and `STATE_DIR` (default `~/.upwork-cli/alerts`) can also be overridden, matching the [cron](../cron/) and [Slack](../slack/) examples.

## How it works

Each run calls `upwork find_jobs search … --raw` per keyword, parses the JSON string nested in `content[0].text`, and diffs job IDs against a local state file (`~/.upwork-cli/alerts/airtable-seen.txt`) — the simplest robust way to dedupe against Airtable's write-only REST API without an extra `filterByFormula` lookup on every run. Only unseen jobs are mapped to Airtable's `fields` shape (`JobId`, `Title`, `Budget`, `Proposals`, `Country`, `Skills`, `FirstSeen`) and POSTed to `https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}` in batches of 10 — Airtable's per-request record limit — with a short pause between batches to stay under its ~5 requests/second rate limit. Jobs are only marked "seen" after a successful batch, so a failed sync gets retried on the next run instead of being lost. Secrets (the Airtable token) live only in the environment, never in the repo.

---

Part of [`upwork-cli`](../../), an OAuth wrapper over the official Upwork MCP. See also [Automate Upwork](../../docs/automate-upwork.md) and the [cron](../cron/) and [Slack](../slack/) examples for other delivery targets.
