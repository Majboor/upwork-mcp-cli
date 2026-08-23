# Upwork Automation Recipes (Copy-Paste Cookbook)

<p align="center"><img src="media/recipes.png" alt="Upwork automation recipes — command-line cookbook for the official MCP" width="100%"></p>

Practical, copy-paste **Upwork automation** recipes built on the **Upwork official MCP** via [`upwork-cli`](../). Every recipe is a real command you can run after `upwork login`.

- [Job hunting](#job-hunting)
- [Client vetting & competitor bids](#client-vetting--competitor-bids)
- [Proposals](#proposals)
- [Pipeline & money](#pipeline--money)
- [Account & dashboard](#account--dashboard)
- [Piping to jq / scripts](#piping-to-jq--scripts)

## Job hunting

```sh
# search jobs by keyword
upwork find_jobs search -p query="n8n automation" -p limit=10 --org talent --table

# narrow by type + experience
upwork find_jobs search -p query="GoHighLevel" -p job_type=hourly -p experience_level=expert --org talent

# your saved / favorite jobs
upwork find_saved_jobs list --org talent --table

# save a job for later
upwork save_job save -p job_id=<id> --org talent
```

## Client vetting & competitor bids

```sh
# full job detail: competitor bid stats, client spend/history, connects cost
upwork find_jobs get --json '{"action":"get","params":{"id":"<id>"}}' --org talent --raw

# the going hourly rate for similar work
upwork get_rate_insights get -p experience_level=expert -p project_text="ai automation" --org client
```

Look inside `content[0].text` for `applicationsBidStats` (avg/min/max) and the client record. See [every data point](data-points.md).

## Proposals

```sh
# list your proposals & invitations
upwork list_freelancer_proposals list --org talent --table

# draft a proposal (nothing submitted yet)
upwork manage_proposals create -p job_reference=<id> \
  -p cover_letter="Hi — I build …" -p charged_amount=30 --org talent

# confirm a draft
upwork confirm proposal <draft_id> --org talent

# withdraw
upwork manage_proposals withdraw -p proposal_id=<id> --org talent
```

## Pipeline & money

```sh
upwork list_contracts list --org talent --table          # contracts & time reports
upwork list_offers list_mine --org talent                # offers to you
upwork respond_to_offer ... --org talent                 # accept/decline/changes
upwork list_milestones list -p contract_id=<id> --org talent
upwork get_freelancer_financials get --org talent        # earnings & transactions
```

## Account & dashboard

```sh
upwork get_freelancer_dashboard check --org talent       # connects, matches, invites, offers
upwork get_profile get --org talent                      # profile + connects balance
upwork get_messages ... --org talent                     # rooms & messages
upwork accounts                                           # list your Upwork accounts
```

## Piping to jq / scripts

Everything supports `--raw` (full MCP envelope) for scripting:

```sh
upwork find_jobs search -p query=react -p limit=20 --org talent --raw \
  | jq -r '.content[0].text | fromjson | .jobs[] | "\(.id)\t\(.title)"'
```

Want this on a schedule? Use the [n8n workflow](../examples/n8n/) or a cron script — see [Automate Upwork](automate-upwork.md).

---

Back to [README](../README.md) · [Every data point →](data-points.md)
