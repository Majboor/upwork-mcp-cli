# Slack + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Send new Upwork jobs to Slack via the official MCP" width="100%"></p>

Get **new Upwork job alerts in Slack** — no third-party service, no scraping — using the **Upwork official MCP** and [`upwork-cli`](../../). This is a minimal example of **Upwork automation**: [`upwork-to-slack.mjs`](./upwork-to-slack.mjs) is a dependency-free Node script that searches a list of keywords, remembers which jobs it has already alerted on, and posts only the **new** ones to a **Slack Incoming Webhook** as a nicely formatted Block Kit message. Together with [`upwork-cli`](../../), this gives you a lightweight **Upwork Slack integration** for job alerts without standing up a server.

## Quick start

1. Create a Slack Incoming Webhook: in Slack go to [api.slack.com/apps](https://api.slack.com/apps) → create/select an app → **Incoming Webhooks** → toggle on → **Add New Webhook to Workspace** → pick a channel → copy the URL (`https://hooks.slack.com/services/…`).
2. Run it, from the repo root, after `upwork login`:

```sh
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/…" node examples/slack/upwork-to-slack.mjs
```

Customize the search terms:

```sh
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/…" \
  KEYWORDS="react,next.js,shopify" LIMIT=15 node examples/slack/upwork-to-slack.mjs
```

Without `SLACK_WEBHOOK_URL` set, the script still runs the search but skips posting — it prints setup instructions and a "would post" preview instead, so you can try it before wiring up Slack.

## Schedule it with cron

Run every 30 minutes and log the output:

```cron
# crontab -e   (macOS/Linux)
*/30 * * * * cd /path/to/upwork-cli && SLACK_WEBHOOK_URL="https://hooks.slack.com/services/…" node examples/slack/upwork-to-slack.mjs >> ~/upwork-slack.log 2>&1
```

## Config

| Env | Default | Meaning |
|-----|---------|---------|
| `SLACK_WEBHOOK_URL` | *(unset)* | Slack Incoming Webhook URL. Required to actually post; if unset the script runs in dry-run mode. |
| `KEYWORDS` | `n8n automation,GoHighLevel,AI automation` | comma-separated search terms |
| `LIMIT` | `10` | results per keyword, per run |

`ORG` (account alias, default `talent`) and `STATE_DIR` (default `~/.upwork-cli/alerts`) can also be overridden, matching the [cron example](../cron/).

## How it works

Each run calls `upwork find_jobs search … --raw` per keyword, parses the JSON string nested in `content[0].text`, and diffs job IDs against `~/.upwork-cli/alerts/slack-seen.txt`. Only unseen IDs are formatted into a Slack [Block Kit](https://api.slack.com/block-kit) message — job title linked to the posting when a URL is available, plus budget, proposal count, client country, and skills — and POSTed to `SLACK_WEBHOOK_URL`. Jobs are only marked "seen" after a successful post, so a failed Slack call gets retried on the next run instead of being lost. Secrets (the webhook URL) live only in the environment, never in the repo.

---

Part of [`upwork-cli`](../../), an OAuth wrapper over the official Upwork MCP. See also [Automate Upwork](../../docs/automate-upwork.md) and the [cron alerts example](../cron/) for a Slack-free variant.
