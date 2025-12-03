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

## System Requirements

- Node.js 18+ (LTS recommended)
- Jira Cloud instance
- Tempo API token
- Jira API token

## Usage Options

There are two main ways to use this MCP server:

1. **NPX (Recommended for most users)**: Run directly without installation
2. **Local Clone**: Clone the repository for development or customization

## Option 1: NPX Usage

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

## Option 2: Local Repository Clone

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
   - Create a new API token with appropriate permissions

2. **Jira API Token**:
   - Go to [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - Create a new API token for your account

## Environment Variables

The server requires the following environment variables:

```
TEMPO_API_TOKEN     # Your Tempo API token
JIRA_API_TOKEN      # Your Jira API token
JIRA_EMAIL          # Your Jira account email (required for basic auth)
JIRA_BASE_URL       # Your Jira instance URL (e.g., https://your-org.atlassian.net)
JIRA_AUTH_TYPE      # Optional: 'basic' (default) or 'bearer' for OAuth 2.0 tokens
JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID     # Optional: Custom field ID for Tempo accounts
```

You can set these in your environment or provide them in the MCP client configuration.

### Authentication Types

The server supports two authentication methods for the Jira API:

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

## Tempo Account Configuration

If your Tempo instance requires worklogs to be linked to accounts, set the custom field ID that contains the account information:

```bash
JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID=10234
```

To find your custom field ID:

1. Go to Jira Settings → Issues → Custom Fields
2. Find your Tempo account field and note the ID from the URL or field configuration

## Available Tools

### retrieveWorklogs

Fetches worklogs for the configured user between start and end dates.

```
Parameters:
- startDate: String (YYYY-MM-DD)
- endDate: String (YYYY-MM-DD)
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

## Project Structure

```
tempo-mcp-server/
├── src/                  # Source code
│   ├── config.ts         # Configuration management
│   ├── index.ts          # MCP server implementation
│   ├── jira.ts           # Jira API integration
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
