/**
 * Cloudflare Worker entrypoint — remote/multi-tenant Tempo MCP server.
 *
 * Routes:
 *   GET  /                        Landing page with link to /setup.
 *   GET  /setup                   Onboarding form (paste Tempo + Jira creds).
 *   POST /setup                   Stores creds in KV; returns success page
 *                                 with the user's MCP URL.
 *   POST /mcp/u_<id>              Streamable HTTP MCP endpoint, scoped to
 *                                 the user identified by `u_<id>` in the path.
 *   GET  /mcp/u_<id>              Same endpoint (Streamable HTTP allows GET
 *                                 for SSE upgrade and capability advertising).
 *   *    /healthz                 Liveness probe.
 *
 * Auth model: the URL `/mcp/u_<id>` IS the credential. The 22-char base64url
 * suffix carries ~128 bits of entropy. Anyone with the URL can act as the
 * user. We never return 401 for this path — Claude.ai web has known bugs
 * around the 401-then-OAuth flow. Returning 404 for unknown ids matches what
 * Zapier MCP, Pipedream MCP, and other URL-token MCP servers do today.
 */

import { createMcpHandler } from 'agents/mcp';
import { buildMcpServer } from './agent.js';
import { getCredentials, isValidId, StorageEnv } from './storage.js';
import { handleSetup, renderLanding } from './setup.js';

interface Env extends StorageEnv {
  ALLOWED_ORIGIN?: string;
  /** Rate limit binding declared in wrangler.jsonc#ratelimits. */
  SETUP_RATE_LIMITER: RateLimit;
}

const MCP_PATH_RE = /^\/mcp\/(u_[A-Za-z0-9_-]+)\/?$/;

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Accept, Last-Event-ID',
    // CRITICAL: browser MCP clients lose the session id without this — silent failure.
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Max-Age': '86400',
  };
}

function withCors(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(env))) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (url.pathname === '/healthz') {
      return new Response('ok', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return new Response(renderLanding(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    if (url.pathname === '/setup') {
      // Per-IP rate limit on POST only. GET is a static form render and is
      // safe to hammer; POST writes to KV and is the abuse target.
      if (request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const { success } = await env.SETUP_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return new Response(
            'Too many setup attempts. Try again in a minute.',
            {
              status: 429,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            },
          );
        }
      }
      const response = await handleSetup(request, env);
      // Re-wrap to add hardening headers. setup.ts already sets Content-Type.
      // no-store: success page contains the MCP URL (= credential); the error
      // re-render echoes submitted tokens back into password inputs. Neither
      // should sit in any cache.
      const headers = new Headers(response.headers);
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    const mcpMatch = url.pathname.match(MCP_PATH_RE);
    if (mcpMatch) {
      return withCors(await handleMcp(request, env, ctx, mcpMatch[1]), env);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  userId: string,
): Promise<Response> {
  if (!isValidId(userId, 'u')) {
    return new Response('Not found', { status: 404 });
  }

  const creds = await getCredentials(env, userId);
  if (!creds) {
    return new Response('Not found', { status: 404 });
  }

  // The handler matches `route: "/mcp"` exactly, so rewrite the URL before
  // forwarding. The user-facing path stays /mcp/u_xxx; the inner request the
  // SDK sees is /mcp.
  const innerUrl = new URL(request.url);
  innerUrl.pathname = '/mcp';
  const innerRequest = new Request(innerUrl.toString(), request);

  // MCP SDK ≥1.26 throws on McpServer reuse — build a fresh one per request.
  const server = buildMcpServer(creds);
  const handler = createMcpHandler(server, { route: '/mcp' });
  return handler(innerRequest, env, ctx);
}
