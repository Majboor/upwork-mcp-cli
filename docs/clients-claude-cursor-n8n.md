# Use the Upwork Official MCP with Claude, Cursor, n8n & Scripts

<p align="center"><img src="media/clients.png" alt="Use the Upwork official MCP with Claude, Cursor, n8n and scripts" width="100%"></p>

The **Upwork official MCP** works with anything that can run a command or call HTTP. This page shows how to connect it to **n8n**, **Claude / Claude Code**, **Cursor**, **ChatGPT-style agents**, and plain **cron/scripts** — all through [`upwork-cli`](../), which handles the OAuth for you.

- [n8n (no-code automation)](#n8n)
- [Claude / Claude Code](#claude--claude-code)
- [Cursor & other MCP clients](#cursor--other-mcp-clients)
- [Cron / shell / Python](#cron--shell--python)
- [The REST bridge](#the-rest-bridge)

## n8n

Import-ready workflows live in [`examples/n8n/`](../examples/n8n/): search Upwork on a schedule → enrich with competitor bids + client history → score → draft AI proposals.

```sh
node examples/n8n/bridge.mjs          # exposes the MCP as REST on :4178
# then in n8n: Workflows → Import from File → examples/n8n/upwork-MCP-automation.json
```

The workflow's HTTP nodes already point at `http://localhost:4178`. Full walkthrough in the [n8n README](../examples/n8n/).

## Claude / Claude Code

The simplest path is to let the agent run the CLI (it already prints JSON with `--raw`):

```sh
upwork find_jobs search -p query="ai automation" -p limit=5 --org talent --raw
```

Or run the [bridge](../examples/n8n/bridge.mjs) as a local REST shim and point your agent's HTTP tool at `http://localhost:4178/api/*` (`/search`, `/job`, `/dashboard`, `/analyze`, `/draft`).

## Cursor & other MCP clients

Because this CLI talks to the **official** `https://mcp.upwork.com/mcp` server, any MCP-aware client can ultimately reach the same tools. The CLI is the quickest way to authenticate (OAuth 2.1 + PKCE) and confirm access, then script against it or expose it via the bridge.

## Cron / shell / Python

```sh
# daily shortlist to a file
upwork find_jobs search -p query=react -p limit=20 --org talent --raw \
  | jq -r '.content[0].text | fromjson | .jobs[] | "\(.id)\t\(.title)"' > ~/upwork-today.tsv
```

Add it to `crontab -e` to run every morning. See more in [Recipes](recipes.md).

## The REST bridge

`examples/n8n/bridge.mjs` is a tiny, dependency-free HTTP wrapper over the CLI:

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/api/search?q=&type=&limit=` | live job search |
| GET | `/api/job?id=` | competitor bids, client history, trust gap |
| GET | `/api/dashboard` | connects, matches, offers, messages |
| POST | `/api/analyze` `{id}` | LLM triage |
| POST | `/api/draft` `{id}` | LLM proposal draft |

Set `LLM_CMD` for AI text with no API key; without it, the analyze/draft endpoints fall back to a heuristic.

---

Related: [Automate Upwork](automate-upwork.md) · [What is the Upwork official MCP](upwork-mcp-server.md) · back to [README](../README.md)
