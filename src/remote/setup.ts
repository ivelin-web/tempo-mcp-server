/**
 * Onboarding pages: GET/POST /setup.
 *
 * Flow:
 *  1. GET /setup — server-rendered HTML form. Six fields (Tempo + Jira creds).
 *  2. POST /setup — validates, mints a `userId`, encrypts + stores creds in
 *     KV, and renders a success page with the MCP URL the user pastes into
 *     Claude/ChatGPT.
 *
 * Security notes:
 *  - All HTML is server-rendered with no client-side framework. The submitted
 *    secrets reach the Worker via TLS POST and are AES-GCM encrypted in KV
 *    before any response is sent.
 *  - The success page renders the MCP URL as text + a copy button. We never
 *    redirect the browser to that URL (would put it in history).
 *  - We escape user-controlled values everywhere they appear in HTML to keep
 *    a future "show what I entered" path safe (currently we never echo back).
 */

import {
  generateId,
  putCredentials,
  StorageEnv,
  UserCredentials,
} from './storage.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #6b7280; --bg: #f9fafb;
          --card: #ffffff; --border: #e5e7eb; --accent: #2563eb; --error: #dc2626;
          --success: #059669; --code-bg: #f3f4f6; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #f3f4f6; --muted: #9ca3af; --bg: #0f172a; --card: #1e293b;
            --border: #334155; --code-bg: #0b1220; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         background: var(--bg); color: var(--fg); line-height: 1.5; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 24px 0 8px; }
  p { color: var(--muted); margin: 0 0 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px;
          padding: 24px; margin-top: 16px; }
  label { display: block; font-weight: 500; margin: 16px 0 4px; font-size: 14px; }
  label .req { color: var(--error); }
  label .hint { font-weight: 400; color: var(--muted); font-size: 12px; margin-left: 4px; }
  input[type=text], input[type=email], input[type=url], input[type=password], select {
    width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg); color: var(--fg); font-size: 14px; font-family: inherit;
  }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
  .row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 240px; }
  button { background: var(--accent); color: #fff; border: 0; padding: 10px 18px;
           border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;
           margin-top: 24px; }
  button:hover { filter: brightness(1.1); }
  .err { color: var(--error); background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.3);
         padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .ok { color: var(--success); background: rgba(5,150,105,0.08); border: 1px solid rgba(5,150,105,0.3);
        padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  code, .url { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
               background: var(--code-bg); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  .url-box { background: var(--code-bg); padding: 14px; border-radius: 8px; word-break: break-all;
             border: 1px solid var(--border); font-size: 13px; user-select: all; cursor: text; }
  .copy-btn { margin-top: 8px; background: transparent; color: var(--accent);
              border: 1px solid var(--accent); padding: 6px 14px; font-size: 13px; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: var(--accent); font-size: 14px; }
  ul { padding-left: 20px; color: var(--muted); }
  ul li { margin: 4px 0; font-size: 14px; }
  .warn { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.4);
          color: #92400e; padding: 12px 16px; border-radius: 8px; font-size: 14px; }
  @media (prefers-color-scheme: dark) { .warn { color: #fde68a; } }
  hr { border: 0; border-top: 1px solid var(--border); margin: 24px 0; }
`;

const SCRIPT_TOGGLE_AUTH = `
  function syncAuthType() {
    var t = (document.querySelector('input[name=jiraAuthType]:checked') || {}).value;
    var emailRow = document.getElementById('email-row');
    var emailInput = document.getElementById('jiraEmail');
    if (!emailRow || !emailInput) return;
    var basic = (t !== 'bearer');
    emailRow.style.display = basic ? '' : 'none';
    emailInput.required = basic;
  }
  document.addEventListener('DOMContentLoaded', function () {
    syncAuthType();
    document.querySelectorAll('input[name=jiraAuthType]').forEach(function (el) {
      el.addEventListener('change', syncAuthType);
    });
  });
`;

const SCRIPT_COPY = `
  function copyUrl(id) {
    var el = document.getElementById(id);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent.trim()).then(function () {
      var btn = document.getElementById(id + '-copy');
      if (btn) { var orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = orig; }, 1500); }
    });
  }
`;

function layout(title: string, body: string, script = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">${body}</div>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

export function renderSetupPage(
  error?: string,
  prev?: Partial<UserCredentials>,
): string {
  const e = error ? `<div class="err">${escapeHtml(error)}</div>` : '';
  const v = (k: keyof UserCredentials) =>
    escapeHtml((prev?.[k] as string) ?? '');
  // Bearer is currently disabled (see below); always default to basic on re-render.
  const checkedBasic = 'checked';
  const body = `
    <h1>Tempo MCP — Setup</h1>
    <p>Generate your personal MCP connector URL. Each field is the same value
    you'd put in <code>.env</code> for the local CLI version. Credentials are
    AES-GCM encrypted at rest in Cloudflare KV.</p>
    ${e}
    <form method="POST" action="/setup" class="card" autocomplete="off">
      <h2>Tempo</h2>
      <label for="tempoApiToken">Tempo API token <span class="req">*</span>
        <span class="hint">Tempo → Settings → API Integration → New Token</span>
      </label>
      <input id="tempoApiToken" name="tempoApiToken" type="password" required value="${v('tempoApiToken')}">

      <h2>Jira</h2>
      <label for="jiraBaseUrl">Jira base URL <span class="req">*</span>
        <span class="hint">e.g. <code>https://your-org.atlassian.net</code></span>
      </label>
      <input id="jiraBaseUrl" name="jiraBaseUrl" type="url" required placeholder="https://your-org.atlassian.net" value="${v('jiraBaseUrl')}">

      <label>Jira authentication type</label>
      <div class="row" style="gap:24px">
        <label style="font-weight:400;display:inline-flex;align-items:center;gap:6px;margin:6px 0;">
          <input type="radio" name="jiraAuthType" value="basic" ${checkedBasic}> Basic (email + token)
        </label>
        <label style="font-weight:400;display:inline-flex;align-items:center;gap:6px;margin:6px 0;color:var(--muted);" title="Atlassian scoped/OAuth access tokens require routing through api.atlassian.com/ex/jira/{cloudId}, which the remote server does not yet do — coming soon.">
          <input type="radio" name="jiraAuthType" value="bearer" disabled> Bearer (OAuth access token) <span class="hint">— coming soon</span>
        </label>
      </div>

      <label for="jiraApiToken">Jira API token <span class="req">*</span>
        <span class="hint">Use a classic token from <code>id.atlassian.com</code>. (Scoped tokens are not supported yet.)</span>
      </label>
      <input id="jiraApiToken" name="jiraApiToken" type="password" required value="${v('jiraApiToken')}">

      <div id="email-row">
        <label for="jiraEmail">Jira email <span class="req">*</span>
          <span class="hint">Required for Basic auth.</span>
        </label>
        <input id="jiraEmail" name="jiraEmail" type="email" placeholder="you@company.com" value="${v('jiraEmail')}">
      </div>

      <details>
        <summary>Optional</summary>
        <label for="jiraTempoAccountCustomFieldId">Tempo account custom field ID
          <span class="hint">Only if your org uses Tempo's <em>Account</em> work attribute (numeric, e.g. <code>10234</code>)</span>
        </label>
        <input id="jiraTempoAccountCustomFieldId" name="jiraTempoAccountCustomFieldId" type="text" value="${v('jiraTempoAccountCustomFieldId')}">
      </details>

      <button type="submit">Generate MCP URL</button>
    </form>

    <div class="card">
      <h2>What happens next</h2>
      <ul>
        <li>Server creates a unique URL like <code>/mcp/u_…</code>.</li>
        <li>You paste that URL into Claude.ai → Settings → Connectors → Add custom connector.</li>
        <li>Claude calls your URL with each tool invocation; the Worker decrypts your creds and proxies to Tempo + Jira.</li>
        <li>Once added in Claude.ai web, the connector syncs to mobile (iOS/Android).</li>
      </ul>
    </div>
  `;
  return layout('Tempo MCP — Setup', body, SCRIPT_TOGGLE_AUTH);
}

export function renderSetupSuccess(mcpUrl: string): string {
  const body = `
    <h1>Your MCP URL</h1>
    <div class="ok">Credentials saved. Copy the URL below and add it as a custom connector.</div>
    <div class="card">
      <h2>MCP URL</h2>
      <div id="mcp-url" class="url-box">${escapeHtml(mcpUrl)}</div>
      <button type="button" class="copy-btn" id="mcp-url-copy" onclick="copyUrl('mcp-url')">Copy URL</button>

      <hr>

      <div class="warn">
        <strong>This URL is your credential.</strong> Anyone who has it can read and write
        your Tempo worklogs. Treat it like a password: don't share, don't commit to git,
        don't paste into chats.
      </div>

      <h2>Add to Claude.ai</h2>
      <ul>
        <li>Open <strong>Settings → Connectors</strong>.</li>
        <li>Click <strong>Add custom connector</strong>.</li>
        <li>Name it (e.g. "Tempo") and paste the URL above.</li>
        <li>Click <strong>Add</strong>. Tools should appear within seconds.</li>
      </ul>

      <h2>Add to ChatGPT</h2>
      <ul>
        <li>Settings → Apps → Advanced → enable <strong>Developer mode</strong> (Pro/Plus/Business+).</li>
        <li>New custom MCP server → paste the URL above.</li>
        <li>Plus/Pro accounts can read; write tools require Business+.</li>
      </ul>
    </div>
    <p style="margin-top:24px;text-align:center"><a href="/setup">← Generate another</a></p>
  `;
  return layout('Tempo MCP — Setup complete', body, SCRIPT_COPY);
}

type ParsedSetup =
  | { ok: true; creds: UserCredentials }
  | { ok: false; error: string; partial: Partial<UserCredentials> };

async function parseFormData(request: Request): Promise<ParsedSetup> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, error: 'Could not parse form data.', partial: {} };
  }
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };
  const partial: Partial<UserCredentials> = {
    tempoApiToken: get('tempoApiToken'),
    jiraBaseUrl: get('jiraBaseUrl'),
    jiraApiToken: get('jiraApiToken'),
    jiraEmail: get('jiraEmail') || undefined,
    // Force basic. Bearer is wired through the type system and the storage
    // layer for the day we add gateway-URL routing (see jira.ts), but until
    // that's done a bearer config would 401 against the user's site URL.
    // Ignore whatever the form sent.
    jiraAuthType: 'basic',
    jiraTempoAccountCustomFieldId:
      get('jiraTempoAccountCustomFieldId') || undefined,
  };

  if (!partial.tempoApiToken)
    return { ok: false, error: 'Tempo API token is required.', partial };
  if (!partial.jiraBaseUrl)
    return { ok: false, error: 'Jira base URL is required.', partial };
  try {
    const u = new URL(partial.jiraBaseUrl);
    if (u.protocol !== 'https:') {
      return {
        ok: false,
        error: 'Jira base URL must be an https URL.',
        partial,
      };
    }
  } catch {
    return { ok: false, error: 'Jira base URL is not a valid URL.', partial };
  }
  if (!partial.jiraApiToken)
    return { ok: false, error: 'Jira API token is required.', partial };
  if (partial.jiraAuthType === 'basic' && !partial.jiraEmail) {
    return {
      ok: false,
      error: 'Jira email is required for Basic auth.',
      partial,
    };
  }
  if (
    partial.jiraTempoAccountCustomFieldId &&
    !/^\d+$/.test(partial.jiraTempoAccountCustomFieldId)
  ) {
    return {
      ok: false,
      error: 'Tempo account custom field ID must be numeric.',
      partial,
    };
  }
  return { ok: true, creds: partial as UserCredentials };
}

export async function handleSetup(
  request: Request,
  env: StorageEnv,
): Promise<Response> {
  const baseUrl = new URL(request.url).origin;

  if (request.method === 'GET') {
    return new Response(renderSetupPage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const parsed = await parseFormData(request);
  if (!parsed.ok) {
    return new Response(renderSetupPage(parsed.error, parsed.partial), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const userId = generateId('u');
  await putCredentials(env, userId, parsed.creds);
  const mcpUrl = `${baseUrl}/mcp/${userId}`;

  return new Response(renderSetupSuccess(mcpUrl), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function renderLanding(): string {
  const body = `
    <h1>Tempo MCP Server</h1>
    <p>Remote MCP server for managing Tempo worklogs in Jira. Use it from
    Claude.ai (web + mobile) and ChatGPT (Developer Mode) without any local install.</p>
    <div class="card">
      <h2>Get started</h2>
      <p>Click below to generate your personal MCP URL. You'll need a Tempo API token
      and a classic Jira API token + email.</p>
      <a href="/setup"><button type="button">Generate MCP URL</button></a>
    </div>
    <div class="card">
      <h2>How it works</h2>
      <ul>
        <li>You enter your Tempo + Jira credentials once on the next page.</li>
        <li>The server stores them encrypted (AES-GCM) and gives you a unique URL.</li>
        <li>You paste that URL into Claude/ChatGPT as a custom connector.</li>
        <li>The MCP tools (createWorklog, getWorklogAnalytics, etc.) work in any chat.</li>
      </ul>
    </div>
  `;
  return layout('Tempo MCP Server', body);
}
