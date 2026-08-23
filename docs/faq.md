# Upwork Official MCP — FAQ

<p align="center"><img src="media/hero-mcp.png" alt="Upwork official MCP FAQ" width="100%"></p>

Common questions about the **Upwork official MCP server**, automating Upwork, and using [`upwork-cli`](../).

## What is the Upwork official MCP?

Upwork's supported [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `https://mcp.upwork.com/mcp`. It lets AI agents and tools use Upwork with your authenticated account. Full explainer: [What is the Upwork official MCP?](upwork-mcp-server.md)

## Is this the official Upwork MCP, or a scraper?

It talks to Upwork's **official** MCP server — no scraping, no headless browser, no unofficial private API. `upwork-cli` is an independent, open-source **client** for it (not affiliated with Upwork).

## How do I automate Upwork?

Log in once, then script the tools or import the [n8n workflow](../examples/n8n/). Step-by-step: [How to automate Upwork with the official MCP](automate-upwork.md).

## Can I automate applying to jobs / sending proposals?

Yes — via `manage_proposals`. Every write follows Upwork's **draft → confirm** model, so nothing is submitted until you confirm. Don't spam; personalize with the real client data.

## Is automating Upwork allowed?

You're using Upwork's own official MCP with your account — the same data and actions you have when logged in. Stay within Upwork's Terms of Service and rate limits, and don't misuse client data.

## Do I need Upwork premium / Freelancer Plus?

No extra API key beyond logging in. Some insights that feel premium — like competitor bid ranges — are returned by the MCP itself.

## Can I use it with Claude, Cursor, ChatGPT, or n8n?

Yes — see [Use with Claude, Cursor & n8n](clients-claude-cursor-n8n.md).

## What data can I read?

Competitor bids, client lifetime spend and hire history, rate insights, dashboards, contracts, and more. Full list: [Every data point the Upwork official MCP exposes](data-points.md).

## How do I install it?

One line:

```sh
curl -fsSL https://raw.githubusercontent.com/Majboor/upwork-cli/main/install.sh | bash
```

Then `upwork login`. Manual install and requirements are in the [README](../README.md#install).

## Where are my Upwork tokens stored?

In `~/.upwork-cli/` (mode 0600). They are never committed to this repo. `upwork logout` clears them.

## Why does `id` get rejected?

`id` must be a **string**. If bare digits are rejected, pass it via `--json '{"action":"get","params":{"id":"<id>"}}'`.

## Why is some data missing / null?

Deep intel (`applicationsBidStats`, `jobActivity`) is nested as a JSON string in `content[0].text`. Use `--raw` and parse it — see the [bridge](../examples/n8n/bridge.mjs).

## Does it work on Windows / Linux?

It's Node.js (18+) and works cross-platform. The one-line installer targets macOS/Linux; on Windows use the manual install.

---

Back to [README](../README.md)
