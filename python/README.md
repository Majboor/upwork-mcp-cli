# upwork-mcp (Python) — the easy way to use the Upwork MCP in Python

A tiny, **zero-dependency** Python wrapper for the **official [Upwork MCP server](https://mcp.upwork.com/mcp)**. Perfect for beginners: it drives the `upwork` CLI (which handles OAuth for you) and hands you back plain Python dicts.

```python
from upwork_mcp import Upwork

up = Upwork()                                  # uses the `upwork` CLI you logged into
for job in up.search("n8n automation", limit=5):
    print(job["title"], "·", job["proposal_count"], "proposals")

job = up.get_job(up.search("shopify")[0]["id"])
print(job["bid_stats"])        # competitor bids: {avg, min, max}
print(job["client_record"])    # client lifetime spend, hires, feedback
```

## Install

```sh
# 1) install + log in to the CLI once (Node)
npm install -g upwork-mcp-cli && upwork login
#    (or clone https://github.com/Majboor/upwork-mcp-cli and run `node bin/upwork.js login`)

# 2) install the Python package
pip install upwork-mcp-cli
#    (from source: pip install ./python)
```

If `upwork` isn't on your PATH, point the client at the CLI file:

```python
up = Upwork(cli="/path/to/upwork-mcp-cli/bin/upwork.js")   # or set env UPWORK_CLI
```

## What you can do

```python
up = Upwork(org="talent")                      # default account alias

up.search("react developer", limit=10)         # list of normalized jobs
up.get_job(job_id)                             # deep intel: bids, client history, connects
up.dashboard()                                 # connects balance, matches, offers, messages
up.profile()                                   # your name, rate, earnings, jobs
up.proposals()                                 # your proposals, each with age_days
up.messages(unread=True)                       # unread client chats
up.rate_insights(level="expert", text="automation")   # going hourly range
up.triage("ai automation", limit=10, enrich=3)        # scored HOT/WATCH/SKIP shortlist

# escape hatch — call ANY of the 46 MCP tools:
up.call("find_jobs", "search", query="python", limit=5)
up.raw("get_freelancer_dashboard", "check", "--org", "talent")   # full MCP payload
```

## Example: a 10-line pre-bid shortlist

```python
from upwork_mcp import Upwork
up = Upwork()
for j in up.triage("GoHighLevel", limit=10, enrich=3):
    print(f"{j['tag']:5} {j['alpha_score']:3}  {j['title'][:50]}  "
          f"({j['proposal_count']} proposals)")
```

## Notes

- **Auth lives in the CLI** (`~/.upwork-cli/`, OAuth 2.1, auto-refresh). This package never sees your tokens.
- **Pure standard library** — no pip dependencies.
- It shells out to the CLI per call, so it needs Node + the `upwork` CLI installed and logged in.

Part of **[upwork-mcp-cli](https://github.com/Majboor/upwork-mcp-cli)** — a CLI + Python wrapper for the Upwork MCP server, with [n8n](../examples/n8n/), cron, and other automation examples.
