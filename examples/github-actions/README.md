# GitHub Actions + Upwork (Official MCP)

<p align="center"><img src="./media/hero.png" alt="Run Upwork job searches on a schedule with GitHub Actions and the official MCP" width="100%"></p>

Run **scheduled Upwork job searches in GitHub Actions** — no server to babysit, no third-party service, no scraping — using the **Upwork official MCP** and [`upwork-cli`](../../). This example, [`upwork-jobs.yml`](./upwork-jobs.yml), is a GitHub Actions workflow you copy into your own repo: on a cron schedule (or manual trigger) it restores your Upwork OAuth token from a repo secret, searches Upwork for a list of keywords, uploads the results as a `jobs.json` artifact, and — if you've set it up — posts a summary to Slack. It's a clean way to **automate Upwork** job discovery entirely inside CI, with nothing running on your own machine.

## Quick start

1. **Copy the workflow** into your repo (this repo, a fork, or wherever you keep `upwork-cli`): copy [`upwork-jobs.yml`](./upwork-jobs.yml) to `.github/workflows/upwork-jobs.yml`.
2. **Get a token file** by logging in locally — GitHub Actions can't do this step because `upwork login` opens a real browser:
   ```sh
   git clone https://github.com/Majboor/upwork-cli && cd upwork-cli
   npm install
   node bin/upwork.js login      # opens your browser once
   cat ~/.upwork-cli/tokens.json # copy this whole file's contents
   ```
3. **Add repo secrets**: in your GitHub repo go to **Settings → Secrets and variables → Actions → New repository secret**:
   - `UPWORK_TOKENS_JSON` — paste the entire contents of `~/.upwork-cli/tokens.json` (required).
   - `SLACK_WEBHOOK_URL` — a Slack [Incoming Webhook](https://api.slack.com/apps) URL (optional; enables the Slack summary step).
4. **Enable Actions** on the repo (Settings → Actions → General, if it isn't already), then run the workflow once by hand from the **Actions** tab (`workflow_dispatch`) to confirm it works before waiting for the cron schedule.

## Token & security note

`upwork-cli` handles token refresh automatically once it has a valid token to start from — this workflow just needs to give it that starting point on every run, since Actions runners are ephemeral and remember nothing between jobs. The `UPWORK_TOKENS_JSON` secret is a **point-in-time snapshot** of `~/.upwork-cli/tokens.json`, written into place at the start of each run and never written back out, so:

- **It can go stale.** If Upwork revokes the underlying session (password change, long inactivity, app permissions revoked, etc.), refreshing will fail and you'll need to run `upwork login` locally again and re-paste the secret.
- **Never commit `tokens.json` or paste it anywhere other than a GitHub encrypted secret.** It grants access to your Upwork account. The workflow writes it to disk only inside the runner's throwaway filesystem, with `chmod 600`, and that filesystem is destroyed when the job ends.
- **Rotate it if you suspect it leaked** — run `upwork login` again locally (or revoke the app's access from your Upwork account settings) and update the secret with the fresh file.
- Secrets are masked in workflow logs by GitHub Actions, but keep custom debug output (`echo`, `cat`) away from the token file regardless.

## Config

Edit these directly in the workflow's `env:` block (or the cron expression) once it's copied into your repo:

| Setting | Default | Meaning |
|---|---|---|
| `KEYWORDS` | `n8n automation,GoHighLevel,AI automation` | comma-separated Upwork search terms |
| `LIMIT` | `10` | results per keyword, per run |
| `ORG` | `talent` | `upwork-cli` account alias to search under |
| `on.schedule` cron | `0 */2 * * *` | every 2 hours (UTC); edit to taste |
| `UPWORK_TOKENS_JSON` (secret) | — | required; your restored OAuth token file |
| `SLACK_WEBHOOK_URL` (secret) | — | optional; enables the Slack summary step |

Results are always written to `jobs.json` and uploaded as a workflow artifact named `upwork-jobs-<run id>`, downloadable from the run's summary page in the **Actions** tab, retained for 14 days.

---

Part of [`upwork-cli`](../../), an OAuth wrapper over the official Upwork MCP. See also [Automate Upwork](../../docs/automate-upwork.md) for the end-to-end pipeline (search → enrich → score → draft), and the [cron](../cron/) and [Slack](../slack/) examples for local, non-CI variants.
