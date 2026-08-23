#!/usr/bin/env node
/**
 * upwork-to-notion.mjs — push NEW Upwork jobs into a Notion database via the
 * official Upwork MCP (through upwork-cli) and the Notion API.
 * ----------------------------------------------------------------------------
 * Dependency-free: only Node builtins + global fetch (Node 18+). No npm install.
 *
 * What it does:
 *   1. Runs `upwork find_jobs search ... --raw` for each keyword in KEYWORDS.
 *   2. Parses the MCP envelope's `content[0].text` (a JSON string) to get jobs.
 *   3. Queries the Notion database for JobIds it already has (pagination-safe)
 *      so re-runs never create duplicate pages, even across machines.
 *   4. Creates one Notion page per NEW job via POST /v1/pages.
 *   5. Prints a one-line summary.
 *
 * If NOTION_TOKEN or NOTION_DB is unset, it still runs the search (so you can
 * see it work end to end) but skips Notion entirely — it prints setup
 * instructions and a "would create" preview instead, then exits 0.
 *
 * Usage:
 *   NOTION_TOKEN="secret_…" NOTION_DB="…" node examples/notion/upwork-to-notion.mjs
 *   KEYWORDS="react,shopify" LIMIT=15 node examples/notion/upwork-to-notion.mjs
 *
 * Cron (every 30 min): see README.md in this folder.
 *
 * ---------------------------------------------------------------------------
 * Required Notion database properties (create these exact names/types before
 * running — see README.md "Quick start" for click-by-click setup):
 *
 *   Name      title        — job title (Notion requires exactly one title prop)
 *   Budget    rich_text    — raw budget string as returned by the MCP, e.g. "1100.0"
 *   Proposals number       — proposal_count
 *   Country   select       — client.country (options auto-created on first write)
 *   Skills    multi_select — job skills (options auto-created on first write)
 *   JobId     rich_text    — the Upwork job id; used to dedupe on every run
 * ---------------------------------------------------------------------------
 */

import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

// ---- config (override via env) ---------------------------------------------
const KEYWORDS = (process.env.KEYWORDS || 'n8n automation,GoHighLevel,AI automation')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIMIT = process.env.LIMIT || '10';
const ORG = process.env.ORG || 'talent';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DB = process.env.NOTION_DB || '';
const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

// ---- locate the CLI: prefer `upwork` on PATH, else this repo's bin/upwork.js ----
function resolveCli() {
  const probe = spawnSync('upwork', ['--version'], { stdio: 'ignore' });
  if (!probe.error) return { cmd: 'upwork', args: [] };
  const fallback = dirname(fileURLToPath(import.meta.url)) + '/../../bin/upwork.js';
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

// ---- Notion: fetch every JobId already stored, so we never duplicate pages ----
// This is the "robust" dedupe option: state lives in Notion itself (the source
// of truth you're writing to), not in a local file that can drift or vanish.
async function fetchExistingJobIds() {
  const ids = new Set();
  let cursor = undefined;
  do {
    const res = await fetch(`${NOTION_API}/databases/${NOTION_DB}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        filter: { property: 'JobId', rich_text: { is_not_empty: true } },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Notion query returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const page of data.results || []) {
      const rt = page.properties?.JobId?.rich_text;
      const val = Array.isArray(rt) ? rt.map((t) => t.plain_text).join('') : '';
      if (val) ids.add(val);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return ids;
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'content-type': 'application/json',
  };
}

// ---- formatting helpers (robust to missing/odd-shaped fields) --------------
function formatBudget(b) {
  if (b == null) return '';
  if (typeof b === 'string') return b;
  if (typeof b === 'number') return String(b);
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
  if (!Array.isArray(skills)) return [];
  return skills
    .map((s) => (typeof s === 'string' ? s : s?.name || s?.prettyName))
    .filter(Boolean)
    .map((s) => String(s).replace(/,/g, ' ').slice(0, 100)) // multi_select option names can't contain commas
    .slice(0, 25); // Notion pages cap at 100 properties total but keep messages sane
}
function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) : str;
}

// ---- Notion: build the property payload for one job ------------------------
function buildProperties(job) {
  const title = truncate(job.title || 'Untitled job', 2000);
  const budget = truncate(formatBudget(job.budget), 2000);
  const country = job.client?.country ? truncate(job.client.country, 100) : null;
  const skills = formatSkills(job.skills);

  const properties = {
    Name: { title: [{ type: 'text', text: { content: title } }] },
    Budget: { rich_text: budget ? [{ type: 'text', text: { content: budget } }] : [] },
    Proposals: { number: typeof job.proposal_count === 'number' ? job.proposal_count : null },
    Skills: { multi_select: skills.map((name) => ({ name })) },
    JobId: { rich_text: [{ type: 'text', text: { content: String(job.id) } }] },
  };
  if (country) properties.Country = { select: { name: country } };
  return properties;
}

async function createPage(job) {
  const res = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: NOTION_DB },
      properties: buildProperties(job),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Notion create-page returned ${res.status}: ${body.slice(0, 300)}`);
  }
}

function printSetupInstructions() {
  const missing = [];
  if (!NOTION_TOKEN) missing.push('NOTION_TOKEN');
  if (!NOTION_DB) missing.push('NOTION_DB');
  console.log(
    [
      `ℹ️  ${missing.join(' and ')} not set — running in dry-run mode (jobs are found but not sent to Notion).`,
      '',
      'To enable the Notion sync:',
      '  1. Create an integration: https://www.notion.so/my-integrations → "New integration" → copy the "Internal Integration Secret" (this is NOTION_TOKEN).',
      '  2. Create a database (a Table) in Notion with EXACTLY these properties:',
      '       Name      — title',
      '       Budget    — rich_text (Text)',
      '       Proposals — number',
      '       Country   — select',
      '       Skills    — multi_select',
      '       JobId     — rich_text (Text)',
      '  3. Share the database with your integration: open it → "•••" menu → Connections → add your integration.',
      '  4. Copy the database id from its URL: notion.so/<workspace>/<DATABASE_ID>?v=... (this is NOTION_DB).',
      '  5. Run:',
      '       NOTION_TOKEN="secret_…" NOTION_DB="…" node examples/notion/upwork-to-notion.mjs',
      '',
    ].join('\n')
  );
}

// ---- main --------------------------------------------------------------------
async function main() {
  const ready = Boolean(NOTION_TOKEN && NOTION_DB);
  if (!ready) printSetupInstructions();

  const foundJobs = [];
  const bySeen = new Set(); // within-run de-dupe across overlapping keywords

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
      if (!id || bySeen.has(id)) continue;
      bySeen.add(id);
      foundJobs.push({ ...j, id, _keyword: keyword });
    }
  }

  if (foundJobs.length === 0) {
    console.log(`── 0 job(s) found across ${KEYWORDS.length} keyword(s).`);
    return;
  }

  if (!ready) {
    console.log(`Would create ${foundJobs.length} Notion page(s) (subject to JobId dedupe against the live database):`);
    for (const j of foundJobs) console.log(`  • [${j._keyword}] ${j.title || 'Untitled job'} (id ${j.id})`);
    console.log(`── ${foundJobs.length} job(s) found (dry-run, nothing sent to Notion).`);
    return;
  }

  let existing;
  try {
    existing = await fetchExistingJobIds();
  } catch (err) {
    console.error(`Fatal: could not query Notion database: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const newJobs = foundJobs.filter((j) => !existing.has(j.id));
  if (newJobs.length === 0) {
    console.log(`── 0 new job(s) across ${KEYWORDS.length} keyword(s) (all ${foundJobs.length} already in Notion).`);
    return;
  }

  let created = 0;
  for (const job of newJobs) {
    try {
      await createPage(job);
      created += 1;
    } catch (err) {
      console.error(`  ⚠️  failed to create page for "${job.title || job.id}": ${err.message}`);
    }
  }

  console.log(
    `── ${created}/${newJobs.length} new job(s) across ${KEYWORDS.length} keyword(s) added to Notion.`
  );
  if (created < newJobs.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
