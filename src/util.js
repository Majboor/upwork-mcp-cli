import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

export const SERVER_URL = process.env.UPWORK_MCP_URL || 'https://mcp.upwork.com/mcp';
export const CONFIG_DIR = process.env.UPWORK_CLI_HOME || join(homedir(), '.upwork-cli');

// The Upwork MCP server namespaces every tool as `upwork__<name>` and rejects the bare
// name on tools/call (`invalid tool name …: invalid resource name`). Commands, the manifest,
// and get_tool_help's `tool_name` argument all use the BARE name; only tools/call needs the prefix.
export const SERVER_TOOL_PREFIX = 'upwork__';

/** Strip any server/client namespacing to the canonical bare tool name (idempotent). */
export function bareToolName(name) {
  return name ? name.replace(/^(?:mcp__)?upwork__(?:upwork__)?/, '') : undefined;
}
/** The name tools/call expects on the wire: `upwork__<bare>` (idempotent). */
export function serverToolName(name) {
  const bare = bareToolName(name);
  return bare ? SERVER_TOOL_PREFIX + bare : undefined;
}

export function ensureDir() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function file(name) {
  return join(CONFIG_DIR, name);
}

export function readJSON(name) {
  const p = file(name);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeJSON(name, data) {
  ensureDir();
  writeFileSync(file(name), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function readText(name) {
  const p = file(name);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
}

export function writeText(name, data) {
  ensureDir();
  writeFileSync(file(name), data, { mode: 0o600 });
}

export function removeFile(name) {
  const p = file(name);
  if (existsSync(p)) rmSync(p);
}

// ---- config (default org + cached accounts) ----
export function getConfig() {
  return readJSON('config.json') || {};
}
export function setConfig(patch) {
  writeJSON('config.json', { ...getConfig(), ...patch });
}

/**
 * Resolve an --org value: an org_uid, or an alias ("talent"/"freelancer"/"client"/"agency"),
 * or fall back to the stored default. Returns the org_uid string or undefined.
 */
export function resolveOrg(input) {
  const cfg = getConfig();
  const val = input || process.env.UPWORK_ORG || cfg.defaultOrg;
  if (!val) return undefined;
  if (/^\d+$/.test(val)) return val; // already a uid
  const accounts = cfg.accounts || [];
  const key = String(val).toLowerCase();
  const roleMap = { freelancer: 'TALENT', talent: 'TALENT', client: 'CLIENT', agency: 'AGENCY' };
  const wantRole = roleMap[key];
  const hit = accounts.find(
    (a) =>
      a.org_uid === val ||
      (a.role_label && a.role_label.toLowerCase() === key) ||
      (wantRole && a.role === wantRole)
  );
  return hit ? hit.org_uid : val;
}

// ---- tiny argv parser ----
// Splits argv into { positionals, opts, args (-a k=v -> top level), params (-p k=v -> params) }
export function parseArgs(argv) {
  const positionals = [];
  const opts = {};
  const args = {};
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '-a' || tok === '--arg') {
      assignKV(args, argv[++i]);
    } else if (tok === '-p' || tok === '--param') {
      assignKV(params, argv[++i]);
    } else if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq !== -1) {
        opts[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) opts[tok.slice(2)] = true;
        else opts[tok.slice(2)] = argv[++i];
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, opts, args, params };
}

function assignKV(target, kv) {
  if (!kv) return;
  const eq = kv.indexOf('=');
  if (eq === -1) {
    target[kv] = true;
    return;
  }
  const key = kv.slice(0, eq);
  const raw = kv.slice(eq + 1);
  target[key] = coerce(raw);
}

function coerce(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && !isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const t = raw.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      /* fall through to string */
    }
  }
  return raw;
}

export function print(obj, { raw = false } = {}) {
  if (typeof obj === 'string') {
    process.stdout.write(obj.endsWith('\n') ? obj : obj + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

export function fail(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

/** Depth-first search for the first value under `key` anywhere in a nested object/array. */
export function deepFind(obj, key) {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (!Array.isArray(obj) && key in obj && obj[key] != null) return obj[key];
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) {
    const hit = deepFind(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Collect every value under `key` anywhere in a nested structure (deduped, in order). */
export function deepCollect(obj, key, out = []) {
  if (obj == null || typeof obj !== 'object') return out;
  if (!Array.isArray(obj) && obj[key] != null) {
    const v = obj[key];
    (Array.isArray(v) ? v : [v]).forEach((x) => {
      if (!out.includes(x)) out.push(x);
    });
  }
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) deepCollect(v, key, out);
  return out;
}
