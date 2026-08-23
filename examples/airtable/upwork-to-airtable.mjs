#!/usr/bin/env node
/**
 * upwork-to-airtable.mjs — sync NEW Upwork jobs into an Airtable table via the
 * official Upwork MCP (through upwork-cli) and the Airtable REST API.
 * ----------------------------------------------------------------------------
 * Dependency-free: only Node builtins + global fetch (Node 18+). No npm install.
 *
 * What it does:
 *   1. Runs `upwork find_jobs search ... --raw` for each keyword in KEYWORDS.
 *   2. Parses the MCP envelope's `content[0].text` (a JSON string) to get jobs.
 *   3. Dedupes against a small local state file so only NEW job IDs get synced
 *      (see "Why a local seen-file, not filterByFormula" below).
 *   4. Batches new jobs into groups of 10 (Airtable's per-request limit) and
 *      POSTs them to the Airtable REST API as new records.
 *   5. Prints a one-line summary.
 *
 * If AIRTABLE_TOKEN / AIRTABLE_BASE / AIRTABLE_TABLE are unset, it still runs
 * the search (so you can see it work end to end) but skips writing to
 * Airtable — it prints setup instructions and a "would create" preview
 * instead, then exits 0. Nothing is marked as "seen" in that dry-run mode, so
 * real jobs still get synced once you wire up Airtable.
 *
 * Required Airtable fields (create these in your table first — see README.md):
 *   JobId (Single line text) · Title (Single line text) · Budget (Single line text)
 *   Proposals (Number) · Country (Single line text) · Skills (Single line text)
 *   FirstSeen (Date)
 *
 * Usage:
 *   AIRTABLE_TOKEN="pat…" AIRTABLE_BASE="app…" AIRTABLE_TABLE="Jobs" \
 *     node examples/airtable/upwork-to-airtable.mjs
 *   KEYWORDS="react,shopify" LIMIT=15 node examples/airtable/upwork-to-airtable.mjs
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
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || '';
const AIRTABLE_BASE = process.env.AIRTABLE_BASE || '';
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || '';
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.upwork-cli', 'alerts');
const STATE_FILE = join(STATE_DIR, 'airtable-seen.txt');
const BATCH_SIZE = 10; // Airtable's max records per create request

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

// ---- state file: one job ID per line ----------------------------------------
// Why a local seen-file, not `filterByFormula`:
// Airtable's REST API has no native upsert, so "dedupe" means either (a) GET
// the table with a filterByFormula OR(...) over JobId before every write, or
// (b) remember what you've already sent locally. (a) costs an extra API call
// per run and gets slower/uglier as the table (and the formula) grows; (b) is
// one flat file, O(1) to check, and matches the pattern the slack/cron
// examples already use. Trade-off: if you manually delete rows from Airtable,
// this script won't know and won't recreate them until you clear STATE_FILE.
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
  if (b == null) return '';
  if (typeof b === 'number') return `$${b}`;
  if (typeof b === 'string') return b;
  if (typeof b === 'object') {
    const min = b.minimum ?? b.min ?? b.amount;
    const max = b.maximum ?? b.max;
    const cur = b.currencyCode || b.currency || '';
    if (min != null && max != null && min !== max) return `${min}–${max} ${cur}`.trim();
    if (min != null) return `${min} ${cur}`.trim();
  }
  return '';
}
function formatSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';
  const names = skills.map((s) => (typeof s === 'string' ? s : s?.name || s?.prettyName)).filter(Boolean);
  return names.join(', ');
}

// ---- map a raw job into an Airtable record's `fields` object ---------------
function toAirtableFields(job, today) {
  return {
    JobId: String(job.id ?? ''),
    Title: job.title || 'Untitled job',
    Budget: formatBudget(job.budget),
    Proposals: typeof job.proposal_count === 'number' ? job.proposal_count : Number(job.proposal_count) || 0,
    Country: job.client?.country || '',
    Skills: formatSkills(job.skills),
    FirstSeen: today,
  };
}

// ---- POST new records to Airtable, BATCH_SIZE at a time --------------------
async function createRecords(records) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`;
  let created = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'content-type': 'application/json',
      },
      // typecast:true lets Airtable coerce e.g. a numeric-looking string into
      // a Number field, so a slightly-off field type still writes cleanly.
      body: JSON.stringify({ records: batch.map((fields) => ({ fields })), typecast: true }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Airtable API returned ${res.status}: ${body.slice(0, 300)}`);
    }
    created += batch.length;

    // Airtable rate limit is ~5 requests/sec per base — a small gap between
    // batches keeps a large sync well under that without needing a real queue.
    if (i + BATCH_SIZE < records.length) await new Promise((r) => setTimeout(r, 250));
  }

  return created;
}

function printSetupInstructions() {
  const missing = [
    !AIRTABLE_TOKEN && 'AIRTABLE_TOKEN',
    !AIRTABLE_BASE && 'AIRTABLE_BASE',
    !AIRTABLE_TABLE && 'AIRTABLE_TABLE',
  ].filter(Boolean);

  console.log(
    [
      `ℹ️  ${missing.join(', ')} not set — running in dry-run mode (jobs are found but not written to Airtable).`,
      '',
      'To enable Airtable sync:',
      '  1. In Airtable: create a base, then a table with these fields:',
      '       JobId (Single line text), Title (Single line text), Budget (Single line text),',
      '       Proposals (Number), Country (Single line text), Skills (Single line text), FirstSeen (Date)',
      '  2. Create a personal access token: https://airtable.com/create/tokens',
      '       — grant it data.records:write + data.records:read scope on that base.',
      '  3. Copy the base ID (starts with "app…") from the base URL or API docs page.',
      '  4. Run:',
      '       AIRTABLE_TOKEN="pat…" AIRTABLE_BASE="app…" AIRTABLE_TABLE="Jobs" \\',
      '         node examples/airtable/upwork-to-airtable.mjs',
      '',
    ].join('\n')
  );
}

// ---- main --------------------------------------------------------------------
async function main() {
  const configured = AIRTABLE_TOKEN && AIRTABLE_BASE && AIRTABLE_TABLE;
  if (!configured) printSetupInstructions();

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
      seen.add(id); // avoid duplicate records if the same job matches multiple keywords
      newJobs.push({ ...j, id, _keyword: keyword });
    }
  }

  if (newJobs.length === 0) {
    console.log(`── 0 new job(s) across ${KEYWORDS.length} keyword(s). State: ${STATE_FILE}`);
    return;
  }

  if (!configured) {
    console.log(`Would create ${newJobs.length} new record(s) in Airtable:`);
    for (const j of newJobs) console.log(`  • [${j._keyword}] ${j.title || 'Untitled job'} (id ${j.id})`);
    console.log(`── ${newJobs.length} new job(s) found (dry-run, nothing written, nothing marked as seen).`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const records = newJobs.map((j) => toAirtableFields(j, today));

  try {
    const created = await createRecords(records);
    markSeen(newJobs.map((j) => j.id));
    console.log(
      `── ${created} new record(s) across ${KEYWORDS.length} keyword(s) synced to Airtable. State: ${STATE_FILE}`
    );
  } catch (err) {
    console.error(`  ⚠️  Airtable sync failed: ${err.message}`);
    console.error('  Jobs were NOT marked as seen — they will be retried next run.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
