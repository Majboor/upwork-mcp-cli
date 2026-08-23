# What is the Upwork Official MCP Server? (Complete 2026 Guide)

<p align="center"><img src="media/blueprint.png" alt="Upwork official MCP server architecture blueprint" width="100%"></p>

The **Upwork official MCP server** is Upwork's supported [Model Context Protocol](https://modelcontextprotocol.io) endpoint at **`https://mcp.upwork.com/mcp`**. It lets AI agents, automation tools, and scripts use Upwork with your real account — searching jobs, reading client history, sending proposals, managing contracts — over a documented protocol instead of scraping the website.

This page explains the **official Upwork MCP** in plain terms and shows how to start using it in a few minutes with [`upwork-cli`](../).

- [What "MCP" means](#what-mcp-means)
- [What makes it the *official* Upwork MCP](#what-makes-it-the-official-upwork-mcp)
- [What the Upwork official MCP can do](#what-the-upwork-official-mcp-can-do)
- [How to connect to the Upwork official MCP](#how-to-connect-to-the-upwork-official-mcp)
- [Upwork official MCP vs the Upwork API](#upwork-official-mcp-vs-the-upwork-api)
- [FAQ](#faq)

## What "MCP" means

MCP (Model Context Protocol) is an open standard for connecting AI models to tools and data. A **MCP server** exposes a set of *tools* (functions with typed inputs) that a client — an AI agent, an app, or a CLI — can call. The **Upwork official MCP server** is exactly this: Upwork publishing its own capabilities as MCP tools.

## What makes it the *official* Upwork MCP

- It's hosted by Upwork at the official domain `mcp.upwork.com`.
- It authenticates with **your** Upwork account via OAuth 2.1 (dynamic client registration + PKCE).
- It returns the same data and takes the same actions you'd have while logged in.
- It is the **supported** integration path — not an unofficial scraper, headless-browser bot, or reverse-engineered private API.

`upwork-cli` is an independent open-source **client** for this official server. It is not affiliated with or endorsed by Upwork.

## What the Upwork official MCP can do

The Upwork official MCP currently exposes **46 tools · 142 actions · 693 parameters**, including:

| Area | Tools |
|------|-------|
| Jobs | `find_jobs`, `find_saved_jobs`, `save_job`, `get_job_posting`, `post_job` |
| Proposals | `manage_proposals`, `list_freelancer_proposals`, `list_client_proposals`, `manage_client_proposals` |
| Clients & offers | `manage_offers`, `respond_to_offer`, `list_offers`, `list_client_invitations` |
| Contracts & money | `list_contracts`, `list_milestones`, `manage_milestones`, `submit_milestones`, `update_contract`, `end_contract`, `get_freelancer_financials`, `get_client_financials` |
| People | `find_freelancers`, `invite_freelancer`, `manage_talent_lists` |
| Account | `get_account`, `list_accounts`, `get_profile`, `update_profile`, `boost_profile`, `get_freelancer_dashboard`, `get_client_dashboard`, `get_agency_dashboard` |
| Messaging | `get_messages`, `send_message` |
| Insights | `get_rate_insights` |
| Files | `start_attachment_upload`, `store_uploaded_files`, `get_upload_status`, `confirm_attachment_upload` |

See **[every data point the Upwork official MCP exposes](data-points.md)**.

## How to connect to the Upwork official MCP

The fastest way is this CLI:

```sh
git clone https://github.com/Majboor/upwork-cli && cd upwork-cli
npm install
node bin/upwork.js login          # OAuth to the Upwork official MCP, once
node bin/upwork.js commands        # see every tool the MCP publishes
node bin/upwork.js find_jobs search -p query="ai automation" -p limit=5 --org talent --table
```

Prefer an AI client or n8n? See **[Use the Upwork official MCP with Claude, Cursor & n8n](clients-claude-cursor-n8n.md)**.

## Upwork official MCP vs the Upwork API

| | Upwork official MCP | Legacy Upwork API | Scraping |
|--|--|--|--|
| Supported for AI agents | ✅ purpose-built | ⚠️ REST/GraphQL, heavier | ❌ against ToS |
| Auth | OAuth 2.1 + PKCE | OAuth | cookies/session |
| Premium-feel insights (bids, client spend) | ✅ returned | partial | brittle |
| Setup effort | minutes (this CLI) | app registration | constant maintenance |

## FAQ

**Is the Upwork MCP official?** Yes — `https://mcp.upwork.com/mcp` is Upwork's own server. This CLI is an independent client for it.

**Do I need an API key?** No — you log in with your Upwork account via OAuth; tokens are stored locally.

**Can I automate Upwork with it?** Yes. See **[How to automate Upwork with the official MCP](automate-upwork.md)**.

**Is it free?** The MCP is part of your Upwork account. This CLI is open source.

---

Back to the [upwork-cli README](../README.md) · Next: [Automate Upwork →](automate-upwork.md)
