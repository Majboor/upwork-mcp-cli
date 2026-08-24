# How to Automate Upwork with the Official MCP (Step-by-Step)

<p align="center"><img src="media/automate.png" alt="Automate Upwork pipeline: search, enrich, score, draft — via the official MCP" width="100%"></p>

*"I automated Upwork using the official MCP"* — here's exactly how, end to end. This guide shows how to **automate Upwork** job hunting, client vetting, and proposal drafting using the **Upwork official MCP server** and [`upwork-cli`](../) — no scraping, no browser bots, no unofficial API.

- [Why the official MCP (not a scraper)](#why-the-official-mcp-not-a-scraper)
- [Step 1 — Log in to the Upwork official MCP](#step-1--log-in-to-the-upwork-official-mcp)
- [Step 2 — Search jobs automatically](#step-2--search-jobs-automatically)
- [Step 3 — Enrich with competitor bids & client history](#step-3--enrich-with-competitor-bids--client-history)
- [Step 4 — Score & triage (HOT / WATCH / SKIP)](#step-4--score--triage)
- [Step 5 — Draft an AI proposal](#step-5--draft-an-ai-proposal)
- [Step 6 — Run it on a schedule (cron or n8n)](#step-6--run-it-on-a-schedule)
- [Responsible automation](#responsible-automation)

## Why the official MCP (not a scraper)

Automating Upwork by scraping HTML or driving a headless browser breaks constantly and violates the Terms of Service. The **Upwork official MCP** is the supported path: it uses your authenticated account and returns structured data — including insights that feel premium, like **competitor bid ranges** and **client lifetime spend**.

## Step 1 — Log in to the Upwork official MCP

```sh
git clone https://github.com/Majboor/upwork-mcp-cli && cd upwork-mcp-cli
npm install
node bin/upwork.js login      # opens your browser once; tokens auto-refresh after
```

## Step 2 — Search jobs automatically

```sh
upwork find_jobs search -p query="n8n automation" -p limit=10 --org talent --table
# filter further:
upwork find_jobs search -p query="GoHighLevel" -p job_type=hourly -p experience_level=expert --org talent
```

Every result prints JSON with `--raw`, so you can pipe it into `jq`, Python, or a database.

## Step 3 — Enrich with competitor bids & client history

The gold is in the per-job detail:

```sh
upwork find_jobs get --json '{"action":"get","params":{"id":"2090580154522211987"}}' --org talent --raw
```

Inside `content[0].text` you'll find `applicationsBidStats` (avg / min / max competitor bid), `jobActivity` (applicants, interviews, invites, hires), the client's lifetime spend, contracts, feedback score, and the connects cost to apply. See **[every data point](data-points.md)**.

## Step 4 — Score & triage

A simple Alpha Score turns those numbers into a decision:

```
score = spend_signal × low_competition × bid_headroom × not_already_hired
```

Tag each job **HOT / WATCH / SKIP** so you only spend connects where you can win. The [n8n workflow](../examples/n8n/) implements this in a Code node you can tweak.

## Step 5 — Draft an AI proposal

Feed the real numbers to an LLM and let it write the cover letter, then submit through Upwork's draft→confirm flow:

```sh
# draft (nothing is sent yet)
upwork manage_proposals create -p job_reference=<id> \
  -p cover_letter="…" -p charged_amount=30 --org talent
# confirm when you're happy
upwork confirm proposal <draft_id> --org talent
```

The [bridge](../examples/n8n/bridge.mjs) exposes `/api/analyze` and `/api/draft` that do this with a local LLM (no API key).

## Step 6 — Run it on a schedule

- **Cron:** wrap the steps above in a shell script and add a crontab entry.
- **n8n (recommended):** import [`upwork-MCP-automation.json`](../examples/n8n/) — it runs the whole routine hourly: multi-keyword search → enrich → score → route → AI analyze → draft → digest.

## Responsible automation

Automating Upwork with the official MCP is powerful — use it well:

- Don't spam proposals; personalize with the real client data.
- Respect Upwork's Terms of Service and rate limits.
- Never expose your tokens (they live in `~/.upwork-cli/`, never in the repo).

---

Related: [What is the Upwork official MCP?](upwork-mcp-server.md) · [Recipes](recipes.md) · [n8n workflow](../examples/n8n/) · back to [README](../README.md)
