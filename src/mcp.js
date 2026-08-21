import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { FileOAuthProvider, openBrowser } from './provider.js';
import { SERVER_URL } from './util.js';

const CLIENT_INFO = { name: 'upwork-cli', version: '0.1.0' };

/**
 * Connect using existing tokens. Auto-refreshes via the provider.
 * Throws UnauthorizedError if there are no valid credentials (caller should tell user to log in).
 */
export async function connect() {
  const provider = new FileOAuthProvider({ redirectUrl: 'http://127.0.0.1:0/callback' });
  if (!provider.tokens()) {
    throw new UnauthorizedError('not logged in — run `upwork login`');
  }
  const client = new Client(CLIENT_INFO);
  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), { authProvider: provider });
  await client.connect(transport);
  return { client, transport };
}

/**
 * Interactive login: spins up a loopback server, runs the OAuth 2.1 + DCR flow,
 * opens the browser, and persists tokens. Returns a connected client.
 */
export async function login() {
  const { server, port, waitForCode } = await startCallbackServer();
  const redirectUrl = `http://127.0.0.1:${port}/callback`;

  const provider = new FileOAuthProvider({
    redirectUrl,
    onAuthorize: (url) => {
      process.stderr.write('\nOpening your browser to authorize with Upwork…\n');
      process.stderr.write('If it does not open, paste this URL:\n  ' + url + '\n\n');
      openBrowser(url);
    },
  });

  const client = new Client(CLIENT_INFO);
  let transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), { authProvider: provider });

  try {
    await client.connect(transport);
    // Already had valid tokens.
    server.close();
    return { client, transport };
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      server.close();
      throw err;
    }
  }

  // Wait for the browser redirect to deliver the authorization code.
  const code = await waitForCode();
  server.close();

  await transport.finishAuth(code);

  // Reconnect with the freshly minted tokens.
  const client2 = new Client(CLIENT_INFO);
  const transport2 = new StreamableHTTPClientTransport(new URL(SERVER_URL), { authProvider: provider });
  await client2.connect(transport2);
  return { client: client2, transport: transport2 };
}

function startCallbackServer() {
  return new Promise((resolve) => {
    let resolveCode, rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end('not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      if (error) {
        res.end(page('Authorization failed', `Upwork returned: ${escapeHtml(error)}. You can close this tab.`));
        rejectCode(new Error(`authorization error: ${error}`));
      } else if (code) {
        res.end(page('Authorized ✓', 'You are logged in to Upwork. You can close this tab and return to the terminal.'));
        resolveCode(code);
      } else {
        res.end(page('Waiting…', 'No authorization code received.'));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, waitForCode: () => codePromise });
    });
  });
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<div style="font:16px -apple-system,system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px">
<h1 style="font-size:22px">${title}</h1><p style="color:#444">${body}</p></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
