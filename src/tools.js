import { readJSON, writeJSON, bareToolName } from './util.js';

const CACHE = 'tools.json';

/** Fetch tools live from the server and cache them to disk. */
export async function fetchTools(client) {
  const { tools } = await client.listTools();
  writeJSON(CACHE, { fetchedAt: new Date().toISOString(), tools });
  return tools;
}

/** Read the cached tool list (may be stale / empty). */
export function cachedTools() {
  const c = readJSON(CACHE);
  return c?.tools || [];
}

export function findTool(tools, name) {
  // Server tool names are namespaced (`upwork__<name>`); match on the bare name either way.
  const bare = bareToolName(name);
  return tools.find((t) => t.name === name || bareToolName(t.name) === bare);
}

/** Action enum values declared in a tool's input schema. */
export function actionEnum(tool) {
  return tool?.inputSchema?.properties?.action?.enum || [];
}

/**
 * Parse the "Actions:" section of a tool description into [{name, blurb}].
 * Descriptions look like:  "Actions:\n- search: Search for jobs ...\n- get: ..."
 */
export function parseActions(tool) {
  const desc = tool?.description || '';
  const out = [];
  const re = /^-\s+([a-z_][a-z0-9_]*):\s*(.*)$/gim;
  let m;
  while ((m = re.exec(desc))) {
    out.push({ name: m[1], blurb: oneLine(m[2]) });
  }
  return out;
}

/** The short summary line for a tool (first non-empty line of its description). */
export function toolSummary(tool) {
  const first = (tool?.description || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return oneLine(first);
}

function oneLine(s, max = 100) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
