#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { connect, login } from '../src/mcp.js';
import { parseArgs, print, fail, resolveOrg, setConfig, getConfig, removeFile, deepFind, bareToolName, serverToolName } from '../src/util.js';
import { fetchTools, cachedTools, findTool, actionEnum, parseActions, toolSummary } from '../src/tools.js';
import { pickList, renderTable } from '../src/table.js';
import { uploadAttachments, UPLOAD_CONTEXTS } from '../src/upload.js';
import {
  loadManifest, toolSpec, actionSpec, missingRequired, confirmTypeFor,
  renderManifestToolHelp, renderActionHelp,
} from '../src/manifest.js';

const GENERAL_HELP = `upwork — CLI over the Upwork MCP server (every tool, action & flow)

Auth:
  upwork login                     Authorize with Upwork (OAuth 2.1, opens browser)
  upwork logout                    Delete stored tokens & client registration
  upwork whoami | accounts         Cached accounts / default org

Discovery:
  upwork commands [--json]         Every tool + its actions
  upwork tools [--json]            One line per tool
  upwork <tool>                    A tool's actions
  upwork <tool> <action> --help    Full params for one action (typed)
  upwork describe <tool>           Raw input schema
  upwork help <tool>               Authoritative server reference
  upwork refresh                   Re-fetch & cache the tool list

Run anything (reads + writes):
  upwork <tool> <action> [opts]    e.g. upwork find_jobs search -p query=ghl
  upwork call <tool> [opts]        Explicit form (action via -a action=...)

Write flows:
  ... --confirm                    Auto-execute a returned draft (confirm_draft)
  upwork confirm <type> <draft_id> Confirm a draft you created earlier
  upwork upload <file...> --context <ctx> [--room <id>]
                                   Headless attachment upload (start→store→confirm)
                                   ctx: ${UPLOAD_CONTEXTS.join(' | ')}

Options:
  -a key=value   top-level arg (action, org_uid, flat tools)
  -p key=value   nested params.<key>
  --json '<json>'  full arguments object (merged first)
  --org <uid|talent|client|agency>   account (auto-injected when a tool needs it)
  --table          render list results as a table
  --raw            full MCP result envelope
  --no-confirm     (upload) skip the final confirm step

Config: ~/.upwork-cli (UPWORK_CLI_HOME) · Server: UPWORK_MCP_URL`;

const BUILTINS = new Set([
  'login', 'logout', 'accounts', 'whoami', 'tools', 'commands', 'describe',
  'help', 'refresh', 'call', 'resources', 'read', 'upload', 'confirm', '-h', '--help',
]);

// Structural (tool:action) -> confirm_draft `type`, covering the full confirm_draft enum.
// update_profile:* -> profile_* and boost_profile handled by rule in resolveConfirmType().
const CONFIRM_TYPE = {
  'post_job:create': 'job_posting', 'post_job:update': 'job_update',
  'manage_proposals:create': 'proposal', 'manage_proposals:send_proposal': 'contract_proposal',
  'manage_proposals:accept_invitation': 'proposal_accept_invitation',
  'manage_proposals:decline_invitation': 'proposal_decline_invitation',
  'manage_proposals:withdraw': 'proposal_withdraw', 'manage_proposals:edit_terms': 'proposal_edit_terms',
  'manage_client_proposals:decline': 'proposal_decline',
  'manage_milestones:create': 'milestone_create', 'manage_milestones:edit': 'milestone_edit',
  'manage_milestones:delete': 'milestone_delete', 'manage_milestones:reject': 'milestone_reject',
  'submit_milestones:submit': 'milestone_submit',
  'invite_freelancer:send': 'invitation',
  'respond_to_offer:decline': 'offer_decline', 'respond_to_offer:request_changes': 'offer_request_changes',
  'manage_offers:decline': 'offer_decline', 'manage_offers:request_changes': 'offer_request_changes',
  'update_contract:pause': 'contract_pause', 'update_contract:restart': 'contract_restart',
  'end_contract:end': 'contract_end',
  'boost_profile:toggle_availability_badge': 'availability_badge_toggle',
  'boost_profile:create_profile_boost': 'profile_boost_create',
  'boost_profile:manage_profile_boost': 'profile_boost_manage',
};

/** Resolve the confirm_draft `type` for a completed write, most-authoritative first. */
function resolveConfirmType(spec, toolName, action, payload) {
  return (
    confirmTypeFor(spec, action) ||                        // parsed from manifest description
    deepFind(payload, 'draft_type') || deepFind(payload, 'type') || // echoed by the server
    CONFIRM_TYPE[`${toolName}:${action}`] ||               // structural map
    (toolName === 'update_profile' ? `profile_${action}` : undefined) // profile_* convention
  );
}

async function main() {
  const { positionals, opts, args, params } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (!cmd || cmd === '-h' || cmd === '--help') return print(GENERAL_HELP);

  // ---- no connection needed ----
  if (cmd === 'login') {
    const { client, transport } = await login();
    await refreshAll(client);
    print('\nLogged in ✓  Tokens stored in ~/.upwork-cli');
    return close(transport);
  }
  if (cmd === 'logout') {
    for (const f of ['tokens.json', 'client.json', 'verifier.txt']) removeFile(f);
    return print('Logged out ✓');
  }
  if (cmd === 'whoami') {
    const cfg = getConfig();
    return print({ defaultOrg: cfg.defaultOrg, accounts: cfg.accounts || [] });
  }
  if (cmd === 'help' && !positionals[1]) return print(GENERAL_HELP);

  // Offline help via manifest/cache
  if (cmd === 'commands' && (loadManifest() || cachedTools().length)) {
    return print(renderCommands(cachedTools(), opts));
  }
  // Offline typed help (no login needed) for `<tool> [<action>] --help` and bare `<tool>`.
  if (!BUILTINS.has(cmd)) {
    const spec = toolSpec(resolveToolName(cmd));
    if (opts.help && spec) {
      const action = (positionals[1] && spec.actions?.some((a) => a.name === positionals[1]) ? positionals[1] : undefined) || args.action;
      return print(action ? renderActionHelp(spec, action) : renderManifestToolHelp(spec));
    }
    if (!positionals[1] && !('action' in args) && !opts.json && !opts.help) {
      if (spec) return print(renderManifestToolHelp(spec));
      const t = findTool(cachedTools(), resolveToolName(cmd));
      if (t) return print(renderToolHelpLive(t));
    }
  }

  // ---- pre-connection argument validation (clean errors without a login round-trip) ----
  if (cmd === 'upload') {
    const files = positionals.slice(1);
    if (!files.length) return fail('usage: upwork upload <file...> --context <ctx> [--room <id>] [--org ...]');
    const context = opts.context || opts.ctx;
    if (!context) return fail(`--context required (${UPLOAD_CONTEXTS.join(' | ')})`);
    if (!UPLOAD_CONTEXTS.includes(context)) return fail(`--context must be one of: ${UPLOAD_CONTEXTS.join(', ')}`);
    if (context === 'messages' && !(opts.room || opts.room_id)) return fail('context "messages" requires --room <room_id>');
    for (const f of files) if (!existsSync(f)) return fail(`file not found: ${f}`);
  }
  if (cmd === 'confirm' && (!positionals[1] || !(positionals[2] || opts.draft_id))) {
    return fail('usage: upwork confirm <type> <draft_id>   (types: see `upwork help confirm_draft`)');
  }

  // ---- needs connection ----
  const { client, transport } = await connectOrHint();
  try {
    const tools = await fetchTools(client);

    if (cmd === 'accounts') return print(await refreshAccounts(client));
    if (cmd === 'refresh') return print(`Cached ${tools.length} tools ✓`);
    if (cmd === 'commands') return print(renderCommands(tools, opts));
    if (cmd === 'tools') {
      return print(opts.json ? tools : `${tools.length} tools:\n` + tools.map((t) => `  ${t.name.padEnd(30)} ${toolSummary(t)}`).join('\n'));
    }
    if (cmd === 'describe') {
      const tool = findTool(tools, resolveToolName(positionals[1]));
      if (!tool) return fail(`unknown tool: ${positionals[1]}`);
      return print(opts.json ? tool : `${tool.name}\n\n${tool.description || ''}\n\nInput schema:\n${JSON.stringify(tool.inputSchema, null, 2)}`);
    }
    if (cmd === 'help') {
      const name = resolveToolName(positionals[1]);
      const r = await client.callTool({ name: serverToolName('get_tool_help'), arguments: { tool_name: name } });
      return print(unwrap(r));
    }
    if (cmd === 'resources') {
      const res = await client.listResources().catch(() => ({ resources: [] }));
      return print(opts.json ? res.resources : (res.resources.map((r) => `  ${r.uri}  ${r.name || ''}`).join('\n') || '(none)'));
    }
    if (cmd === 'read') {
      if (!positionals[1]) return fail('usage: upwork read <uri>');
      return print(await client.readResource({ uri: positionals[1] }));
    }

    // ---- orchestrated: upload ----
    if (cmd === 'upload') {
      const files = positionals.slice(1);
      if (!files.length) return fail('usage: upwork upload <file...> --context <ctx> [--room <id>] [--org ...]');
      const context = opts.context || opts.ctx;
      if (!context) return fail(`--context required (${UPLOAD_CONTEXTS.join(' | ')})`);
      const org = resolveOrg(opts.org);
      if (!org) return fail('need an org — pass --org <uid|talent|client>');
      const res = await uploadAttachments({
        client, files, context, org, roomId: opts.room || opts.room_id,
        confirm: !opts['no-confirm'], unwrap, log: (m) => process.stderr.write(`  · ${m}\n`),
      });
      return print(opts.raw ? res : { task_id: res.task_id, file_ids: res.file_ids, fallback_url: res.fallback_url, confirmed: !!res.steps.confirm });
    }

    // ---- orchestrated: confirm a draft directly ----
    if (cmd === 'confirm') {
      const type = positionals[1];
      const draft_id = positionals[2] || opts.draft_id;
      if (!type || !draft_id) return fail('usage: upwork confirm <type> <draft_id>');
      const org = resolveOrg(opts.org);
      const r = await client.callTool({ name: serverToolName('confirm_draft'), arguments: { action: 'confirm', org_uid: org, params: { type, draft_id } } });
      render(unwrap(r), opts, r);
      if (r.isError) process.exitCode = 2;
      return;
    }

    // ---- call / shorthand: invoke any tool ----
    let toolName, actionPos;
    if (cmd === 'call') { toolName = resolveToolName(positionals[1]); actionPos = positionals[2]; }
    else { toolName = resolveToolName(cmd); actionPos = positionals[1]; }
    if (!toolName) return fail('no tool specified (try: upwork commands)');

    const tool = findTool(tools, toolName);
    if (!tool) return fail(`unknown command/tool: ${toolName}\nRun \`upwork commands\` to see them all.`);
    const spec = toolSpec(toolName);
    const actions = actionEnum(tool);

    let action;
    if (actionPos && actions.includes(actionPos)) action = actionPos;
    const jsonArgs = opts.json ? safeJson(opts.json) : undefined;
    if (opts.json && jsonArgs === undefined) return fail('--json is not valid JSON');
    const hasActionArg = 'action' in args || jsonArgs?.action;
    action = action || args.action || jsonArgs?.action;

    // per-action / per-tool typed help
    if (opts.help) {
      if (action && spec) return print(renderActionHelp(spec, action));
      if (spec) return print(renderManifestToolHelp(spec));
      return print(renderToolHelpLive(tool));
    }

    // discoverable: `upwork <tool>` with no action -> help
    if (!action && !hasActionArg && actions.length) {
      return print(spec ? renderManifestToolHelp(spec) : renderToolHelpLive(tool));
    }

    const toolArgs = buildArgs({ jsonArgs, args, params, action });
    injectOrg(tool, toolArgs, opts);

    // typed validation from the manifest (skip if no spec)
    if (spec && action) {
      const missing = missingRequired(spec, action, toolArgs, toolArgs.params || {});
      if (missing.length) {
        process.stderr.write(`missing required: ${missing.map((p) => p.name).join(', ')}\n\n`);
        return fail(renderActionHelp(spec, action), 1);
      }
    }

    const result = await client.callTool({ name: serverToolName(toolName), arguments: toolArgs });
    const payload = unwrap(result);

    // draft → confirm chaining
    if (opts.confirm) {
      const draft_id = deepFind(payload, 'draft_id');
      if (!draft_id) {
        render(payload, opts, result);
        return; // nothing to confirm
      }
      render(payload, opts, result);
      const type = resolveConfirmType(spec, toolName, action, payload);
      if (!type) {
        return fail(`draft ${draft_id} created, but could not infer confirm type. Run: upwork confirm <type> ${draft_id}`);
      }
      process.stderr.write(`\nconfirming draft (type=${type})…\n`);
      const cr = await client.callTool({ name: serverToolName('confirm_draft'), arguments: { action: 'confirm', org_uid: toolArgs.org_uid, params: { type, draft_id } } });
      render(unwrap(cr), opts, cr);
      if (cr.isError) process.exitCode = 2;
      return;
    }

    render(payload, opts, result);
    if (result.isError) process.exitCode = 2;
  } finally {
    await close(transport);
  }
}

// ---- rendering ----
function render(payload, opts, result) {
  if (opts.raw) return print(result);
  if (opts.table) {
    const list = pickList(payload);
    if (list) return print((list.key ? `${list.key}:\n` : '') + renderTable(list.rows));
  }
  print(payload);
}

function renderCommands(liveTools, opts) {
  const m = loadManifest();
  if (m?.tools?.length) {
    if (opts.json) return m.tools.map((t) => ({ tool: t.name, write: !!t.write, actions: (t.actions || []).map((a) => a.name), summary: t.summary }));
    return `${m.tools.length} tools (typed manifest)\n\n` + m.tools.map((t) => {
      const flag = t.write ? (t.returns_draft ? ' [write·draft]' : ' [write]') : '';
      const acts = (t.actions || []).map((a) => {
        const req = (a.params || []).filter((p) => p.required && p.name !== 'action' && p.name !== 'org_uid').map((p) => p.name);
        return `      ${a.name.padEnd(22)} ${a.description || ''}${req.length ? '  (needs: ' + req.join(', ') + ')' : ''}`;
      }).join('\n');
      return `  ${t.name}${flag}\n${acts || '      (no actions)'}`;
    }).join('\n\n');
  }
  // fallback: live schema only
  if (opts.json) return liveTools.map((t) => ({ tool: t.name, actions: actionEnum(t), summary: toolSummary(t) }));
  return `${liveTools.length} tools\n\n` + liveTools.map((t) => {
    const acts = parseActions(t); const names = actionEnum(t);
    const body = names.length ? names.map((n) => { const b = acts.find((a) => a.name === n); return `      ${n.padEnd(20)} ${b ? b.blurb : ''}`; }).join('\n') : '      (no actions)';
    return `  ${t.name}\n${body}`;
  }).join('\n\n');
}

function renderToolHelpLive(tool) {
  const acts = parseActions(tool); const names = actionEnum(tool);
  const list = names.length ? '\nActions:\n' + names.map((n) => { const b = acts.find((a) => a.name === n); return `  ${n.padEnd(20)} ${b ? b.blurb : ''}`; }).join('\n') : '';
  return `${tool.name} — ${toolSummary(tool)}\n\nUsage: upwork ${tool.name} <action> [-p key=value ...]\n${list}\n\nParams: upwork help ${tool.name}  ·  upwork describe ${tool.name}`;
}

// ---- args ----
function buildArgs({ jsonArgs, args, params, action }) {
  let base = jsonArgs && typeof jsonArgs === 'object' ? jsonArgs : {};
  const merged = { ...base, ...args };
  if (action && !merged.action) merged.action = action;
  if (Object.keys(params).length) merged.params = { ...(merged.params || {}), ...params };
  return merged;
}
function injectOrg(tool, toolArgs, opts) {
  const props = tool.inputSchema?.properties || {};
  if (props.org_uid && !toolArgs.org_uid) {
    const org = resolveOrg(opts.org);
    if (!org) fail('this tool needs an org. Pass --org <uid|talent|client> or run `upwork accounts` first.');
    toolArgs.org_uid = org;
  }
}

// ---- helpers ----
function resolveToolName(name) { return bareToolName(name); }
function safeJson(s) { try { return JSON.parse(s); } catch { return undefined; } }
function unwrap(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const texts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  if (texts.length === 1) { try { return JSON.parse(texts[0]); } catch { return texts[0]; } }
  if (texts.length > 1) return texts.map((t) => { try { return JSON.parse(t); } catch { return t; } });
  return result.content ?? result;
}
async function connectOrHint() {
  try { return await connect(); } catch (e) { return fail(`${e.message || e}\nRun \`upwork login\` first.`); }
}
async function refreshAll(client) { await refreshAccounts(client); await fetchTools(client); }
async function refreshAccounts(client) {
  const data = unwrap(await client.callTool({ name: serverToolName('list_accounts'), arguments: {} }));
  const accounts = data.accounts || [];
  const cfg = getConfig();
  const patch = { accounts };
  if (!cfg.defaultOrg && accounts.length) { const t = accounts.find((a) => a.role === 'TALENT'); patch.defaultOrg = (t || accounts[0]).org_uid; }
  setConfig(patch);
  return accounts;
}
async function close(transport) { try { await transport.close(); } catch { /* ignore */ } }

main().catch((e) => fail(e?.stack || e?.message || String(e)));
