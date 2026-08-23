#!/usr/bin/env node
/**
 * upwork-to-slack.mjs — post NEW Upwork jobs to a Slack channel via the
 * official Upwork MCP (through upwork-cli) and a Slack Incoming Webhook.
 * ----------------------------------------------------------------------------
 * Dependency-free: only Node builtins + global fetch (Node 18+). No npm install.
 *
 * What it does:
 *   1. Runs `upwork find_jobs search ... --raw` for each keyword in KEYWORDS.
 *   2. Parses the MCP envelope's `content[0].text` (a JSON string) to get jobs.
 *   3. Dedupes against a small state file so only NEW job IDs get alerted.
 *   4. Posts new jobs to SLACK_WEBHOOK_URL as a Slack Block Kit message.
 *   5. Prints a one-line summary.
 *
 * If SLACK_WEBHOOK_URL is unset, it still runs the search (so you can see it
 * work end to end) but skips posting — it prints setup instructions and a
 * "would post" preview instead, then exits 0. Nothing is marked as "seen" in
 * that dry-run mode, so real jobs still get delivered once you wire up Slack.
 *
 * Usage:
 *   SLACK_WEBHOOK_URL="https://hooks.slack.com/services/…" node examples/slack/upwork-to-slack.mjs
 *   KEYWORDS="react,shopify" LIMIT=15 node examples/slack/upwork-to-slack.mjs
 *
 * Cron (every 30 min): see README.md in this folder.
 */

import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

// ---- config (override via env) ---------------------------------------------
const KEYWORDS = (process.env.KEYWORDS || 'n8n automation,GoHighLevel,AI automation')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = process.env.LIMIT || '10';
const ORG = process.env.ORG || 'talent';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.upwork-cli', 'alerts');
const STATE_FILE = join(STATE_DIR, 'slack-seen.txt');
const CHUNK_SIZE = 8; // jobs per Slack message, keeps blocks well under Slack's 50-block cap

// ---- locate the CLI: prefer `upwork` on PATH, else this repo's bin/upwork.js ----
function resolveCli() {
  const probe = spawnSync('upwork', ['--version'], { stdio: 'ignore' });
  if (!probe.error) return { cmd: 'upwork', args: [] };
  const fallback = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'upwork.js');
  return { cmd: 'node', args: [fallback] };
}

// ---- run a search and unwrap the MCP `content[0].text` JSON-string envelope ----
async function searchJobs(keyword) {
  const { cmd, args } = resolveCli();
  const argv = [
    ...args,
    'find_jobs',
    'search',
    '-p',
    `query=${keyword}`,
    '-p',
    `limit=${LIMIT}`,
    '--org',
    ORG,
    '--raw',
  ];
  const { stdout } = await execFileP(cmd, argv, { timeout: 30000, maxBuffer: 10 << 20 });

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error('could not parse CLI output as JSON');
  }
  const text = envelope?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('unexpected CLI output shape (missing content[0].text)');

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('could not parse content[0].text as JSON');
  }
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

// ---- state file: one job ID per line ---------------------------------------
function loadSeen() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) return new Set();
  return new Set(
    readFileSync(STATE_FILE, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}
function markSeen(ids) {
  if (ids.length === 0) return;
  appendFileSync(STATE_FILE, ids.join('\n') + '\n');
}

// ---- formatting helpers (robust to missing/odd-shaped fields) --------------
function escapeMrkdwn(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatBudget(b) {
  if (b == null) return 'n/a';
  if (typeof b === 'number') return `$${b}`;
  if (typeof b === 'string') return b || 'n/a';
  if (typeof b === 'object') {
    const min = b.minimum ?? b.min ?? b.amount;
    const max = b.maximum ?? b.max;
    const cur = b.currencyCode || b.currency || '';
    if (min != null && max != null && min !== max) return `${min}–${max} ${cur}`.trim();
    if (min != null) return `${min} ${cur}`.trim();
  }
  return 'n/a';
}
function formatSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return 'n/a';
  const names = skills.map((s) => (typeof s === 'string' ? s : s?.name || s?.prettyName)).filter(Boolean);
  return names.length ? names.slice(0, 6).join(', ') : 'n/a';
}
function jobUrl(j) {
  return j.url || j.job_url || j.link || null;
}

// ---- Slack Block Kit message builder ----------------------------------------
function buildBlocks(jobs) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🆕 ${jobs.length} new Upwork job${jobs.length === 1 ? '' : 's'}`, emoji: true },
    },
  ];
  for (const j of jobs) {
    const title = escapeMrkdwn(j.title || 'Untitled job');
    const url = jobUrl(j);
    const titleLine = url ? `*<${url}|${title}>*` : `*${title}*`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: titleLine } });

    const meta = [
      `💰 ${formatBudget(j.budget)}`,
      `📨 ${j.proposal_count ?? 'n/a'} proposals`,
      `🌍 ${j.client?.country || 'n/a'}`,
      `🛠 ${formatSkills(j.skills)}`,
      j._keyword ? `🔎 "${escapeMrkdwn(j._keyword)}"` : null,
    ]
      .filter(Boolean)
      .join('   ·   ');
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: meta }] });
    blocks.push({ type: 'divider' });
  }
  if (blocks[blocks.length - 1]?.type === 'divider') blocks.pop();
  return blocks;
}

async function postToSlack(jobs) {
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    const payload = { text: `${chunk.length} new Upwork job(s)`, blocks: buildBlocks(chunk) };
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Slack webhook returned ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

function printWebhookInstructions() {
  console.log(
    [
      'ℹ️  SLACK_WEBHOOK_URL is not set — running in dry-run mode (jobs are found but not posted).',
      '',
      'To enable Slack alerts:',
      '  1. In Slack: https://api.slack.com/apps → create/select an app → "Incoming Webhooks" → toggle on.',
      '  2. Click "Add New Webhook to Workspace", pick a channel, and copy the URL.',
      '  3. Run:',
      '       SLACK_WEBHOOK_URL="https://hooks.slack.com/services/…" node examples/slack/upwork-to-slack.mjs',
      '',
    ].join('\n')
  );
}

// ---- main --------------------------------------------------------------------
async function main() {
  if (!SLACK_WEBHOOK_URL) printWebhookInstructions();

  const seen = loadSeen();
  const newJobs = [];

  for (const keyword of KEYWORDS) {
    let jobs;
    try {
      jobs = await searchJobs(keyword);
    } catch (err) {
      console.error(`  ⚠️  search failed for "${keyword}": ${err.message}`);
      continue;
    }
    for (const j of jobs) {
      const id = String(j?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id); // avoid duplicate alerts if the same job matches multiple keywords
      newJobs.push({ ...j, id, _keyword: keyword });
    }
  }

  if (newJobs.length === 0) {
    console.log(`── 0 new job(s) across ${KEYWORDS.length} keyword(s). State: ${STATE_FILE}`);
    return;
  }

  if (!SLACK_WEBHOOK_URL) {
    console.log(`Would post ${newJobs.length} new job(s) to Slack:`);
    for (const j of newJobs) console.log(`  • [${j._keyword}] ${j.title || 'Untitled job'} (id ${j.id})`);
    console.log(`── ${newJobs.length} new job(s) found (dry-run, nothing posted, nothing marked as seen).`);
    return;
  }

  try {
    await postToSlack(newJobs);
    markSeen(newJobs.map((j) => j.id));
    console.log(
      `── ${newJobs.length} new job(s) across ${KEYWORDS.length} keyword(s) posted to Slack. State: ${STATE_FILE}`
    );
  } catch (err) {
    console.error(`  ⚠️  Slack post failed: ${err.message}`);
    console.error('  Jobs were NOT marked as seen — they will be retried next run.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
