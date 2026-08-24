# upwork-cli — Automate Upwork with the official Upwork MCP server

<p align="center"><img src="docs/media/hero-mcp.png" alt="Automate Upwork with the official Upwork MCP server — CLI, n8n, and AI agents" width="100%"></p>

**A fast, open-source command-line tool and automation toolkit for the official [Upwork MCP server](https://mcp.upwork.com/mcp).** Search Upwork jobs, pull competitor bid ranges and client spend history, score gigs, draft AI proposals, manage contracts and offers — all from your terminal, a script, [n8n](examples/n8n/), or an AI agent like Claude or Cursor.

> **In one line:** this is how you **automate Upwork using the official MCP** — no scraping, no unofficial API, no browser bot. It does OAuth 2.1 for you and exposes **every tool Upwork's MCP publishes** (currently **46 tools · 142 actions · 693 params**).

```sh
# one-line install (clones, installs deps, puts `upwork` on your PATH)
curl -fsSL https://raw.githubusercontent.com/Majboor/upwork-mcp-cli/main/install.sh | bash
upwork login
upwork find_jobs search -p query="n8n automation" -p limit=5 --org talent --table
```

**Topics:** upwork mcp · upwork mcp server · automate upwork · upwork automation · official upwork mcp · upwork api · upwork cli · upwork n8n · upwork ai agent · model context protocol · find upwork jobs · upwork proposal automation · upwork bid analysis.

---

## Table of contents

- [What is the Upwork MCP server?](#what-is-the-upwork-mcp-server)
- [What you can automate](#what-you-can-automate)
- [Install](#install) · [Log in](#log-in) · [Everyday use](#everyday-use)
- [Works with n8n, Claude, Cursor, ChatGPT & scripts](#works-with-n8n-claude-cursor-chatgpt--scripts)
- [Data the Upwork MCP exposes](#data-the-upwork-mcp-exposes)
- [Writes, drafts & uploads](#writes-drafts--uploads)
- [Command & options reference](#everyday-use)
- [FAQ](#faq)
- **Guides:** [Automate Upwork](docs/automate-upwork.md) · [What is the Upwork MCP](docs/upwork-mcp-server.md) · [Recipes](docs/recipes.md) · [Every data point](docs/data-points.md) · [Use with Claude/Cursor/n8n](docs/clients-claude-cursor-n8n.md) · [FAQ](docs/faq.md)

---

## What is the Upwork MCP server?

The **Upwork MCP server** (`https://mcp.upwork.com/mcp`) is Upwork's **official** [Model Context Protocol](https://modelcontextprotocol.io) endpoint. It lets AI agents and tools call Upwork's real functionality — searching jobs, reading client history, submitting proposals, managing contracts — with your authenticated account, over a documented protocol instead of screen-scraping.

`upwork-cli` is a thin wrapper over it. It handles the login (OAuth 2.1 with dynamic client registration + PKCE, tokens auto-refresh) and turns every MCP tool into a plain command, so you can use the Upwork MCP from a terminal or a cron job without writing any protocol code. See the full explainer: **[What is the Upwork MCP server?](docs/upwork-mcp-server.md)**

## What you can automate

- 🔎 **Find & filter jobs** on a schedule — by keyword, type, budget, experience level.
- 💰 **Read competitor bids** — average / min / max bid on a posting (normally a premium insight).
- 🏦 **Vet clients** — lifetime spend, contracts, hire rate, feedback score, hours.
- 🎯 **Score & triage** gigs into HOT / WATCH / SKIP before you spend connects.
- ✍️ **Draft proposals** with an LLM using the real numbers, then submit via the draft→confirm flow.
- 📊 **Pull dashboards** — connects balance, matching jobs, invitations, offers, messages.
- 🤝 **Manage the pipeline** — contracts, milestones, offers, messages, talent lists.
- 🤖 **Wire it into [n8n](examples/n8n/)**, Claude, Cursor, or any cron/script.

Full walkthrough: **[How to automate Upwork with the official MCP](docs/automate-upwork.md)** · copy-paste **[recipes](docs/recipes.md)**.

## Install

**One-line install (recommended):**

```sh
curl -fsSL https://raw.githubusercontent.com/Majboor/upwork-mcp-cli/main/install.sh | bash
```

This clones the repo to `~/.upwork-cli-app`, installs dependencies, and symlinks `upwork`
onto your PATH. (Tokens live separately in `~/.upwork-cli`.)

**Manual install:**

```sh
git clone https://github.com/Majboor/upwork-mcp-cli.git
cd upwork-mcp-cli
npm install
npm link                     # optional: puts `upwork` on your PATH
# or just run: node bin/upwork.js <cmd>
```

Requires Node 18+ (uses global `fetch`) and git. Built and tested on Node 22.

## Log in

```sh
upwork login
```

Opens your browser to authorize with Upwork. Tokens are stored in `~/.upwork-cli`
(mode 0600) and refreshed automatically. `upwork logout` clears them.

## Everyday use

Every tool **and every action** is a first-class command, generated live from the
server's schemas (so coverage is always complete):

```sh
upwork commands                 # every tool + its actions, one screen
upwork find_jobs                # show a tool's actions (discoverable help)
upwork help find_jobs           # authoritative reference (server get_tool_help)
upwork describe find_jobs       # raw input schema

# Run anything — <tool> <action>:
upwork find_jobs search -p query="GoHighLevel" -p limit=5 --org talent --table
upwork find_jobs get -p id=2090580154522211987
upwork get_freelancer_dashboard check --org talent
upwork list_contracts list --org talent --table

# Explicit form and full-JSON form both still work:
upwork call find_jobs -a action=search -p query=n8n
upwork call find_jobs --json '{"action":"search","params":{"query":"n8n","job_type":"hourly"}}'
```

### Options

| Flag | Meaning |
|------|---------|
| `<action>` positional   | e.g. `upwork find_jobs search` sets `action=search` |
| `-a, --arg key=value`   | top-level argument |
| `-p, --param key=value` | nested `params.<key>` |
| `--json '<json>'`       | full arguments object (merged first, then `-a`/`-p` override) |
| `--org <uid\|talent\|client\|agency>` | which account to act as (auto-injected only when the tool needs it) |
| `--table`               | render list results as an aligned table |
| `--raw`                 | print the full MCP result envelope |

Values are coerced: `123` → number, `true/false/null` → literals, `{...}`/`[...]` → JSON.

> **Gotcha:** deep intel like `applicationsBidStats` and `jobActivity` comes back as a
> JSON string nested in `content[0].text`. Use `--raw` and parse it (the [bridge](examples/n8n/bridge.mjs)
> shows the exact unwrap). Also: `id` must be a **string** — pass it via `--json` if bare digits get rejected.

### Discovery commands

| Command | What |
|---------|------|
| `upwork commands`        | every tool and its actions (typed, with required params + write flags) |
| `upwork tools`           | one-line summary per tool |
| `upwork <tool>`          | that tool's actions (help) |
| `upwork <tool> <action> --help` | **full typed params** for one action (required/optional, types, enums, descriptions) |
| `upwork help <tool>`     | authoritative server reference |
| `upwork describe <tool>` | raw JSON input schema |
| `upwork refresh`         | re-fetch & cache the tool list |

Typed help, `commands`, and pre-send validation are driven by `manifest.json` — a
harvested map of all **46 tools · 142 actions · 693 params** (see *Regenerating the
manifest* below). If `manifest.json` is absent the CLI falls back to the live schema.

## Works with n8n, Claude, Cursor, ChatGPT & scripts

You can drive the Upwork MCP from anywhere that can run a command or hit HTTP:

- **[n8n](examples/n8n/)** — import-ready workflows: search → enrich → score → draft AI proposals. Uses the included [`bridge.mjs`](examples/n8n/bridge.mjs).
- **[Cron job alerts](examples/cron/)** — [`upwork-alerts.sh`](examples/cron/upwork-alerts.sh) searches your keywords on a schedule and surfaces only new jobs (with desktop notifications). Ready for `crontab`.
- **Claude / Claude Code, Cursor, and other MCP clients** — point them at the CLI, or use the bridge as a local REST shim.
- **Cron / shell / Python** — every command prints JSON (`--raw`) for easy piping.

Details + config snippets: **[Use the Upwork MCP with Claude, Cursor, n8n & scripts](docs/clients-claude-cursor-n8n.md)**.

## Examples & integrations

Ready-to-use recipes in [`examples/`](examples/) — each is a self-contained way to **automate Upwork with the official MCP**:

| Integration | What it does |
|-------------|--------------|
| **[n8n](examples/n8n/)** | Full no-code pipeline: search → enrich → score → AI proposals |
| **[Make.com](examples/make/)** | Importable scenario blueprint over the REST bridge |
| **[Zapier](examples/zapier/)** | Push new jobs to a Catch Hook → 6000+ apps |
| **[Cron alerts](examples/cron/)** | Scheduled keyword search, only-new-jobs, desktop notifications |
| **[GitHub Actions](examples/github-actions/)** | Scheduled job search in CI, results as an artifact |
| **[Slack](examples/slack/)** | New matching jobs to a Slack channel |
| **[Discord](examples/discord/)** | New jobs as rich Discord embeds |
| **[Telegram](examples/telegram/)** | Job alerts via a Telegram bot |
| **[Google Sheets](examples/google-sheets/)** | Append jobs to a spreadsheet (Python or Apps Script) |
| **[Airtable](examples/airtable/)** | Sync jobs into an Airtable base |
| **[Notion](examples/notion/)** | Push jobs into a Notion database |
| **[Python](examples/python/)** | Pure-stdlib triage client with Alpha Score |

## Python library

Prefer Python? There's a tiny, **zero-dependency** wrapper in [`python/`](python/) (`pip install upwork-mcp-cli`):

```python
from upwork_mcp import Upwork

up = Upwork()                                   # uses the `upwork` CLI you logged into
for job in up.search("n8n automation", limit=5):
    print(job["title"], job["proposal_count"])

job = up.get_job(up.search("shopify")[0]["id"])
print(job["bid_stats"])          # competitor bids {avg,min,max}
print(job["client_record"])      # client spend, hires, feedback

up.dashboard(); up.profile(); up.proposals(); up.messages(unread=True)
up.triage("GoHighLevel", limit=10, enrich=3)    # scored HOT/WATCH/SKIP shortlist
```

Full guide: **[python/README.md](python/)**.

## Data the Upwork MCP exposes

Highlights (full list in **[Every data point the Upwork MCP exposes](docs/data-points.md)**):

- **Per job:** competitor bid stats (avg/min/max), applicant & interview counts, connects cost, screening questions, full description, skills, budget.
- **Per client:** lifetime spend, total contracts, total hires, hours, feedback score, work history, verification & location.
- **Rate insights:** the going hourly range for similar work.
- **Your account:** connects balance, earnings, contracts, offers, invitations, messages, milestones.
- **People:** freelancer search + profiles (as a client).

## Writes, drafts & uploads

Every write tool is callable like any other command. Upwork drafts each write; you
confirm it separately:

```sh
# 1) create a draft proposal (nothing is submitted yet)
upwork manage_proposals create -p job_reference=2090580154522211987 \
  -p cover_letter="Hi — I build GHL automations…" -p charged_amount=30 --org talent

# 2a) confirm it in one step next time with --confirm:
upwork manage_proposals create -p job_reference=… -p cover_letter="…" -p charged_amount=30 --confirm

# 2b) …or confirm a draft you already created:
upwork confirm proposal <draft_id> --org talent
```

`--confirm` figures out the correct `confirm_draft` type automatically (from the
manifest / server response). Binding financial actions — **accepting** an offer,
funding milestones — deliberately finalize on upwork.com, not in the CLI.

### File uploads (headless, no browser)

`upwork upload` runs the full attachment chain — `start_attachment_upload` →
`store_uploaded_files` (base64) → `get_upload_status` → `confirm_attachment_upload`:

```sh
upwork upload proposal.pdf --context proposals --org talent
upwork upload shot.png --context messages --room room_xxx --org talent
# prints the file_uid values — pass them to a proposal/message/offer as attachments
```

Contexts: `messages` (needs `--room`), `proposals`, `offer`, `milestones`, `job`,
`invitation`. Inline limit is ~7 MB/file; for larger files use the `fallback_url`
that `start_attachment_upload` returns, in a browser.

### Validation

For any action in the manifest, the CLI checks required params **before** calling the
server and prints the typed action help if something's missing — no wasted round-trips
or opaque server errors.

## How the org is resolved

Tools that take `org_uid` get it injected automatically. Resolution order:
`--org` value → `UPWORK_ORG` env → cached `defaultOrg` (set on first `upwork accounts`).
An `--org` alias (`talent`, `client`, `agency`) maps to the matching cached account.

## Config / env

| Var | Default |
|-----|---------|
| `UPWORK_CLI_HOME` | `~/.upwork-cli` (token + config store) |
| `UPWORK_MCP_URL`  | `https://mcp.upwork.com/mcp` |
| `UPWORK_ORG`      | default org_uid when `--org` is omitted |

## Layout

```
bin/upwork.js     command dispatch: <tool> <action>, call, upload, confirm, help
src/mcp.js        connect + interactive OAuth login (loopback callback server)
src/provider.js   file-backed OAuth 2.1 client provider (DCR, tokens, PKCE)
src/tools.js      live tool list + on-disk cache, action/description parsing
src/manifest.js   typed manifest loader: help, validation, confirm-type resolution
src/upload.js     headless attachment upload orchestration
src/table.js      generic table rendering for list-shaped results
src/util.js       config, arg parsing, org resolution, deep-find, output
manifest.json     harvested typed map of every tool/action/param
python/           zero-dependency Python library (upwork_mcp) + pyproject
examples/n8n/     import-ready n8n automation workflows + REST bridge
docs/             guides: automate Upwork, MCP explainer, recipes, data points, FAQ
```

## Regenerating the manifest

`manifest.json` is generated by calling the server's `get_tool_help` for every tool
and structuring the result. To refresh it after Upwork changes the API, re-run the
harvest (the CLI still works without it — it falls back to live schemas):

```sh
# from an environment with the Upwork MCP connected, dump get_tool_help per tool
# then merge into manifest.json as { generatedAt, toolCount, tools:[...] }.
```

The `tools` array shape per entry: `{ name, summary, write, returns_draft, flat,
actions:[{ name, description, params:[{ name, type, required, nested, enum, description }] }] }`.

Every write action still follows the Upwork MCP draft→confirm model, and binding
financial actions (offers, milestone funding) complete on upwork.com.

## FAQ

**What is the Upwork MCP server?** Upwork's official Model Context Protocol endpoint at `https://mcp.upwork.com/mcp` — a supported way for AI agents and tools to use Upwork with your account. See [the guide](docs/upwork-mcp-server.md).

**How do I automate Upwork?** Log in once, then script `upwork find_jobs`, `find_jobs get`, and the write tools — or import the [n8n workflow](examples/n8n/). Full walkthrough: [Automate Upwork](docs/automate-upwork.md).

**Is this the official Upwork MCP?** Yes — this CLI talks to Upwork's own MCP server. It is an independent open-source client, not affiliated with Upwork.

**Is automating Upwork allowed?** This uses Upwork's official MCP with your authenticated account — the same data and actions you have logged in. Use it within Upwork's Terms of Service; don't spam proposals or misuse client data.

**Do I need Upwork Freelancer Plus / premium?** No API key needed beyond logging in. Some insights that feel "premium" (like competitor bid ranges) are returned by the MCP itself.

**Can I use it with Claude, Cursor, or ChatGPT?** Yes — see [Use with Claude, Cursor & n8n](docs/clients-claude-cursor-n8n.md).

**Where are my tokens stored?** In `~/.upwork-cli/` (mode 0600), never in this repo.

**More questions:** the full [FAQ](docs/faq.md).

---

<sub>Keywords: upwork mcp, upwork mcp server, official upwork mcp, automate upwork, upwork automation, i automated upwork using the official mcp, upwork cli, upwork api, upwork n8n automation, upwork ai agent, find upwork jobs cli, upwork proposal automation, upwork competitor bids, upwork client history, model context protocol upwork, upwork bot alternative, upwork job scraper alternative.</sub>
