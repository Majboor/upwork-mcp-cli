#!/usr/bin/env node
/**
 * Upwork MCP → n8n bridge
 * ----------------------------------------------------------------------------
 * A tiny, dependency-free HTTP shim that exposes the Upwork MCP (via upwork-cli)
 * as plain JSON endpoints n8n can hit with the built-in HTTP Request node.
 *
 * Why a bridge? n8n's HTTP node speaks REST, not MCP's tools/call envelope +
 * OAuth. This wraps `upwork-cli` (which already handles OAuth 2.1 + PKCE and the
 * `content[0].text` unwrap quirk) so your workflow stays clean.
 *
 *   GET  /api/health                 → { ok, cli, loggedIn, account }
 *   GET  /api/search?q=&type=&limit= → { jobs:[ normalized… ] }   live find_jobs search
 *   GET  /api/job?id=                → { job }  deep intel: competitor bids, client history, trust gap
 *   GET  /api/dashboard              → { connects, matchingJobs, activeContracts, … }
 *   POST /api/analyze  {id}          → { analysis }  LLM triage (fit / win-odds / suggested bid)
 *   POST /api/draft    {id}          → { draft }     LLM proposal cover letter
 *
 * Run:   node examples/n8n/bridge.mjs        (defaults to http://localhost:4178)
 * Login first:  node bin/upwork.js login
 *
 * The two LLM endpoints shell out to a local model CLI (Codex by default, or set
 * LLM_CMD) so there's no API key. If none is found they degrade gracefully to a
 * deterministic heuristic instead of failing the workflow.
 */
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
// bridge lives at <repo>/examples/n8n/bridge.mjs → CLI at <repo>/bin/upwork.js
const CLI = process.env.UPWORK_CLI || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'upwork.js');
const PORT = process.env.PORT || 4178;

// ---- CLI bridge: always --raw, then unwrap the MCP content[0].text JSON string ----
async function cli(argv, { timeout = 60000 } = {}) {
  const { stdout } = await execFileP('node', [CLI, ...argv, '--raw'], { timeout, maxBuffer: 32 << 20 });
  let env; try { env = JSON.parse(stdout); } catch { return {}; }
  const t = env?.content?.[0]?.text;
  if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { _text: t }; } }
  return env;
}
const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
const clean = (s) => (typeof s === 'string' ? s.replace(/<\/?untrusted_participant_content>/g, '').trim() : s);

function normJob(j) {
  return {
    id: String(j.id), title: clean(j.title), snippet: clean(j.description_snippet),
    job_type: j.job_type, experience_level: j.experience_level, duration: j.duration,
    proposal_count: num(j.proposal_count), budget: j.budget, skills: j.skills || [],
    published_date: j.published_date || j.created_date,
    client: { country: j.client?.country, verification_status: j.client?.verification_status,
      total_hires: num(j.client?.total_hires), rating: num(j.client?.rating) },
  };
}
async function deepJob(id) {
  const res = await cli(['find_jobs', 'get', '--json', JSON.stringify({ action: 'get', params: { id: String(id) } }), '--org', 'talent']);
  const mp = res?.data?.marketplaceJobPosting || {}; const act = mp.activityStat || {};
  const dv = (x) => (x && typeof x === 'object' ? x.displayValue ?? x.rawValue : x);
  const bid = act.applicationsBidStats || {};
  return {
    id: String(id), title: clean(mp?.content?.title) || null, description: clean(mp?.content?.description) || null,
    can_apply: res?.can_apply ?? null, connects_cost: num(res?.connects_cost),
    bid_stats: { avg: num(dv(bid.avgRateBid)), min: num(dv(bid.minRateBid)), max: num(dv(bid.maxRateBid)) },
    job_activity: act.jobActivity || null, client_record: res?.client_record || null,
    work_history: res?.client_work_history || null, screening: res?.screening_questions || null,
  };
}

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });

// ---- Optional local LLM. Set LLM_CMD (e.g. "codex") for real text; else heuristic. ----
const LLM_CMD = process.env.LLM_CMD || 'codex';
const LLM_DIR = process.env.LLM_DIR || process.env.HOME;
function llmText(prompt, { timeout = 170000 } = {}) {
  return new Promise((resolve, reject) => {
    // Codex-compatible invocation. stdin MUST be 'ignore' (=/dev/null) or codex hangs.
    const args = LLM_CMD === 'codex' ? ['exec', '-C', LLM_DIR, '--skip-git-repo-check', prompt] : [prompt];
    const child = spawn(LLM_CMD, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('llm timeout')); }, timeout);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
  });
}
async function jobContext(id) {
  const j = await deepJob(id); const cr = j.client_record || {};
  return `JOB: ${j.title || id}\nDESCRIPTION: ${(j.description || '').slice(0, 1200)}\n` +
    `COMPETITOR BIDS: avg ${j.bid_stats.avg ?? '—'}, range ${j.bid_stats.min ?? '—'}–${j.bid_stats.max ?? '—'}\n` +
    `CLIENT: lifetime spend ${cr.spend_total ?? '—'}, ${cr.contracts_total ?? '—'} contracts, feedback ${cr.feedback_score ?? '—'}\n` +
    `CONNECTS TO APPLY: ${j.connects_cost ?? '—'}\nSCREENING: ${JSON.stringify(j.screening || []).slice(0, 400)}`;
}
function heuristic(kind, j) {
  const b = j.bid_stats || {}; const cr = j.client_record || {};
  if (kind === 'analyze')
    return `FIT: heuristic (no LLM_CMD set)\nWIN_ODDS: ${j.connects_cost > 12 ? 'low — crowded' : 'medium'}\n` +
      `SUGGESTED_BID: ${b.avg ? Math.round(b.avg * 0.95) : '—'} (~5% under the ${b.avg ?? '—'} avg competitor bid)\n` +
      `RED_FLAGS: ${cr.feedback_score && cr.feedback_score < 4 ? 'low client feedback' : 'none obvious'}\nANGLE: lead with the client's real spend history.`;
  return `Hi — I read your posting on "${j.title || 'this project'}" closely. I've shipped this exact kind of work and can start with a quick scoped first step. (Set LLM_CMD for AI-written proposals.)`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`); const q = url.searchParams;
  try {
    if (url.pathname === '/api/health') {
      try { const who = await cli(['whoami']); const acct = who?.accounts?.[0]?.name || null;
        return send(res, 200, { ok: true, cli: true, loggedIn: !!acct, account: acct }); }
      catch (e) { const m = String(e.message || e); return send(res, 200, { ok: false, cli: true, loggedIn: false, reason: /login|401/i.test(m) ? 'not_logged_in' : 'cli_error' }); }
    }
    if (url.pathname === '/api/search') {
      const argv = ['find_jobs', 'search', '-p', `query=${q.get('q') || 'automation'}`, '-p', `limit=${Math.min(+q.get('limit') || 8, 10)}`, '--org', 'talent'];
      if (q.get('type')) argv.push('-p', `job_type=${q.get('type')}`);
      if (q.get('experience')) argv.push('-p', `experience_level=${q.get('experience')}`);
      const r = await cli(argv);
      return send(res, 200, { jobs: (r?.jobs || []).map(normJob), hasMore: !!r?.hasMore });
    }
    if (url.pathname === '/api/job') {
      if (!q.get('id')) return send(res, 400, { error: 'id required' });
      // tolerant: one un-fetchable gig returns job:null (200) so a batch run doesn't fail.
      try { return send(res, 200, { job: await deepJob(q.get('id')) }); }
      catch (e) { return send(res, 200, { job: null, error: String(e.message || e).split('\n')[0] }); }
    }
    if (url.pathname === '/api/dashboard') {
      const d = await cli(['get_freelancer_dashboard', 'check', '--org', 'talent']); const dd = d?.data || d; const c = dd?.connects?.balance || {};
      return send(res, 200, {
        connects: { total: num(c.connectsBalance), free: num(c.connectsBalanceFree), paid: num(c.connectsBalancePaid) },
        matchingJobs: num(dd?.matching_jobs?.count), activeContracts: num(dd?.active_contracts?.total_count),
        invitations: num(dd?.invitations?.count), offers: num(dd?.offers?.count), messages: num(dd?.messages?.count),
      });
    }
    if ((url.pathname === '/api/analyze' || url.pathname === '/api/draft') && req.method === 'POST') {
      const body = await readBody(req); const id = q.get('id') || body.id;
      if (!id) return send(res, 400, { error: 'id required' });
      const analyze = url.pathname === '/api/analyze';
      const ctx = await jobContext(id);
      const prompt = analyze
        ? `You are a hard-nosed Upwork strategist. Analyze this job. Output SHORT plain-text sections exactly:\nFIT: <one line>\nWIN_ODDS: <low/medium/high + reason>\nSUGGESTED_BID: <number/range + 1-line rationale>\nRED_FLAGS: <bullets or "none">\nANGLE: <the one hook>\nBe terse and specific to the real numbers.\n\n${ctx}`
        : `You are an expert Upwork freelancer. Write a concise, specific, winning proposal cover letter (max 160 words) for the job below. Reference the client's real spend/history, address any screening, propose a clear first step, sound human. Output ONLY the cover letter.\n\n${ctx}`;
      try { const text = await llmText(prompt); return send(res, 200, analyze ? { analysis: text } : { draft: text }); }
      catch { const j = await deepJob(id).catch(() => ({})); const text = heuristic(analyze ? 'analyze' : 'draft', j); return send(res, 200, analyze ? { analysis: text, llm: 'heuristic' } : { draft: text, llm: 'heuristic' }); }
    }
    return send(res, 404, { error: 'unknown endpoint' });
  } catch (e) { return send(res, 500, { error: String(e.message || e).split('\n')[0] }); }
});
server.listen(PORT, () => console.log(`Upwork MCP → n8n bridge → http://localhost:${PORT}  (LLM_CMD=${LLM_CMD})`));
