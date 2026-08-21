import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', 'manifest.json');

let _cache;

/** Load the bundled typed manifest (produced by the harvest wave). Returns { tools } or null. */
export function loadManifest() {
  if (_cache !== undefined) return _cache;
  try {
    if (existsSync(MANIFEST_PATH)) {
      _cache = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } else {
      _cache = null;
    }
  } catch {
    _cache = null;
  }
  return _cache;
}

export function toolSpec(name) {
  const m = loadManifest();
  return m?.tools?.find((t) => t.name === name) || null;
}

export function actionSpec(spec, action) {
  if (!spec) return null;
  return spec.actions?.find((a) => a.name === action) || null;
}

/** Params for an action split into { required, optional }. */
/**
 * The confirm_draft `type` for a (tool, action), parsed from the harvested
 * action description (which embeds e.g. "confirm with confirm_draft type='proposal'").
 * Authoritative and self-updating from the manifest. Returns undefined if not found.
 */
export function confirmTypeFor(spec, action) {
  const a = actionSpec(spec, action);
  const d = a?.description || '';
  const m = d.match(/type\s*=\s*['"]([a-z_]+)['"]/i);
  return m ? m[1] : undefined;
}

export function actionParams(spec, action) {
  const a = actionSpec(spec, action);
  const params = a?.params || [];
  return {
    required: params.filter((p) => p.required),
    optional: params.filter((p) => !p.required),
    all: params,
  };
}

/**
 * Validate that all required (nested) params are present for an action.
 * `provided` is the params object (what the user supplied via -p / --json.params).
 * Returns array of missing param names (empty = ok). Top-level params (action, org_uid)
 * are handled elsewhere, so only nested-required ones are checked here.
 */
export function missingRequired(spec, action, providedTop = {}, providedParams = {}) {
  const a = actionSpec(spec, action);
  if (!a) return [];
  const missing = [];
  for (const p of a.params || []) {
    if (!p.required) continue;
    if (p.name === 'action' || p.name === 'org_uid') continue; // injected/handled
    const bag = p.nested === false ? providedTop : providedParams;
    if (bag[p.name] === undefined) missing.push(p);
  }
  return missing;
}

export function renderManifestToolHelp(spec) {
  const flag = spec.write ? (spec.returns_draft ? '  [write · draft→confirm]' : '  [write]') : '';
  const head = `${spec.name} — ${spec.summary}${flag}\n`;
  const usage = `\nUsage: upwork ${spec.name} <action> [-p key=value ...] [--org talent|client]\n`;
  const actions = (spec.actions || [])
    .map((a) => {
      const req = (a.params || []).filter((p) => p.required && p.name !== 'action' && p.name !== 'org_uid');
      const reqStr = req.length ? '  (needs: ' + req.map((p) => p.name).join(', ') + ')' : '';
      return `  ${a.name.padEnd(22)} ${a.description || ''}${reqStr}`;
    })
    .join('\n');
  const tip = `\n\nParam detail for one action:  upwork ${spec.name} <action> --help`;
  return `${head}${usage}\nActions:\n${actions}${tip}`;
}

export function renderActionHelp(spec, action) {
  const a = actionSpec(spec, action);
  if (!a) return `no such action "${action}" on ${spec.name}. Actions: ${(spec.actions || []).map((x) => x.name).join(', ')}`;
  const flag = spec.write ? (spec.returns_draft ? '  [write · returns draft → confirm_draft]' : '  [write]') : '';
  const lines = [`${spec.name} ${a.name}${flag}`, a.description ? `\n${a.description}` : ''];
  const params = (a.params || []).filter((p) => p.name !== 'action' && p.name !== 'org_uid');
  if (!params.length) {
    lines.push('\n(no parameters besides action/org_uid)');
  } else {
    lines.push('\nParameters:');
    for (const p of params) {
      const bits = [
        p.required ? 'required' : 'optional',
        p.type || '',
        p.nested === false ? 'top-level' : '',
        p.enum?.length ? `enum: ${p.enum.join('|')}` : '',
      ].filter(Boolean).join(', ');
      const flagName = p.nested === false ? `-a ${p.name}` : `-p ${p.name}`;
      lines.push(`  ${flagName.padEnd(26)} ${bits}\n      ${p.description || ''}`.trimEnd());
    }
  }
  const ex = params.filter((p) => p.required && p.name !== 'action' && p.name !== 'org_uid')
    .map((p) => (p.nested === false ? `-a ${p.name}=…` : `-p ${p.name}=…`))
    .join(' ');
  lines.push(`\nExample:\n  upwork ${spec.name} ${a.name} ${ex}`.trimEnd());
  if (spec.returns_draft) lines.push(`\nThen confirm:\n  upwork ${spec.name} ${a.name} … --confirm   (or: upwork confirm <type> <draft_id>)`);
  return lines.filter(Boolean).join('\n');
}
