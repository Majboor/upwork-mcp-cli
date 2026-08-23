#!/usr/bin/env node
/**
 * upwork-to-discord.mjs — post NEW Upwork job matches to a Discord channel via a webhook.
 * ----------------------------------------------------------------------------------------
 * Searches the official Upwork MCP (through `upwork-cli`) for a list of keywords, diffs the
 * results against jobs already posted, and sends only the NEW ones to Discord as rich embeds
 * (title, budget, proposal count, client country, skills).
 *
 * Usage:
 *   DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…" node examples/discord/upwork-to-discord.mjs
 *   KEYWORDS="react,shopify" LIMIT=15 DISCORD_WEBHOOK_URL="…" node examples/discord/upwork-to-discord.mjs
 *
 * Run it with DISCORD_WEBHOOK_URL unset and it still searches + dedupes — it just prints what
 * it WOULD have posted plus setup instructions instead of calling Discord. Nothing is marked
 * "seen" in that case, so a real run later still finds the same jobs as new.
 *
 * Cron: see README.md in this folder.
 *
 * Dependency-free: only Node built-ins (global fetch, node:child_process, node:fs, …) — no
 * `npm install` needed, same approach as examples/cron and examples/n8n.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

// ---- config (override via env) ---------------------------------------------------------
const DEFAULT_KEYWORDS = 'AI automation,n8n automation,GoHighLevel,ChatGPT integration,API integration';
const KEYWORDS = (process.env.KEYWORDS || DEFAULT_KEYWORDS).split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = process.env.LIMIT || '10';
const ORG = process.env.ORG || 'talent';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.upwork-cli', 'alerts');
const SEEN_FILE = join(STATE_DIR, 'discord-seen.txt');
const EMBEDS_PER_MESSAGE = 10; // Discord's hard cap on embeds per webhook message

// Discord embed side-color, used as a quick "how crowded is this job" signal.
const COLOR_UNKNOWN = 0x5865f2; // blurple — no proposal count returned
const COLOR_LOW = 0x57f287; // green  — fewer than 5 proposals
const COLOR_MID = 0xfee75c; // yellow — 5-19 proposals
const COLOR_HIGH = 0xed4245; // red    — 20+ proposals

// ---- locate the CLI: prefer `upwork` on PATH, else this repo's bin/upwork.js -----------
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_CLI = join(HERE, '..', '..', 'bin', 'upwork.js');
function isOnPath(bin) {
  const dirs = (process.env.PATH || '').split(delimiter);
  return dirs.some((d) => {
    try { accessSync(join(d, bin), constants.X_OK); return true; } catch { return false; }
  });
}
const CLI = isOnPath('upwork') ? { cmd: 'upwork', args: [] } : { cmd: 'node', args: [REPO_CLI] };

// ---- run the CLI, always --raw, unwrap the MCP content[0].text JSON string -------------
async function cli(argv) {
  const { stdout } = await execFileP(CLI.cmd, [...CLI.args, ...argv, '--raw'], {
    maxBuffer: 32 << 20,
    timeout: 60000,
  });
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { return {}; }
  const text = envelope?.content?.[0]?.text;
  if (typeof text !== 'string') return envelope || {};
  try { return JSON.parse(text); } catch { return { _text: text }; }
}

// ---- small helpers, tolerant of missing/odd-shaped fields -------------------------------
// find_jobs results sometimes wrap snippets in these markers; strip them for display.
const clean = (s) => (typeof s === 'string' ? s.replace(/<\/?untrusted_participant_content>/g, '').trim() : '');
const truncate = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// budget has shown up as a plain numeric string ("50.0"), "0.0" for hourly jobs, or (per
// the MCP schema) could in principle be an object with min/max — handle all of it gracefully.
function formatBudget(budget) {
  if (budget == null || budget === '') return 'n/a';
  const n = Number(budget);
  if (!Number.isNaN(n)) return n > 0 ? `$${n}` : 'n/a (hourly)';
  if (typeof budget === 'object') {
    const min = budget.minimum ?? budget.min ?? budget.amount;
    const max = budget.maximum ?? budget.max;
    if (min != null && max != null && min !== max) return `$${min}–$${max}`;
    if (min != null) return `$${min}`;
  }
  return String(budget);
}

function embedColor(job) {
  const n = Number(job.proposal_count);
  if (job.proposal_count == null || Number.isNaN(n)) return COLOR_UNKNOWN;
  if (n < 5) return COLOR_LOW;
  if (n < 20) return COLOR_MID;
  return COLOR_HIGH;
}

// Note: find_jobs search doesn't return a public job URL (the visible upwork.com/jobs/~…
// link uses a separate cipher id), so we surface the raw job id instead — it works with
// `upwork find_jobs get -p id=<id> --org talent --raw`.
function jobToEmbed(job, keyword) {
  const title = truncate(clean(job.title) || `Job ${job.id}`, 256);
  const snippet = truncate(clean(job.description_snippet) || 'No description provided.', 300);
  const skills = Array.isArray(job.skills) && job.skills.length ? job.skills.slice(0, 5).join(', ') : 'n/a';
  return {
    title,
    description: snippet,
    color: embedColor(job),
    fields: [
      { name: 'Budget', value: formatBudget(job.budget), inline: true },
      { name: 'Proposals', value: job.proposal_count == null ? '—' : String(job.proposal_count), inline: true },
      { name: 'Client country', value: job?.client?.country || 'n/a', inline: true },
      { name: 'Skills', value: skills, inline: false },
      { name: 'Job ID', value: `\`${job.id}\``, inline: false },
    ],
    footer: { text: `matched "${keyword}" · upwork-cli` },
    timestamp: job.published_date || job.created_date || new Date().toISOString(),
  };
}

async function postToDiscord(entries) {
  let posted = 0;
  const totalBatches = Math.ceil(entries.length / EMBEDS_PER_MESSAGE);
  for (let i = 0; i < entries.length; i += EMBEDS_PER_MESSAGE) {
    const chunk = entries.slice(i, i + EMBEDS_PER_MESSAGE);
    const batchNum = i / EMBEDS_PER_MESSAGE + 1;
    const body = {
      content: totalBatches > 1
        ? `**${entries.length} new Upwork job(s)** (batch ${batchNum}/${totalBatches})`
        : `**${entries.length} new Upwork job(s)**`,
      embeds: chunk.map(({ job, keyword }) => jobToEmbed(job, keyword)),
    };
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`  ! Discord webhook returned ${res.status}: ${text.slice(0, 200)}`);
        continue; // leave this batch unmarked — it'll be retried on the next run
      }
      for (const { job } of chunk) {
        appendFileSync(SEEN_FILE, `${job.id}\n`);
        posted++;
      }
    } catch (err) {
      console.error(`  ! failed to post batch ${batchNum}/${totalBatches}: ${String(err.message || err)}`);
    }
  }
  return posted;
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(SEEN_FILE)) appendFileSync(SEEN_FILE, '');
  const seen = new Set(readFileSync(SEEN_FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));

  // ---- search every keyword, collect + dedupe jobs (within this run, by id) -----------
  const byId = new Map(); // id -> { job, keyword }
  for (const keyword of KEYWORDS) {
    let result;
    try {
      result = await cli(['find_jobs', 'search', '-p', `query=${keyword}`, '-p', `limit=${LIMIT}`, '--org', ORG]);
    } catch (err) {
      console.error(`  ! search failed for "${keyword}": ${String(err.message || err).split('\n')[0]}`);
      continue;
    }
    const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
    for (const job of jobs) {
      const id = String(job?.id ?? '');
      if (!id || byId.has(id)) continue;
      byId.set(id, { job, keyword });
    }
  }

  const newEntries = [...byId.values()].filter(({ job }) => !seen.has(String(job.id)));
  console.log(`Searched ${KEYWORDS.length} keyword(s), found ${byId.size} job(s), ${newEntries.length} new.`);

  if (newEntries.length === 0) {
    console.log('Nothing new to post.');
    return;
  }

  if (!WEBHOOK_URL) {
    console.log('\nDISCORD_WEBHOOK_URL is not set — not posting, just showing what would go out:\n');
    for (const { job, keyword } of newEntries) {
      console.log(`  [${keyword}] ${clean(job.title) || job.id} — ${formatBudget(job.budget)} — ${job.proposal_count ?? '—'} proposals`);
    }
    console.log(`
To post these to Discord:
  1. In Discord: Server Settings -> Integrations -> Webhooks -> New Webhook (pick a channel).
  2. Copy the webhook URL.
  3. Run:  DISCORD_WEBHOOK_URL="<url>" node examples/discord/upwork-to-discord.mjs
     (export it, or set it in your crontab line, to run this on a schedule.)`);
    return; // nothing marked as seen — a real run later will still see these as new
  }

  const posted = await postToDiscord(newEntries);
  console.log(`Posted ${posted}/${newEntries.length} new job(s) to Discord. State: ${SEEN_FILE}`);
}

main().catch((err) => {
  console.error('Fatal error:', String(err?.message || err));
  process.exitCode = 1;
});
