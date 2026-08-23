#!/usr/bin/env node
/**
 * upwork-to-telegram.mjs — Upwork job alerts delivered to a Telegram chat.
 * ----------------------------------------------------------------------------
 * Dependency-free (global fetch + node:child_process only). Searches the
 * Upwork official MCP (via `upwork-cli`) for a list of keywords, remembers
 * what it has already seen on disk, and sends only the NEW jobs to a
 * Telegram chat/channel through the Bot API — one HTML-formatted message
 * per job.
 *
 * Run once:
 *   node examples/telegram/upwork-to-telegram.mjs
 *
 * Custom search:
 *   KEYWORDS="react,shopify" LIMIT=15 node examples/telegram/upwork-to-telegram.mjs
 *
 * Telegram setup: see README.md in this folder (talk to @BotFather for a
 * token, then message your bot once and hit getUpdates for a chat id).
 *
 * Schedule with cron: see README.md.
 */

import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

// ---- config (override via env) --------------------------------------------
const KEYWORDS = (
  process.env.KEYWORDS ||
  'python automation,web scraping,API integration,automation expert,data pipeline'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = process.env.LIMIT || '10';
const ORG = process.env.ORG || 'talent';
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.upwork-cli', 'alerts');
const SEEN_FILE = join(STATE_DIR, 'telegram-seen.txt');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Be gentle with Telegram's per-chat rate limit (~1 msg/sec is safe).
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 350);

// ---- locate the CLI: prefer `upwork` on PATH, else this repo's bin/upwork.js ----
function resolveCli() {
  const probe = spawnSync('upwork', ['--help'], { stdio: 'ignore' });
  if (!probe.error) return { cmd: 'upwork', baseArgs: [] };
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const local = join(__dirname, '..', '..', 'bin', 'upwork.js');
  return { cmd: process.execPath, baseArgs: [local] };
}

// ---- run one search via the CLI and return the parsed job list ----
async function searchJobs(cli, query) {
  const args = [
    ...cli.baseArgs,
    'find_jobs',
    'search',
    '-p',
    `query=${query}`,
    '-p',
    `limit=${LIMIT}`,
    '--org',
    ORG,
    '--raw',
  ];
  const { stdout } = await execFileP(cli.cmd, args, { timeout: 30000, maxBuffer: 16 << 20 });

  // The MCP envelope wraps the real payload as a JSON *string* at content[0].text.
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error('CLI did not return valid JSON (is `upwork login` done?)');
  }
  const text = envelope?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('unexpected CLI response shape (no content[0].text)');

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('content[0].text was not valid JSON');
  }

  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  return [];
}

// ---- "seen" state: a flat file of job ids we've already alerted on ----
async function loadSeen() {
  try {
    const text = await readFile(SEEN_FILE, 'utf8');
    return new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set(); // first run, or file doesn't exist yet
  }
}
async function markSeen(ids) {
  if (!ids.length) return;
  await mkdir(STATE_DIR, { recursive: true });
  await appendFile(SEEN_FILE, ids.join('\n') + '\n', 'utf8');
}

// ---- formatting -------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatBudget(budget) {
  if (budget == null) return '—';
  if (typeof budget === 'object') {
    // common shapes: { amount, currency } or { minimum, maximum, currency }
    const currency = budget.currency || 'USD';
    if (budget.amount != null) return `${budget.amount} ${currency}`;
    if (budget.minimum != null || budget.maximum != null) {
      const lo = budget.minimum ?? '?';
      const hi = budget.maximum ?? '?';
      return lo === hi ? `${lo} ${currency}` : `${lo}–${hi} ${currency}`;
    }
    return JSON.stringify(budget);
  }
  return String(budget);
}

function jobToMessage(job, keyword) {
  const title = escapeHtml(job.title || 'Untitled job');
  const budget = escapeHtml(formatBudget(job.budget));
  const proposals = escapeHtml(job.proposal_count ?? '—');
  const country = escapeHtml(job.client?.country || 'unknown');
  const skills = Array.isArray(job.skills) && job.skills.length
    ? escapeHtml(job.skills.slice(0, 6).join(', '))
    : null;
  let snippet = escapeHtml(job.description_snippet || '').trim();
  if (snippet.length > 400) snippet = snippet.slice(0, 400) + '…';

  const lines = [
    `🆕 <b>${title}</b>`,
    `💰 ${budget}  ·  📨 ${proposals} proposals  ·  🌍 ${country}`,
  ];
  if (skills) lines.push(`🏷 ${skills}`);
  if (snippet) lines.push('', snippet);
  lines.push('', `🔎 matched: <i>${escapeHtml(keyword)}</i>  ·  id: <code>${escapeHtml(job.id)}</code>`);
  return lines.join('\n');
}

// ---- Telegram Bot API --------------------------------------------------------
async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        text,
      }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      const desc = body?.description || `HTTP ${res.status}`;
      throw new Error(desc);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- setup instructions printed whenever Telegram isn't configured ----------
function printTelegramSetupInstructions() {
  console.log(`
Telegram is not configured yet — new jobs were found above but NOT sent.

Set these two environment variables and re-run:

  1. Create a bot:
     • Open Telegram, message @BotFather, send /newbot, follow the prompts.
     • BotFather gives you a token like  123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     • export TELEGRAM_BOT_TOKEN="123456789:AA..."

  2. Get your chat id:
     • Send any message to your new bot (open a DM with it first).
     • Visit  https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates  in a browser
       (with your real token in place of <YOUR_TOKEN>).
     • Find "chat":{"id": ...} in the JSON response — that's your chat id.
       (For a group/channel, add the bot to it first, then post a message there.)
     • export TELEGRAM_CHAT_ID="123456789"

  3. Re-run:
     node examples/telegram/upwork-to-telegram.mjs
`);
}

// ---- main --------------------------------------------------------------------
async function main() {
  const cli = resolveCli();
  const telegramConfigured = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

  console.log(`Searching ${KEYWORDS.length} keyword(s) via ${cli.cmd === 'upwork' ? 'upwork (PATH)' : 'node bin/upwork.js'} (--org ${ORG}, limit ${LIMIT})…`);

  const seen = await loadSeen();
  const newJobs = new Map(); // id -> { job, keyword }  (dedupe across keywords in this run too)
  let searchErrors = 0;

  for (const keyword of KEYWORDS) {
    try {
      const jobs = await searchJobs(cli, keyword);
      let newForKeyword = 0;
      for (const job of jobs) {
        const id = String(job.id);
        if (!id || seen.has(id) || newJobs.has(id)) continue;
        newJobs.set(id, { job, keyword });
        newForKeyword++;
      }
      console.log(`  "${keyword}": ${jobs.length} result(s), ${newForKeyword} new`);
    } catch (err) {
      searchErrors++;
      console.warn(`  "${keyword}": search failed — ${err.message}`);
    }
  }

  const newList = [...newJobs.values()];
  if (!newList.length) {
    console.log(`\nNo new jobs. (${seen.size} previously seen, ${searchErrors} keyword error(s).) State: ${SEEN_FILE}`);
    if (!telegramConfigured) printTelegramSetupInstructions();
    return;
  }

  console.log(`\nFound ${newList.length} new job(s):`);
  for (const { job, keyword } of newList) {
    console.log(`  [${keyword}] ${job.title || job.id} (id: ${job.id})`);
  }

  // Always persist "seen" state, whether or not Telegram delivery succeeds —
  // we don't want a Telegram outage to cause duplicate re-alerts forever.
  await markSeen(newList.map(({ job }) => String(job.id)));

  if (!telegramConfigured) {
    printTelegramSetupInstructions();
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const { job, keyword } of newList) {
    try {
      await sendTelegramMessage(jobToMessage(job, keyword));
      sent++;
    } catch (err) {
      failed++;
      console.warn(`  ! failed to send job ${job.id} to Telegram: ${err.message}`);
    }
    await sleep(SEND_DELAY_MS);
  }

  console.log(`\nTelegram: ${sent} sent, ${failed} failed. State: ${SEEN_FILE}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exitCode = 1;
});
