# Every Data Point the Upwork Official MCP Exposes

<p align="center"><img src="media/datapoints.png" alt="Data the Upwork official MCP exposes — competitor bids, client spend, rate insights" width="100%"></p>

The **Upwork official MCP** returns a lot more than a public job listing shows. This is a field guide to the data you can read through [`upwork-cli`](../) — including insights that normally feel like premium features, such as **competitor bid ranges** and **client lifetime spend**.

> Deep fields (like `applicationsBidStats` and `jobActivity`) arrive as a JSON string nested in `content[0].text`. Use `--raw` and parse it — the [bridge](../examples/n8n/bridge.mjs) shows the exact unwrap.

## Per job (`find_jobs get`)

| Field | What it tells you |
|-------|-------------------|
| `applicationsBidStats.avgRateBid` / `minRateBid` / `maxRateBid` | **Competitor bids** — average, lowest, highest bid on the posting |
| `jobActivity` | applicants, interviewing, invites sent, hires, last-viewed |
| `connects_cost` | connects required to apply |
| `content.title` / `content.description` | full posting text |
| `screening_questions` | the client's screening questions |
| skills, budget, `job_type`, `experience_level`, `duration` | scoping details |

## Per client (attached to a job)

| Field | What it tells you |
|-------|-------------------|
| lifetime spend | total the client has ever paid on Upwork |
| total contracts / total hires | how often they actually hire |
| hours | total hours paid |
| feedback score | public rating — compare to the private average to spot a **trust gap** |
| work history | past jobs, titles, and outcomes |
| verification status, country | legitimacy & location |

## Rate insights (`get_rate_insights`)

- The going **hourly rate range** for similar work, by experience level — to price a bid or a job posting.

## Your account (freelancer)

| Tool | Data |
|------|------|
| `get_freelancer_dashboard` | connects balance (free/paid/rollover), matching jobs, invitations, offers, messages, active contracts |
| `get_profile` | profile, transaction history, connects balance |
| `get_freelancer_financials` | earnings and transactions |
| `list_contracts` | contracts + time reports |
| `list_freelancer_proposals` | your proposals and received invitations |
| `list_offers` / `list_milestones` | offers and milestone state |

## As a client

| Tool | Data |
|------|------|
| `find_freelancers` | search freelancers + view profiles |
| `get_client_dashboard` | proposals received, invitations, offers, messages |
| `get_client_financials` | timesheets, work diaries, snapshots |
| `list_client_proposals` | proposals on your postings |

## The whole surface

The Upwork official MCP publishes **46 tools · 142 actions · 693 parameters**. List them all live:

```sh
upwork commands       # every tool + action, typed
upwork tools          # one-line summary per tool
```

---

Related: [Automate Upwork](automate-upwork.md) · [Recipes](recipes.md) · back to [README](../README.md)
