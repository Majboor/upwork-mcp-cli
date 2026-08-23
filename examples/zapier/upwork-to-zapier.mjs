#!/usr/bin/env node
/**
 * upwork-to-zapier.mjs — push NEW Upwork jobs to a Zapier "Catch Hook" via the
 * official Upwork MCP (through upwork-cli), so any of Zapier's 6000+ apps can
 * react to them (Sheets, Airtable, Gmail, CRMs, Slack, SMS, …).
 * ----------------------------------------------------------------------------
 * Dependency-free: only Node builtins + global fetch (Node 18+). No npm install.
 *
 * What it does:
 *   1. Runs `upwork find_jobs search ... --raw` for each keyword in KEYWORDS.
 *   2. Parses the MCP envelope's `content[0].text` (a JSON string) to get jobs.
 *   3. Dedupes against a small state file so only NEW job IDs get sent.
 *   4. POSTs each new job — as ONE flat JSON object per job (not a batch) — to
 *      ZAPIER_HOOK_URL, since Zapier's field-mapping UI works best against a
 *      flat, predictable shape (Zapier calls this the "sample" it maps from).
 *   5. Prints a one-line summary.
 *
 * If ZAPIER_HOOK_URL is unset, it still runs the search (so you can see it
 * work end to end) but skips posting — it prints setup instructions and a
 * "would post" preview instead, then exits 0. Nothing is marked as "seen" in
 * that dry-run mode, so real jobs still get delivered once you wire up Zapier.
 *
 * Usage:
 *   ZAPIER_HOOK_URL="https://hooks.zapier.com/hooks/catch/…/…/" node examples/zapier/upwork-to-zapier.mjs
 *   KEYWORDS="react,shopify" LIMIT=15 node examples/zapier/upwork-to-zapier.mjs
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
const ZAPIER_HOOK_URL = process.env.ZAPIER_HOOK_URL || '';
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.upwork-cli', 'alerts');
const STATE_FILE = join(STATE_DIR, 'zapier-seen.txt');

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
  if (!Array.isArray(skills) || skills.length === 0) return '';
  return skills
    .map((s) => (typeof s === 'string' ? s : s?.name || s?.prettyName))
    .filter(Boolean)
    .join(', ');
}

// ---- build the flat, Zapier-friendly payload for one job --------------------
// Kept intentionally flat (no nested objects/arrays) so Zapier's field-mapping
// UI — which samples the first payload it receives on the Catch Hook — can
// pick out each value individually in later Zap steps.
function toZapierPayload(job, keyword) {
  return {
    id: String(job.id ?? ''),
    title: job.title || 'Untitled job',
    budget: formatBudget(job.budget),
    proposals: job.proposal_count ?? null,
    country: job.client?.country || 'n/a',
    skills: formatSkills(job.skills),
    snippet: job.description_snippet || '',
    keyword,
  };
}

async function postToZapier(payload) {
  const res = await fetch(ZAPIER_HOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Zapier hook returned ${res.status}: ${body.slice(0, 200)}`);
  }
}

function printHookInstructions() {
  console.log(
    [
      'ℹ️  ZAPIER_HOOK_URL is not set — running in dry-run mode (jobs are found but not posted).',
      '',
      'To enable Zapier delivery:',
      '  1. In Zapier: create a Zap → trigger app "Webhooks by Zapier" → event "Catch Hook".',
      '  2. Continue past "Find Data" (no test payload needed yet) and copy the custom webhook URL.',
      '  3. Run:',
      '       ZAPIER_HOOK_URL="https://hooks.zapier.com/hooks/catch/…/…/" node examples/zapier/upwork-to-zapier.mjs',
      '  4. Run it once for real so a sample job lands in Zapier, then click "Test trigger" in the',
      '     Zap editor — Zapier will show the flat fields (id, title, budget, …) ready to map into',
      '     any of its 6000+ action apps.',
      '',
    ].join('\n')
  );
}

// ---- main --------------------------------------------------------------------
async function main() {
  if (!ZAPIER_HOOK_URL) printHookInstructions();

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
      seen.add(id); // avoid duplicate sends if the same job matches multiple keywords
      newJobs.push(toZapierPayload(j, keyword));
    }
  }

  if (newJobs.length === 0) {
    console.log(`── 0 new job(s) across ${KEYWORDS.length} keyword(s). State: ${STATE_FILE}`);
    return;
  }

  if (!ZAPIER_HOOK_URL) {
    console.log(`Would POST ${newJobs.length} new job(s) to Zapier, one per request, e.g.:`);
    console.log(JSON.stringify(newJobs[0], null, 2));
    console.log(
      `── ${newJobs.length} new job(s) found (dry-run, nothing posted, nothing marked as seen).`
    );
    return;
  }

  const posted = [];
  for (const job of newJobs) {
    try {
      await postToZapier(job);
      posted.push(job.id);
    } catch (err) {
      console.error(`  ⚠️  Zapier post failed for job ${job.id}: ${err.message}`);
      // Not marked seen — retried on the next run instead of being lost.
    }
  }

  if (posted.length > 0) markSeen(posted);

  console.log(
    `── ${posted.length}/${newJobs.length} new job(s) across ${KEYWORDS.length} keyword(s) posted to Zapier. State: ${STATE_FILE}`
  );
  if (posted.length < newJobs.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
