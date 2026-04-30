#!/usr/bin/env node
/**
 * Tempo MCP Server — stdio entrypoint.
 *
 * For local clients (Claude Desktop, Cursor, Windsurf) that launch this
 * binary as a child process and communicate over stdio. The remote/Cloudflare
 * Worker entrypoint lives in `src/remote/worker.ts` and shares the same
 * underlying tools/jira factories.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import config from './config.js';
import { Ctx } from './types.js';
import { createTools } from './tools.js';
import {
  retrieveWorklogsSchema,
  createWorklogSchema,
  bulkCreateWorklogsSchema,
  editWorklogSchema,
  deleteWorklogSchema,
  getMissingWorklogDaysSchema,
  getWorklogAnalyticsSchema,
} from './types.js';

async function buildStdioCtx(): Promise<Ctx> {
  const ctx: Ctx = {
    tempoApi: {
      baseUrl: config.tempoApi.baseUrl,
      token: config.tempoApi.token,
    },
    jiraApi: {
      baseUrl: config.jiraApi.baseUrl,
      // For 'oauth', the static token field is unused — refreshJira owns it.
      // We set a sentinel so the factory's cache miss check doesn't short-circuit.
      token: config.jiraApi.token ?? '',
      email: config.jiraApi.email,
      authType: config.jiraApi.authType,
      tempoAccountCustomFieldId: config.jiraApi.tempoAccountCustomFieldId,
    },
  };

  if (config.jiraApi.authType === 'oauth') {
    // Dynamic import keeps oauth.ts (which uses fs/http/child_process) out of
    // the Worker bundle. Stdio binary still works because Node resolves the
    // import normally.
    const clientId = config.jiraApi.oauthClientId;
    const clientSecret = config.jiraApi.oauthClientSecret;
    if (!clientId || !clientSecret) {
      throw new Error(
        'JIRA_OAUTH_CLIENT_ID and JIRA_OAUTH_CLIENT_SECRET are required for OAuth authentication',
      );
    }

    const { getOAuthToken } = await import('./oauth.js');
    const oauthCfg = {
      clientId,
      clientSecret,
      siteUrl: config.jiraApi.baseUrl,
    };
    ctx.refreshJira = async () => {
      const { token, cloudId } = await getOAuthToken(oauthCfg);
      return {
        token,
        baseUrl: `https://api.atlassian.com/ex/jira/${cloudId}`,
      };
    };
  }

  return ctx;
}

async function startServer(): Promise<void> {
  try {
    const ctx = await buildStdioCtx();
    const tools = createTools(ctx);

    const server = new McpServer({
      name: config.server.name,
      version: config.server.version,
    });

    server.registerTool(
      'retrieveWorklogs',
      { inputSchema: retrieveWorklogsSchema.shape },
      async ({ startDate, endDate }) => {
        try {
          const result = await tools.retrieveWorklogs(startDate, endDate);
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] retrieveWorklogs failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error retrieving worklogs: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      'createWorklog',
      { inputSchema: createWorklogSchema.shape },
      async ({
        issueKey,
        timeSpentHours,
        date,
        description,
        startTime,
        attributes,
      }) => {
        try {
          const result = await tools.createWorklog(
            issueKey,
            timeSpentHours,
            date,
            description,
            startTime,
            attributes,
          );
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] createWorklog failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error creating worklog: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      'bulkCreateWorklogs',
      { inputSchema: bulkCreateWorklogsSchema.shape },
      async ({ worklogEntries }) => {
        try {
          const result = await tools.bulkCreateWorklogs(worklogEntries);
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] bulkCreateWorklogs failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error creating multiple worklogs: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      'editWorklog',
      { inputSchema: editWorklogSchema.shape },
      async ({
        worklogId,
        timeSpentHours,
        description,
        date,
        startTime,
        attributes,
      }) => {
        try {
          const result = await tools.editWorklog(
            worklogId,
            timeSpentHours,
            description ?? null,
            date ?? null,
            startTime,
            attributes,
          );
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] editWorklog failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error editing worklog: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      'deleteWorklog',
      { inputSchema: deleteWorklogSchema.shape },
      async ({ worklogId }) => {
        try {
          const result = await tools.deleteWorklog(worklogId);
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] deleteWorklog failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error deleting worklog: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      'getMissingWorklogDays',
      {
        description:
          "Find working days in a date range where the user's logged time is below the expected hours from their Tempo user-schedule. Holidays and non-working days are skipped automatically. Returns days with their expected vs logged hours, plus a per-issue breakdown for partially-logged days. Requires the 'Schemes' scope on the Tempo API token (in addition to 'Worklogs').",
        inputSchema: getMissingWorklogDaysSchema.shape,
      },
      async ({ startDate, endDate, minHoursPerDay }) => {
        try {
          const result = await tools.getMissingWorklogDays(
            startDate,
            endDate,
            minHoursPerDay,
          );
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] getMissingWorklogDays failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error getting missing worklog days: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      'getWorklogAnalytics',
      {
        description:
          "Aggregate worklogs in a date range and return hours, worklog count, and percentage per group, sorted by hours descending. groupBy options: 'issue' (default), 'account', 'day', 'week' (ISO 8601), 'month'. Note: 'account' grouping reads the _Account_ work attribute on each worklog — worklogs without an account attribute are bucketed as 'No account', so this grouping is only meaningful if your team uses Tempo accounts.",
        inputSchema: getWorklogAnalyticsSchema.shape,
      },
      async ({ startDate, endDate, groupBy }) => {
        try {
          const result = await tools.getWorklogAnalytics(
            startDate,
            endDate,
            groupBy,
          );
          return {
            content: result.content,
            ...(result.isError && { isError: true }),
          };
        } catch (error) {
          console.error(
            `[ERROR] getWorklogAnalytics failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error getting worklog analytics: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[INFO] MCP Server started successfully');
  } catch (error) {
    console.error(
      `[ERROR] Failed to start MCP Server: ${error instanceof Error ? error.message : String(error)}`,
    );

    if (error instanceof Error && error.stack) {
      console.error(`[ERROR] Stack trace: ${error.stack}`);
    }

    process.exit(1);
  }
}

startServer().catch((error: unknown) => {
  console.error(
    `[ERROR] Unhandled exception: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
