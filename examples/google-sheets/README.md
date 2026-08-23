# Google Sheets + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Sync Upwork jobs to Google Sheets via the official MCP" width="100%"></p>

This example syncs Upwork job listings straight into a spreadsheet — a lightweight **Upwork Google Sheets integration** built on the **official Upwork MCP** (not a scraper, not an unofficial API). It's a small, appendable pipeline: run it on a schedule and every new job shows up as a new row, deduped by job id, so your sheet becomes a running log you can filter, chart, or share with a client or VA. This is one of the simplest ways to **automate Upwork** job discovery without writing a bot.

Two ways to run it, so it works whether or not you're set up for Google auth:

- **[`sheets-sync.py`](./sheets-sync.py)** — a Python script that shells out to `upwork-cli`, parses the job list, and writes rows via a Google service account (`gspread` + `google-auth`). Runs anywhere: your machine, a cron job, GitHub Actions.
- **[`Code.gs`](./Code.gs)** — a Google Apps Script alternative that lives *inside* the sheet and fetches from the local [Upwork MCP → n8n bridge](../n8n/bridge.mjs) on a time-driven trigger. No Python, no service account — but since Apps Script runs on Google's servers, the bridge has to be reachable from the internet (a tunnel, e.g. `ngrok`), not just `localhost`.

Both append the same columns: `id`, `title`, `budget`, `proposals`, `country`, `skills`, `date`.

## Quick start (Python)

```sh
# from the repo root, after `upwork login`
pip install gspread google-auth   # see the comment at the top of sheets-sync.py

# 1. Create a Google Cloud service account, enable the Sheets API,
#    download its JSON key, and share your target sheet with its
#    client_email (Editor access).
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export SHEET_ID=1AbCDeFGhijKLmnoPQRstuVWxyz         # from the sheet's URL
export QUERY="react developer"

python3 examples/google-sheets/sheets-sync.py
```

Re-run it whenever — on a cron schedule it just keeps appending new jobs. See the [cron example](../cron/) for scheduling patterns.

## Quick start (Apps Script)

```sh
# from the repo root
node bin/upwork.js login
node examples/n8n/bridge.mjs      # starts the bridge on http://localhost:4178

# expose it publicly (Apps Script can't reach localhost)
ngrok http 4178                    # copy the https://xxxx.ngrok-free.app URL
```

Then:

1. Open (or create) a Google Sheet → **Extensions → Apps Script**.
2. Paste in [`Code.gs`](./Code.gs) and set `BRIDGE_URL` to your tunnel URL.
3. Run `setupTrigger` once (authorize when prompted) to install an hourly sync.
4. Run `syncUpworkJobs` once by hand to confirm rows show up.

## Config

| Setting | Where | Default | Notes |
|---|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | env (Python) | — | path to the service account JSON key |
| `SHEET_ID` | env (Python) | — | spreadsheet id from the sheet's URL |
| `WORKSHEET_NAME` | env (Python) | `Sheet1` | tab to write into; created if missing |
| `QUERY` | env (Python) | `react developer` | Upwork search query |
| `LIMIT` | env (Python) | `10` | results per run |
| `ORG` | env (Python) | `talent` | `upwork-cli` account alias |
| `BRIDGE_URL` | const (Apps Script) | placeholder | your public tunnel URL for `bridge.mjs` |
| `SEARCH_QUERY` / `SEARCH_LIMIT` | const (Apps Script) | `react developer` / `10` | search params |
| `SHEET_NAME` | const (Apps Script) | `Sheet1` | tab to write into; created if missing |

Credentials always come from your environment or your own files — the service account JSON path and the sheet id, in `sheets-sync.py`; nothing beyond your own tunnel URL, in `Code.gs`. Neither script hardcodes secrets, and neither is committed to your sheet or this repo.

## How it works

`sheets-sync.py` runs `find_jobs search … --raw` through `upwork-cli`, which handles Upwork's OAuth 2.1 for you (see [`upwork login`](../../)). The MCP wraps its response as `{"content":[{"type":"text","text":"<json>"}]}`, so the script parses `content[0].text` as a *second* JSON payload to get the actual `jobs` array — the one gotcha every `upwork-cli` integration runs into. It then reads column A of the sheet for ids it's already written, and `append_rows` only the ones that are new.

`Code.gs` does the same dedupe-by-column-A logic, but instead of talking to the MCP directly it hits `GET /api/search` on the [n8n bridge](../n8n/), a tiny local HTTP shim that already normalizes job JSON. A time-driven Apps Script trigger calls `syncUpworkJobs` on an interval, so the sheet fills in on its own as long as the bridge (and its tunnel) stay up.

---

Part of [**upwork-cli**](../../) — an OAuth wrapper over the official Upwork MCP server. See **[Automate Upwork](../../docs/automate-upwork.md)** for the full end-to-end guide (search → enrich → score → draft), and the [n8n](../n8n/), [Make.com](../make/), and [cron](../cron/) examples for other automation targets.
