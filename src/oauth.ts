import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';
import { exec } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import axios from 'axios';

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources';

export const OAUTH_CALLBACK_PORT = 7788;
const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;

const TOKEN_DIR = join(homedir(), '.tempo-mcp-server');
const TOKEN_FILE = join(TOKEN_DIR, 'tokens.json');

const SCOPES = 'read:jira-user read:jira-work offline_access';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  siteUrl: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  cloudId: string;
}

// In-memory cache to avoid repeated disk reads within the same process
let memCache: { token: string; cloudId: string; expiresAt: number } | null =
  null;

function loadStore(): Record<string, StoredTokens> {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, StoredTokens>): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function fetchCloudId(
  accessToken: string,
  siteUrl: string,
): Promise<string> {
  const res = await axios.get<Array<{ id: string; url: string; name: string }>>(
    ATLASSIAN_RESOURCES_URL,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
  const match = res.data.find((r) => normalize(r.url) === normalize(siteUrl));

  if (!match) {
    const available = res.data.map((r) => r.url).join(', ');
    throw new Error(
      `Jira site "${siteUrl}" not found in accessible resources.\n` +
        `Available sites: ${available}\n` +
        `Set JIRA_BASE_URL to one of the available sites.`,
    );
  }

  return match.id;
}

async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await axios.post(ATLASSIAN_TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresIn: res.data.expires_in,
  };
}

async function doRefresh(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await axios.post(ATLASSIAN_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token ?? refreshToken,
    expiresIn: res.data.expires_in,
  };
}

async function authorize(
  clientId: string,
  clientSecret: string,
  siteUrl: string,
): Promise<StoredTokens> {
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString('hex');

  const authUrl = new URL(ATLASSIAN_AUTH_URL);
  authUrl.searchParams.set('audience', 'api.atlassian.com');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      clearTimeout(timeout);
      server.close(); // stop accepting new connections; current request completes normally

      const url = new URL(req.url!, `http://localhost:${OAUTH_CALLBACK_PORT}`);
      const error = url.searchParams.get('error');
      const returnedCode = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (error || returnedState !== state || !returnedCode) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization failed.</h1><p>You can close this tab.</p>');
        reject(
          new Error(error ? `OAuth error: ${error}` : 'Invalid OAuth callback'),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<h1>Authorization successful!</h1><p>You can close this tab.</p>',
      );
      resolve(returnedCode);
    });

    const timeout = setTimeout(
      () => {
        server.closeAllConnections?.();
        server.close();
        reject(new Error('OAuth timed out after 5 minutes'));
      },
      5 * 60 * 1000,
    );

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${OAUTH_CALLBACK_PORT} is already in use. Stop the other process and try again.`,
          ),
        );
      } else {
        reject(err);
      }
    });

    server.listen(OAUTH_CALLBACK_PORT, () => {
      const url = authUrl.toString();
      console.error('\n[Tempo MCP] Jira authorization required.');
      console.error(
        `[Tempo MCP] Opening browser... If it doesn't open, visit:\n\n  ${url}\n`,
      );
      const cmd =
        process.platform === 'darwin'
          ? `open "${url}"`
          : process.platform === 'win32'
            ? `start "" "${url}"`
            : `xdg-open "${url}"`;
      exec(cmd);
    });
  });

  const { accessToken, refreshToken, expiresIn } = await exchangeCode(
    clientId,
    clientSecret,
    code,
    verifier,
  );
  const cloudId = await fetchCloudId(accessToken, siteUrl);
  console.error('[Tempo MCP] Authorization successful!\n');

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    cloudId,
  };
}

export async function getOAuthToken(
  cfg: OAuthConfig,
): Promise<{ token: string; cloudId: string }> {
  const BUFFER_MS = 5 * 60 * 1000;

  // Check in-memory cache first
  if (memCache && memCache.expiresAt > Date.now() + BUFFER_MS) {
    return { token: memCache.token, cloudId: memCache.cloudId };
  }

  const store = loadStore();
  const stored = store[cfg.siteUrl];

  if (stored) {
    if (stored.expiresAt > Date.now() + BUFFER_MS) {
      memCache = {
        token: stored.accessToken,
        cloudId: stored.cloudId,
        expiresAt: stored.expiresAt,
      };
      return { token: stored.accessToken, cloudId: stored.cloudId };
    }

    if (stored.refreshToken) {
      try {
        const { accessToken, refreshToken, expiresIn } = await doRefresh(
          cfg.clientId,
          cfg.clientSecret,
          stored.refreshToken,
        );
        const updated: StoredTokens = {
          accessToken,
          refreshToken,
          expiresAt: Date.now() + expiresIn * 1000,
          cloudId: stored.cloudId,
        };
        store[cfg.siteUrl] = updated;
        saveStore(store);
        memCache = {
          token: updated.accessToken,
          cloudId: updated.cloudId,
          expiresAt: updated.expiresAt,
        };
        return { token: updated.accessToken, cloudId: updated.cloudId };
      } catch {
        // Fall through to fresh authorization
      }
    }
  }

  const tokens = await authorize(cfg.clientId, cfg.clientSecret, cfg.siteUrl);
  store[cfg.siteUrl] = tokens;
  saveStore(store);
  memCache = {
    token: tokens.accessToken,
    cloudId: tokens.cloudId,
    expiresAt: tokens.expiresAt,
  };
  return { token: tokens.accessToken, cloudId: tokens.cloudId };
}
