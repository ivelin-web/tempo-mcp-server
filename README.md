[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/ivelin-web-tempo-mcp-server-badge.png)](https://mseep.ai/app/ivelin-web-tempo-mcp-server)

# Tempo MCP Server

A Model Context Protocol (MCP) server for managing Tempo worklogs in Jira. This server provides tools for tracking time and managing worklogs through Tempo's API, making it accessible through Claude, Cursor and other MCP-compatible clients.

[![npm version](https://img.shields.io/npm/v/@ivelin-web/tempo-mcp-server.svg)](https://www.npmjs.com/package/@ivelin-web/tempo-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Retrieve Worklogs**: Get all worklogs for a specific date range
- **Create Worklog**: Log time against Jira issues
- **Bulk Create**: Create multiple worklogs in a single operation
- **Edit Worklog**: Modify time spent, dates, and descriptions
- **Delete Worklog**: Remove existing worklogs
- **Missing Days Report**: Find working days where you logged less than expected (uses Tempo's user-schedule, so holidays and non-working days are skipped automatically)
- **Worklog Analytics**: Aggregate hours by issue, account, day, week, or month with totals and percentages

## System Requirements

- Node.js 18+ (LTS recommended) — only needed for the local stdio modes
- Jira Cloud instance
- Tempo API token
- Jira API token (not required when using OAuth 2.0 PKCE authentication)

## Usage Options

There are three ways to use this MCP server:

1. **Remote / Cloudflare Workers (no install)** — host once, share with your team. Each user generates their own URL via a setup page and pastes it into Claude.ai or ChatGPT. Works from web and mobile.
2. **NPX**: Run directly with `npx` on your laptop, no clone required.
3. **Local Clone**: Clone the repository for development or customization.

If you just want to use the server, option 1 is the easiest and works on phones too. If you're a maintainer deploying for your team, see the [Remote deployment guide](#remote-deployment-cloudflare-workers).

## Option 1: Remote (Cloudflare Workers)

### For end users

Once your team has the server deployed, the flow is:

1. Open `https://<your-deployment>.workers.dev/setup`.
2. Paste your Tempo API token, Jira base URL, Jira API token, and Jira email. Hit **Generate MCP URL**.
3. The page returns a personal URL like `https://<your-deployment>.workers.dev/mcp/u_<random>`. Copy it.
4. In **Claude.ai → Settings → Connectors → Add custom connector**, paste the URL.
5. The connector syncs across web, desktop, and mobile (iOS/Android).

For ChatGPT: enable Settings → Apps → Advanced → **Developer mode** (Pro/Plus/Business+), then add the URL as a custom MCP server. Plus/Pro accounts can read; write tools (create/edit worklogs) require Business+ per OpenAI's tier.

The URL contains your credentials — treat it like a password, don't share or commit it.

### Remote deployment (Cloudflare Workers)

Free-tier hosting on Cloudflare Workers. ~5–10 minutes from clone to live URL. Anyone can fork and self-host — no upstream coordination needed.

#### Prerequisites

- A Cloudflare account (free plan is enough).
- Node.js 18+ and `npm` locally — only used for `wrangler` CLI; the Worker runtime itself doesn't run Node.

#### One-time setup

```bash
git clone https://github.com/ivelin-web/tempo-mcp-server.git
cd tempo-mcp-server
npm install

# 1. Log in to Cloudflare (opens browser).
npx wrangler login

# 2. Create your own KV namespace for per-user credentials.
npx wrangler kv namespace create USERS
```

> ⚠️ **If you forked the repo:** the committed [`wrangler.jsonc`](wrangler.jsonc) `kv_namespaces[0].id` belongs to the upstream maintainer's Cloudflare account. Replace it with the id step 2 just returned, otherwise `wrangler deploy` will fail with `KV namespace … is not valid`. KV namespace ids are public per-account identifiers, not secrets, but each account has its own.

```bash
# 3. Generate and store the encryption key.
#    Used to AES-GCM-encrypt per-user credentials in KV.
openssl rand -base64 48 | npx wrangler secret put ENCRYPTION_KEY

# 4. (Optional) Pin the CORS origin. Defaults to "*". Set it if you only
#    want browsers from a specific app to call the Worker.
echo "https://claude.ai" | npx wrangler secret put ALLOWED_ORIGIN

# 5. Deploy.
npm run remote:deploy
# → outputs https://tempo-mcp-server.<your-account>.workers.dev
```

Visit `/setup` on the deployed URL to onboard your first user.

#### Updating an existing deployment

After pulling new commits from upstream:

```bash
npm install              # picks up any new deps
npm run remote:deploy    # ships the new Worker bundle
```

Secrets and KV data persist across deploys. `compatibility_date` and `compatibility_flags` in `wrangler.jsonc` are pinned, so behaviour doesn't drift silently when Cloudflare ships runtime changes.

#### Local development

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and put a real ENCRYPTION_KEY (any value works locally)
npm run remote:dev
# → http://localhost:8787 with a mock KV; data is wiped between sessions
```

Other useful scripts:

- `npm run remote:typecheck` — type-check the Worker bundle (uses `tsconfig.worker.json`).
- `npm run remote:tail` — stream live logs from the deployed Worker.

#### Troubleshooting

- **`KV namespace … is not valid`** — `kv_namespaces[0].id` in `wrangler.jsonc` is empty (or wrong). Run `npx wrangler kv namespace create USERS` and paste the new id.
- **`ENCRYPTION_KEY is not defined`** at runtime — secret wasn't set. Re-run step 3.
- **`Rate limit binding … not available`** — your account's plan doesn't include the Workers Rate Limiting API. Either upgrade, or remove the `ratelimits` block in `wrangler.jsonc` and the `SETUP_RATE_LIMITER.limit(...)` call in `src/remote/worker.ts`.
- **404 from `/mcp/u_…`** — the user id is unknown (or never existed). The Worker returns 404 by design for invalid/missing ids; have the user re-run `/setup`.
- **Existing users suddenly can't connect** — most likely cause is a rotated `ENCRYPTION_KEY`; existing AES-GCM blobs can't be decrypted with the new key. See the warning below.

#### How it works

**Credential storage:** the `/setup` POST handler AES-GCM encrypts the form data with `ENCRYPTION_KEY` and stores it in KV under `user:u_<random>`. Each MCP request reads + decrypts that record, builds an `McpServer` for that single request, and dispatches via Cloudflare's official `createMcpHandler`. No credentials are held in memory between requests; no Durable Objects are used.

> **Treat `ENCRYPTION_KEY` as long-lived.** Rotating it invalidates every existing user record (the AES-GCM tag won't validate against the new key), and all your users will need to re-run `/setup`. Pick a key from `openssl rand -base64 48` once and never change it.

**Auth model:** the URL `/mcp/u_<id>` _is_ the credential. The 22-char base64url id carries ~128 bits of entropy. We never return 401 for that path (Claude.ai web has known bugs around the 401-then-OAuth flow), and we return 404 for unknown ids. This matches the URL-token pattern used by Zapier MCP, Pipedream MCP, and similar.

**Hardening already in place:**

- Per-IP rate limit (5 req/min) on `POST /setup`, via Cloudflare's native Rate Limiting binding.
- `Cache-Control: no-store` on `/setup` responses so the success page (which contains the MCP URL) and the error re-render (which echoes tokens back) never sit in any cache.
- `Referrer-Policy: no-referrer` on every HTML page so the MCP URL doesn't leak via referrer headers.

**Limits to know about:**

- Workers free plan: 100k requests/day, 50ms CPU per request (we are I/O-bound, comfortable).
- KV free plan: 100k reads/day, 1k writes/day. Setup writes once per user; reads happen per MCP call.
- The Worker only supports Jira **basic** auth (classic API token + email). Bearer and the OAuth 2.0 PKCE flow are stdio-only — bearer requires gateway URL routing that the Worker does not yet do, and PKCE needs a browser callback the Worker can't host.

## Option 2: NPX Usage

The easiest way to use this server is via npx without installation:

### Connecting to Claude Desktop (NPX Method)

1. Open your MCP client configuration file:

   - Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Claude Desktop (Windows): `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the following configuration:

```json
{
  "mcpServers": {
    "Jira_Tempo": {
      "command": "npx",
      "args": ["-y", "@ivelin-web/tempo-mcp-server"],
      "env": {
        "TEMPO_API_TOKEN": "your_tempo_api_token_here",
        "JIRA_API_TOKEN": "your_jira_api_token_here",
        "JIRA_EMAIL": "your_email@example.com",
        "JIRA_BASE_URL": "https://your-org.atlassian.net"
      }
    }
  }
}
```

3. Restart your Claude Desktop client

### One-Click Install for Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=Jira%20Tempo&config=eyJjb21tYW5kIjoibnB4IC15IEBpdmVsaW4td2ViL3RlbXBvLW1jcC1zZXJ2ZXIiLCJlbnYiOnsiVEVNUE9fQVBJX1RPS0VOIjoieW91cl90ZW1wb19hcGlfdG9rZW5faGVyZSIsIkpJUkFfQVBJX1RPS0VOIjoieW91cl9qaXJhX2FwaV90b2tlbl9oZXJlIiwiSklSQV9FTUFJTCI6InlvdXJfZW1haWxAZXhhbXBsZS5jb20iLCJKSVJBX0JBU0VfVVJMIjoiaHR0cHM6Ly95b3VyLW9yZy5hdGxhc3NpYW4ubmV0In19)

## Option 3: Local Repository Clone

### Installation

```bash
# Clone the repository
git clone https://github.com/ivelin-web/tempo-mcp-server.git
cd tempo-mcp-server

# Install dependencies
npm install

# Build TypeScript files
npm run build
```

### Running Locally

There are two ways to run the server locally:

#### 1. Using the MCP Inspector (for development and debugging)

```bash
npm run inspect
```

#### 2. Using Node directly

You can run the server directly with Node by pointing to the built JavaScript file:

### Connecting to Claude Desktop (Local Method)

1. Open your MCP client configuration file
2. Add the following configuration:

```json
{
  "mcpServers": {
    "Jira_Tempo": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/tempo-mcp-server/build/index.js"],
      "env": {
        "TEMPO_API_TOKEN": "your_tempo_api_token_here",
        "JIRA_API_TOKEN": "your_jira_api_token_here",
        "JIRA_EMAIL": "your_email@example.com",
        "JIRA_BASE_URL": "https://your-org.atlassian.net"
      }
    }
  }
}
```

3. Restart your Claude Desktop client

## Getting API Tokens

1. **Tempo API Token**:

   - Go to Tempo > Settings > API Integration
   - Create a new API token with **Custom access** and select at minimum:
     - **Worklogs** (View + Manage) — for all worklog tools
     - **Schemes** (View) — required for `getMissingWorklogDays` (reads the user-schedule)
     - **Accounts** (View) — only if your worklogs use Tempo accounts
     - **Teams** (View) — only if you use the `program` / `team` filters (covers Teams and Programs)
   - Tempo does not allow editing scopes on an existing token; create a new one if you need to add scopes later.

2. **Jira API Token**:
   - Go to [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - Click **"Create API token"** (the classic, unscoped flow). This is what works with `basic` auth out of the box.
   - **Do not use "Create API token with scopes"** — those tokens must be sent through Atlassian's gateway URL (`https://api.atlassian.com/ex/jira/{cloudId}/...`) with the cloud ID, which this server's `basic` auth path does not currently route to. They will fail with 401 against your site URL. If you only have a scoped token available (e.g. your org disabled classic tokens), use the [OAuth 2.0 PKCE flow](#oauth-20-pkce-authentication) instead — it routes through the gateway automatically.

## Environment Variables

The server requires the following environment variables:

```
TEMPO_API_TOKEN           # Your Tempo API token
JIRA_API_TOKEN            # Your Jira API token (required for basic and bearer auth)
JIRA_EMAIL                # Your Jira account email (required for basic auth)
JIRA_BASE_URL             # Your Jira instance URL (e.g., https://your-org.atlassian.net)
JIRA_AUTH_TYPE            # Optional: 'basic' (default), 'bearer', or 'oauth'
JIRA_OAUTH_CLIENT_ID      # OAuth 2.0 client ID (required for oauth auth)
JIRA_OAUTH_CLIENT_SECRET  # OAuth 2.0 client secret (required for oauth auth)
JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID     # Optional: Custom field ID for Tempo accounts
```

You can set these in your environment or provide them in the MCP client configuration.

### Authentication Types

The server supports three authentication methods for the Jira API:

#### Basic Authentication (default)

Uses email and API token. This is the traditional method:

```json
{
  "env": {
    "JIRA_API_TOKEN": "your_api_token",
    "JIRA_EMAIL": "your_email@example.com",
    "JIRA_AUTH_TYPE": "basic"
  }
}
```

#### Bearer Token Authentication (OAuth 2.0)

For users who want to use OAuth 2.0 scoped tokens for enhanced security:

```json
{
  "env": {
    "JIRA_API_TOKEN": "your_oauth_access_token",
    "JIRA_AUTH_TYPE": "bearer"
  }
}
```

Note: When using `bearer` auth, `JIRA_EMAIL` is not required as the user is identified from the token.

#### OAuth 2.0 PKCE Authentication

Some Atlassian organizations restrict API token access via admin policy, which causes basic and bearer authentication to fail. The `oauth` type implements the full OAuth 2.0 authorization code flow with PKCE and works regardless of API token restrictions — tokens are short-lived and refreshed automatically without any manual management.

On first use, a browser window opens for you to authorize access. Tokens are stored locally at `~/.tempo-mcp-server/tokens.json` and refreshed automatically.

1. Create an OAuth 2.0 app in [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/) with the `read:jira-user` and `read:jira-work` scopes and `http://localhost:7788/callback` as the callback URL.

2. Configure the server:

```json
{
  "env": {
    "JIRA_BASE_URL": "https://your-org.atlassian.net",
    "JIRA_AUTH_TYPE": "oauth",
    "JIRA_OAUTH_CLIENT_ID": "your_client_id",
    "JIRA_OAUTH_CLIENT_SECRET": "your_client_secret"
  }
}
```

Note: `JIRA_API_TOKEN` and `JIRA_EMAIL` are not required when using `oauth` auth.

## Tempo Account Configuration

If your Tempo instance requires worklogs to be linked to accounts, set the custom field ID that contains the account information:

```bash
JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID=10234
```

To find your custom field ID:

1. Go to Jira Settings → Issues → Custom Fields
2. Find your Tempo account field and note the ID from the URL or field configuration

## Viewing Other Users' Worklogs

The read tools (`retrieveWorklogs`, `getWorklogAnalytics`, `getMissingWorklogDays`) default to the token owner's own worklogs, but accept optional filters to target other people — useful for admins, PMs, and team leads:

- `users` — array of emails, display names, or Jira accountIds (e.g. `["ivan@company.com", "Maria Petrova"]`)
- `program` — Tempo Program name or id; expands to all current members of the program's teams
- `team` — Tempo Team name or id; expands to all current team members

Filters combine as a union. Tempo enforces permissions **server-side**: the API silently omits worklogs the token owner isn't allowed to see (no error is returned). To view other users you need:

1. A Tempo **Permission Role** with **View Worklogs** granted to the token owner (Tempo > Settings > Permission Roles) — "Full" for everyone, or "Restricted" + selected teams
2. Jira **Browse Projects** permission on the relevant projects
3. The **Teams** scope on the Tempo API token if you use the `program` / `team` filters

`getWorklogAnalytics` also supports `groupBy: "user"` — combined with `program`, it produces a per-person hours report in a single call. `getMissingWorklogDays` with a filter returns a per-user report of days with missing time (viewing other users' schedules is also permission-gated).

## Available Tools

### retrieveWorklogs

Fetches worklogs for the configured user (or other users via filters) between start and end dates.

```
Parameters:
- startDate: String (YYYY-MM-DD)
- endDate: String (YYYY-MM-DD)
- users: String[] (optional) — emails, display names, or accountIds
- program: String (optional) — Tempo Program name or id
- team: String (optional) — Tempo Team name or id
```

### createWorklog

Creates a new worklog for a specific Jira issue.

```
Parameters:
- issueKey: String (e.g., "PROJECT-123")
- timeSpentHours: Number (positive)
- date: String (YYYY-MM-DD)
- description: String (optional)
- startTime: String (HH:MM format, optional)
```

### bulkCreateWorklogs

Creates multiple worklogs in a single operation.

```
Parameters:
- worklogEntries: Array of {
    issueKey: String
    timeSpentHours: Number
    date: String (YYYY-MM-DD)
    description: String (optional)
    startTime: String (HH:MM format, optional)
  }
```

### editWorklog

Modifies an existing worklog.

```
Parameters:
- worklogId: String
- timeSpentHours: Number (positive)
- description: String (optional)
- date: String (YYYY-MM-DD, optional)
- startTime: String (HH:MM format, optional)
```

### deleteWorklog

Removes an existing worklog.

```
Parameters:
- worklogId: String
```

### getMissingWorklogDays

Reports working days in a date range where the user has logged less time than expected. Expected hours per day come from the user's Tempo schedule, so holidays, non-working days, and part-time schedules are honoured automatically. With `users` / `program` / `team` it checks other people and returns a per-user report (sorted by most missing hours).

```
Parameters:
- startDate: String (YYYY-MM-DD)
- endDate: String (YYYY-MM-DD)
- minHoursPerDay: Number (optional) — override the per-day threshold;
                                      non-working days are still skipped
- users: String[] (optional) — emails, display names, or accountIds
- program: String (optional) — Tempo Program name or id
- team: String (optional) — Tempo Team name or id
```

> **Required Tempo scope:** the `TEMPO_API_TOKEN` must include the **Schemes** scope (covers Workload Schemes, Holiday Schemes, User Schedule) in addition to **Worklogs**. Tempo does not allow modifying scopes on an existing token — if your current token only has Worklogs, create a new one at Tempo > Settings > API Integration.

### getWorklogAnalytics

Aggregates worklogs in a date range and returns hours, worklog count, and percentage per group, sorted by hours descending. Combine `groupBy: "user"` with `program` / `team` / `users` for a per-person report.

```
Parameters:
- startDate: String (YYYY-MM-DD)
- endDate: String (YYYY-MM-DD)
- groupBy: "issue" | "account" | "user" | "day" | "week" | "month" (optional, default "issue")
- users: String[] (optional) — emails, display names, or accountIds
- program: String (optional) — Tempo Program name or id
- team: String (optional) — Tempo Team name or id
```

## Project Structure

```
tempo-mcp-server/
├── src/                  # Source code
│   ├── authors.ts        # Author filter resolution (users/program/team → accountIds)
│   ├── config.ts         # Configuration management
│   ├── index.ts          # MCP server implementation
│   ├── jira.ts           # Jira API integration
│   ├── oauth.ts          # OAuth 2.0 PKCE flow and token management
│   ├── tools.ts          # Tool implementations
│   ├── types.ts          # TypeScript types and schemas
│   └── utils.ts          # Utility functions
├── build/                # Compiled JavaScript (generated)
├── tsconfig.json         # TypeScript configuration
└── package.json          # Project metadata and scripts
```

## Troubleshooting

If you encounter issues:

1. Check that all environment variables are properly set
2. Verify your Jira and Tempo API tokens have the correct permissions
3. Check the console output for error messages
4. Try running with the inspector: `npm run inspect`

## License

[MIT](LICENSE)

## Credits

This server implements the [Model Context Protocol](https://modelcontextprotocol.io/) specification created by Anthropic.
