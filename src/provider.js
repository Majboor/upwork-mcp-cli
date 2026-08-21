import { readJSON, writeJSON, readText, writeText, removeFile } from './util.js';
import { exec } from 'node:child_process';

/**
 * File-backed OAuth 2.1 client provider for the MCP SDK.
 * Persists dynamic-client-registration info, tokens, and the PKCE verifier
 * under the CLI config dir so login survives across invocations.
 */
export class FileOAuthProvider {
  /**
   * @param {object} o
   * @param {string} o.redirectUrl  loopback callback URL, e.g. http://127.0.0.1:PORT/callback
   * @param {(url: URL) => void} [o.onAuthorize]  called with the authorization URL (interactive login)
   */
  constructor({ redirectUrl, onAuthorize } = {}) {
    this._redirectUrl = redirectUrl;
    this._onAuthorize = onAuthorize;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return {
      client_name: 'upwork-cli',
      redirect_uris: [this._redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  clientInformation() {
    return readJSON('client.json');
  }
  saveClientInformation(info) {
    writeJSON('client.json', info);
  }

  tokens() {
    return readJSON('tokens.json');
  }
  saveTokens(tokens) {
    writeJSON('tokens.json', tokens);
  }

  saveCodeVerifier(v) {
    writeText('verifier.txt', v);
  }
  codeVerifier() {
    const v = readText('verifier.txt');
    if (!v) throw new Error('missing PKCE code verifier — run `upwork login` again');
    return v;
  }

  redirectToAuthorization(url) {
    if (this._onAuthorize) this._onAuthorize(url);
  }

  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') removeFile('client.json');
    if (scope === 'all' || scope === 'tokens') removeFile('tokens.json');
    if (scope === 'all' || scope === 'verifier') removeFile('verifier.txt');
  }
}

export function openBrowser(url) {
  const s = String(url);
  const cmd =
    process.platform === 'darwin'
      ? `open "${s}"`
      : process.platform === 'win32'
        ? `start "" "${s}"`
        : `xdg-open "${s}"`;
  exec(cmd, () => {});
}
