import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { deepFind, deepCollect, serverToolName } from './util.js';

export const UPLOAD_CONTEXTS = ['messages', 'proposals', 'offer', 'milestones', 'job', 'invitation'];
const MAX_INLINE = 7 * 1024 * 1024; // store_uploaded_files (inline path) limit

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function mimeOf(name) {
  return MIME[extname(name).toLowerCase()] || 'application/octet-stream';
}

async function callUnwrapped(client, name, args, unwrap) {
  return unwrap(await client.callTool({ name: serverToolName(name), arguments: args }));
}

/**
 * Headless attachment upload: start -> store bytes (base64) -> poll status -> confirm.
 * Returns { task_id, file_ids, fallback_url, steps } for full transparency.
 *
 * @param {object} o
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} o.client
 * @param {string[]} o.files       local file paths
 * @param {string}   o.context     one of UPLOAD_CONTEXTS
 * @param {string}   o.org         org_uid
 * @param {string}   [o.roomId]    required when context === 'messages'
 * @param {boolean}  [o.confirm=true]  run confirm_attachment_upload at the end
 * @param {(name,args)=>Promise<any>} o.unwrap  result-unwrapping helper from bin
 * @param {(m:string)=>void} [o.log]
 */
export async function uploadAttachments({ client, files, context, org, roomId, confirm = true, unwrap, log = () => {} }) {
  if (!UPLOAD_CONTEXTS.includes(context)) {
    throw new Error(`--context must be one of: ${UPLOAD_CONTEXTS.join(', ')}`);
  }
  if (context === 'messages' && !roomId) {
    throw new Error('context "messages" requires --room <room_id>');
  }

  const payloads = files.map((f) => {
    const bytes = readFileSync(f);
    if (bytes.length > MAX_INLINE) {
      throw new Error(
        `${basename(f)} is ${(bytes.length / 1048576).toFixed(1)} MB — over the ${MAX_INLINE / 1048576} MB inline limit. ` +
          `Use the fallback_url from start_attachment_upload in a browser for large files.`
      );
    }
    const name = basename(f);
    return { name, data: bytes.toString('base64'), size: bytes.length, type: mimeOf(name) };
  });

  const steps = {};

  // 1) start upload session
  log(`start_attachment_upload (context=${context})…`);
  const startArgs = { action: 'upload', org_uid: org, params: { context, ...(roomId ? { room_id: roomId } : {}) } };
  steps.start = await callUnwrapped(client, 'start_attachment_upload', startArgs, unwrap);
  const task_id = deepFind(steps.start, 'task_id');
  const fallback_url = deepFind(steps.start, 'fallback_url');
  if (!task_id) throw new Error('no task_id returned from start_attachment_upload');

  // 2) push bytes (inline)
  log(`store_uploaded_files (${payloads.length} file${payloads.length > 1 ? 's' : ''})…`);
  steps.store = await callUnwrapped(client, 'store_uploaded_files', { task_id, org_uid: org, files: payloads }, unwrap);

  // 3) resolve file_uid values
  log('get_upload_status…');
  steps.status = await callUnwrapped(client, 'get_upload_status', { action: 'get', org_uid: org, params: { task_id } }, unwrap);
  let file_ids = deepCollect(steps.status, 'file_uid');
  if (!file_ids.length) file_ids = deepCollect(steps.store, 'file_uid');

  // 4) confirm retention
  if (confirm && file_ids.length) {
    log(`confirm_attachment_upload (${file_ids.length} file_uid)…`);
    steps.confirm = await callUnwrapped(
      client,
      'confirm_attachment_upload',
      { action: 'confirm', org_uid: org, params: { context, file_ids, ...(roomId ? { room_id: roomId } : {}) } },
      unwrap
    );
  }

  return { task_id, file_ids, fallback_url, steps };
}
