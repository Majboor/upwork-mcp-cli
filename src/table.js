// Generic table rendering for list-shaped payloads.

// Known list keys, in the order we prefer to surface them.
const LIST_KEYS = [
  'jobs', 'accounts', 'contracts', 'proposals', 'offers', 'milestones',
  'rooms', 'transactions', 'items', 'invitations', 'freelancers', 'results',
  'postings', 'messages', 'tools',
];

/**
 * Find the most relevant array-of-objects inside a payload.
 * Returns { key, rows } or null.
 */
export function pickList(payload) {
  if (Array.isArray(payload)) return { key: null, rows: payload };
  if (!payload || typeof payload !== 'object') return null;

  // nested under data: {...}
  const scopes = [payload, payload.data].filter((x) => x && typeof x === 'object');
  for (const scope of scopes) {
    for (const key of LIST_KEYS) {
      if (Array.isArray(scope[key]) && scope[key].length && typeof scope[key][0] === 'object') {
        return { key, rows: scope[key] };
      }
    }
    // fall back to any array-of-objects
    for (const [key, val] of Object.entries(scope)) {
      if (Array.isArray(val) && val.length && typeof val[0] === 'object') {
        return { key, rows: val };
      }
    }
  }
  return null;
}

/** Render rows (array of objects) as an aligned text table. */
export function renderTable(rows, { maxCols = 7, maxWidth = 40 } = {}) {
  if (!rows.length) return '(empty)';

  // Column order: keys from the first row with scalar-ish values first.
  const seen = new Set();
  const cols = [];
  for (const row of rows.slice(0, 10)) {
    for (const k of Object.keys(flatten(row))) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  // Prefer scalar columns; drop the noisiest if over budget.
  const scored = cols.map((c) => ({ c, score: scalarScore(c, rows) }));
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored.slice(0, maxCols).map((s) => s.c);

  const flat = rows.map(flatten);
  const widths = {};
  for (const c of chosen) {
    widths[c] = Math.min(
      maxWidth,
      Math.max(c.length, ...flat.map((r) => cell(r[c]).length))
    );
  }

  const line = (vals) => chosen.map((c) => pad(cell(vals[c]), widths[c])).join('  ');
  const header = chosen.map((c) => pad(c, widths[c])).join('  ');
  const rule = chosen.map((c) => '─'.repeat(widths[c])).join('  ');
  const body = flat.map((r) => line(r)).join('\n');
  return `${header}\n${rule}\n${body}\n(${rows.length} rows)`;
}

function scalarScore(col, rows) {
  let s = 0;
  for (const r of rows.slice(0, 10)) {
    const v = flatten(r)[col];
    if (v == null) continue;
    if (typeof v !== 'object') s += 2;
    else s -= 1;
  }
  return s;
}

// One level of flattening: nested objects become dotted keys (one deep).
function flatten(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.entries(v);
      if (inner.length <= 4) {
        for (const [ik, iv] of inner) out[`${k}.${ik}`] = iv;
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 38 ? s.slice(0, 37) + '…' : s;
  }
  return String(v).replace(/<\/?untrusted_participant_content>/g, '').replace(/\s+/g, ' ').trim();
}

function pad(s, w) {
  s = s.length > w ? s.slice(0, w - 1) + '…' : s;
  return s.padEnd(w);
}
