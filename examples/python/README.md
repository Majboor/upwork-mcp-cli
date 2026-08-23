# Python + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Triage Upwork jobs in Python via the official MCP" width="100%"></p>

A **Upwork Python client** example: [`upwork_triage.py`](./upwork_triage.py) searches Upwork for one or more keywords through the **Upwork official MCP** (via [`upwork-cli`](../../)), scores every result with a simple 0–100 Alpha Score, and prints an aligned HOT / WATCH / SKIP table sorted best-first. No scraping, no unofficial API — just `subprocess` calls into a CLI that already handles Upwork's OAuth 2.1 for you. It's the smallest complete **Upwork Python example** for turning `find_jobs search`/`find_jobs get` output into a decision.

**Keywords:** Upwork official MCP · automate Upwork · Upwork Python client · Upwork Python example · Model Context Protocol.

## Quick start

```sh
# from the repo root
upwork login                                                    # once, opens your browser
python3 examples/python/upwork_triage.py "ai automation" --limit 10
```

Enrich the top few with competitor bid stats and client spend history (costs an extra `find_jobs get` call per job, no connects spent just to view):

```sh
python3 examples/python/upwork_triage.py "n8n automation" --limit 10 --enrich 3
```

Search several keywords at once and pick your account:

```sh
python3 examples/python/upwork_triage.py "GoHighLevel" "AI agent" --limit 15 --enrich 5 --org talent
```

> **Pure stdlib.** No `pip install` needed — `upwork_triage.py` only uses `argparse`, `json`, `subprocess`, `dataclasses`, and `math` from the standard library. It shells out to `upwork` (falling back to `node bin/upwork.js` if the CLI isn't on `PATH`), so it runs anywhere Python 3.9+ and this repo's CLI do.

## How it works

`run()` calls `upwork-cli` with `--raw` and unwraps the MCP envelope: `{"content":[{"type":"text","text":"<json>"}]}`, where `content[0].text` is itself a JSON *string* — the one gotcha every `upwork-cli` integration runs into. From there:

1. **Search** — `find_jobs search` per keyword, deduped by job id (ids are strings — never coerced to `int`).
2. **Score (search-only)** — a preliminary Alpha Score from what search already gives you:
   - **Competition** (60% weight without enrichment) — fewer `proposal_count` is better; a brand-new posting with no count yet gets a mildly optimistic default.
   - **Client signal** (40%) — verification status, rating, and hire ratio (`total_hires` / `total_posted_jobs`).
3. **Enrich (optional, `--enrich N`)** — the top `N` scored jobs get a `find_jobs get` call for deeper intel: `applicationsBidStats` (avg/min/max competitor bid), the client's real spend/contract history, and connects cost to apply.
4. **Score (enriched)** — once bid stats are available, the formula adds a third term and reweights:

   ```
   score = competition × 0.45 + client_signal × 0.30 + bid_headroom × 0.25
   ```

   `bid_headroom` compares the client's stated budget to the average competing bid — a client whose budget sits well above what others are bidding is a better target. `client_signal` also gets richer once enriched (spend on a log scale, real feedback score, contracts-with-hires ratio).
5. **Tag & print** — score ≥ 70 → `HOT`, ≥ 45 → `WATCH`, else `SKIP`; rows print sorted by score, in an aligned table with a HOT/WATCH/SKIP tally at the bottom.

Every score, weight, and threshold lives in plain functions (`score_competition`, `score_client`, `score_headroom`, `compute_score`, `tag_for`) near the top of the file — tune them for your own niche.

## Config

All configuration is via CLI flags — no env vars, no config file:

| Flag | Default | Meaning |
|---|---|---|
| `keywords` (positional) | — | one or more search terms, e.g. `"n8n automation"` |
| `--limit` | `10` | results fetched per keyword |
| `--enrich` | `0` | run `find_jobs get` on the top-N scored jobs for deeper intel |
| `--org` | `talent` | `upwork-cli` account alias/org uid to search as |

`upwork-cli` itself handles auth — tokens live in `~/.upwork-cli/`, never in this script or this repo.

---

Part of [**upwork-cli**](../../) — an OAuth wrapper over the official Upwork MCP server. See **[Automate Upwork](../../docs/automate-upwork.md)** for the full end-to-end guide (search → enrich → score → draft), and the [n8n](../n8n/), [cron](../cron/), and [Google Sheets](../google-sheets/) examples for other automation targets.
