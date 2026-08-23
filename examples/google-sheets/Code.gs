/**
 * Code.gs — Google Apps Script alternative to sheets-sync.py.
 *
 * Same job: sync Upwork jobs (via the official Upwork MCP) into this
 * spreadsheet, deduped by id, on a time-driven trigger. No Python, no
 * service account — just Apps Script bound to (or opened from) the sheet.
 *
 * IT NEEDS A PUBLIC URL. Apps Script runs on Google's servers, not on your
 * machine, so it can't reach http://localhost:4178 directly. This example
 * calls the local Upwork MCP → n8n bridge (examples/n8n/bridge.mjs), so you
 * must expose that bridge's port 4178 via a tunnel (e.g. `ngrok http 4178`,
 * or Cloudflare Tunnel) and point BRIDGE_URL below at the public tunnel URL
 * — NOT at localhost.
 *
 * Setup:
 *   1. From the repo root: `node bin/upwork.js login` then
 *      `node examples/n8n/bridge.mjs` (defaults to :4178).
 *   2. Expose it publicly, e.g.: `ngrok http 4178`
 *      → copy the https://xxxx.ngrok-free.app URL it prints.
 *   3. Open (or create) a Google Sheet → Extensions → Apps Script.
 *   4. Paste this file in as Code.gs, set BRIDGE_URL below to your tunnel URL.
 *   5. Run `setupTrigger` once (Apps Script will ask you to authorize it).
 *   6. Optionally run `syncUpworkJobs` once by hand to confirm it works.
 *
 * The bridge itself never needs Google credentials — Apps Script's built-in
 * SpreadsheetApp identity is all the auth this side needs. Keep BRIDGE_URL
 * out of source control if it's a private/paid tunnel; a free ngrok URL
 * changes every restart, so re-run step 2/4 when it does.
 */

// ---- config -----------------------------------------------------------
const BRIDGE_URL = 'https://YOUR-TUNNEL-URL.example.com'; // e.g. an ngrok https URL, NO trailing slash
const SEARCH_QUERY = 'react developer';
const SEARCH_LIMIT = 10;
const SHEET_NAME = 'Sheet1';
const HEADER = ['id', 'title', 'budget', 'proposals', 'country', 'skills', 'date'];

/** Entry point for the time-driven trigger (and for a manual test run). */
function syncUpworkJobs() {
  const sheet = getOrCreateSheet_();
  const jobs = fetchJobs_(SEARCH_QUERY, SEARCH_LIMIT);
  if (!jobs.length) {
    Logger.log('No jobs returned for query "%s".', SEARCH_QUERY);
    return;
  }

  const seen = existingIds_(sheet);
  const newRows = jobs
    .filter(function (j) { return !seen.has(String(j.id)); })
    .map(jobToRow_);

  if (!newRows.length) {
    Logger.log('Fetched %s job(s); all already in the sheet.', jobs.length);
    return;
  }

  sheet
    .getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADER.length)
    .setValues(newRows);
  Logger.log('Appended %s new job(s) of %s fetched.', newRows.length, jobs.length);
}

/** Calls the bridge's GET /api/search — see examples/n8n/bridge.mjs. */
function fetchJobs_(query, limit) {
  const url = BRIDGE_URL + '/api/search?q=' + encodeURIComponent(query) + '&limit=' + limit;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Bridge request failed (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  const data = JSON.parse(resp.getContentText());
  return data.jobs || [];
}

function jobToRow_(job) {
  const skills = Array.isArray(job.skills) ? job.skills.join(', ') : (job.skills || '');
  return [
    String(job.id || ''), // ids are strings — never coerce to a Number
    job.title || job.snippet || '',
    job.budget || '',
    job.proposal_count != null ? job.proposal_count : '',
    (job.client && job.client.country) || '',
    skills,
    Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'),
  ];
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  }
  return sheet;
}

/** Column A holds job ids; row 1 is the header. */
function existingIds_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); });
  return new Set(ids);
}

/** Run this once to install an hourly time-driven trigger for syncUpworkJobs. */
function setupTrigger() {
  ScriptTriggers_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncUpworkJobs').timeBased().everyHours(1).create();
  Logger.log('Installed hourly trigger for syncUpworkJobs.');
}

function ScriptTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'syncUpworkJobs';
  });
}
