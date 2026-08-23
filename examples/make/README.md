# Make.com + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Automate Upwork with Make.com and the official MCP" width="100%"></p>

This example wires the **Upwork official MCP** into a **Make.com (Integromat) scenario**, so you can **automate Upwork** job search, enrichment, and routing with visual, no-code modules — this is a ready-to-import **Upwork Make.com integration** blueprint.

## Quick start

```bash
# 1. From the repo root, log in once (opens your browser)
node bin/upwork.js login

# 2. Start the local bridge — it turns the MCP into plain REST endpoints on :4178
node examples/n8n/bridge.mjs
```

Then in Make:

1. Create a new scenario.
2. Click **⋯** → **Import Blueprint**.
3. Pick `upwork-scenario.blueprint.json` from this folder.
4. Open the final HTTP module and replace the placeholder webhook URL with your own destination (Make webhook, Slack, Notion, a CRM — anywhere you want the matched jobs sent).
5. Run it once manually to confirm data flows end to end, then turn on scheduling.

> **Make Cloud note:** the bridge runs on your machine at `http://localhost:4178`. Make's cloud engine can't reach `localhost`, so expose it first with a tunnel — e.g. `ngrok http 4178` — and update the URLs in the HTTP modules to the tunnel's public URL.

## Config

| Setting | Where | Notes |
|---|---|---|
| Search query / limit | Module 1 (`Search Upwork jobs`) → `qs` | Defaults to `q=n8n automation&limit=10` |
| Bridge URL | Modules 1, 3 → `url` | Swap `localhost:4178` for your tunnel URL on Make Cloud |
| Match filter | Module 4 (`Keep only strong matches`) → route filters | Defaults to `proposal_count <= 5` and `connects_cost <= 16` |
| Destination webhook | Module 5 (`Send to your webhook/CRM`) → `url` | Placeholder — fill in your own endpoint |
| `PORT` (bridge) | env var, optional | Defaults to `4178` |

No API keys or secrets live in the blueprint — the bridge handles Upwork OAuth locally via `upwork-cli`, and the outbound webhook URL is left blank for you to fill in.

## How it works

The blueprint's flow mirrors a standard triage pipeline: an **HTTP** module (`http:ActionSendData`) calls `GET /api/search` on the bridge to pull live Upwork jobs; a **BasicFeeder** (Iterator) walks the returned `jobs` array one at a time; a second **HTTP** module calls `GET /api/job?id=` per job to pull deep intel — competitor bid ranges, client spend, connects cost; and a **BasicRouter** with two filtered routes keeps only the strong matches (low competition, affordable connects) and sends them on to a final placeholder **HTTP** module you point at your own webhook, while weak matches are silently discarded. The bridge (`examples/n8n/bridge.mjs`) is what makes this possible — it wraps the official MCP's `tools/call` + OAuth handshake in plain JSON REST endpoints that Make's HTTP module can call directly.

---

Part of [upwork-cli](../../) — see also [Automate Upwork](../../docs/automate-upwork.md) for the full step-by-step guide to automating Upwork with the official MCP.
