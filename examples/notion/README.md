# Notion + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Push Upwork jobs into a Notion database via the official MCP" width="100%"></p>

Turn Upwork job search into a living **Notion database** — no third-party service, no scraping — using the **Upwork official MCP** and [`upwork-cli`](../../). This is a minimal example of **Upwork automation**: [`upwork-to-notion.mjs`](./upwork-to-notion.mjs) is a dependency-free Node script that searches a list of keywords, checks the database for jobs it already added, and creates a Notion page for each **new** one. Together with [`upwork-cli`](../../), this is a lightweight **Upwork Notion integration** for building a shared job-lead tracker without standing up a server.

## Quick start

1. **Create a Notion integration and get a token.** Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration** → give it a name → copy the **Internal Integration Secret** (this is `NOTION_TOKEN`).
2. **Create a database** (a Table, inline or full-page) with exactly these properties:

   | Property | Type |
   |----------|------|
   | `Name` | Title |
   | `Budget` | Text (rich_text) |
   | `Proposals` | Number |
   | `Country` | Select |
   | `Skills` | Multi-select |
   | `JobId` | Text (rich_text) |

   Names and types must match exactly — `Country` and `Skills` options are auto-created on first write, so you don't need to pre-populate them.
3. **Share the database with your integration**: open it in Notion → **•••** menu (top right) → **Connections** → add the integration you just created.
4. **Copy the database ID** from its URL: `notion.so/<workspace>/<DATABASE_ID>?v=...` — the 32-character ID segment is `NOTION_DB`.
5. **Run it**, from the repo root, after `upwork login`:

```sh
NOTION_TOKEN="secret_…" NOTION_DB="…" node examples/notion/upwork-to-notion.mjs
```

Customize the search terms:

```sh
NOTION_TOKEN="secret_…" NOTION_DB="…" \
  KEYWORDS="react,next.js,shopify" LIMIT=15 node examples/notion/upwork-to-notion.mjs
```

Without `NOTION_TOKEN`/`NOTION_DB` set, the script still runs the search but skips Notion — it prints setup instructions and a "would create" preview instead, so you can try it before wiring up Notion.

## Schedule it with cron

Run every 30 minutes and log the output:

```cron
# crontab -e   (macOS/Linux)
*/30 * * * * cd /path/to/upwork-cli && NOTION_TOKEN="secret_…" NOTION_DB="…" node examples/notion/upwork-to-notion.mjs >> ~/upwork-notion.log 2>&1
```

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `NOTION_TOKEN` | *(unset)* | Notion internal integration secret. Required to actually write pages; if unset the script runs in dry-run mode. |
| `NOTION_DB` | *(unset)* | Target database ID. Required alongside `NOTION_TOKEN`. |
| `KEYWORDS` | `n8n automation,GoHighLevel,AI automation` | comma-separated search terms |

`LIMIT` (results per keyword, default `10`) and `ORG` (account alias, default `talent`) can also be overridden, matching the [cron example](../cron/).

## How it works

Each run calls `upwork find_jobs search … --raw` per keyword, parses the JSON string nested in `content[0].text`, and de-dupes within the run by job ID. If Notion is configured, it then queries the database for every existing `JobId` (paginated, so it scales past 100 rows) and skips jobs already present — dedupe state lives in Notion itself, not a local file, so it stays correct across machines and reruns even if a state file would get lost. Each remaining job becomes one `POST /v1/pages`: title → `Name`, raw budget string → `Budget`, `proposal_count` → `Proposals`, `client.country` → `Country`, skills → `Skills` (comma-stripped, since multi-select option names can't contain commas), and the Upwork job id → `JobId`. Secrets (`NOTION_TOKEN`) live only in the environment, never in the repo.

---

Part of [`upwork-cli`](../../), an OAuth wrapper over the official Upwork MCP. See also [Automate Upwork](../../docs/automate-upwork.md) and the [cron alerts example](../cron/) for a Notion-free variant.
