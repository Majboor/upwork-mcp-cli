# upwork-cli

A fast, thin CLI wrapper over the **Upwork MCP server** (`https://mcp.upwork.com/mcp`).

It does its own OAuth 2.1 login (dynamic client registration + PKCE, tokens auto-refresh),
then exposes **every tool the server publishes** through one generic dispatcher — nothing
is hardcoded, so it automatically covers any tool Upwork adds later.

## Install

```sh
cd upwork-cli
npm install
npm link        # optional: puts `upwork` on your PATH
# or just run: node bin/upwork.js <cmd>
```

Requires Node 18+ (uses global `fetch`). Built and tested on Node 22.

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
harvested map of all **46 tools · 142 actions · ~410 params** (see *Regenerating the
manifest* below). If `manifest.json` is absent the CLI falls back to the live schema.

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
