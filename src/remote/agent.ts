/**
 * Per-request McpServer factory.
 *
 * Each MCP request loads encrypted credentials from KV, calls
 * `buildMcpServer(creds)` to construct a fresh McpServer with all 7 tools
 * registered, and dispatches one JSON-RPC roundtrip via Cloudflare's
 * `createMcpHandler`. The McpServer is single-use — MCP SDK ≥1.26 throws on
 * server/transport reuse, and stateless rebuild keeps tenants isolated.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ctx } from '../types.js';
import { createTools } from '../tools.js';
import {
  retrieveWorklogsSchema,
  createWorklogSchema,
  bulkCreateWorklogsSchema,
  editWorklogSchema,
  deleteWorklogSchema,
  getMissingWorklogDaysSchema,
  getWorklogAnalyticsSchema,
} from '../types.js';
import { UserCredentials } from './storage.js';

const SERVER_NAME = 'tempo-mcp-server';
const SERVER_VERSION = '2.0.0-remote';

export function ctxFromCreds(creds: UserCredentials): Ctx {
  return {
    tempoApi: {
      baseUrl: 'https://api.tempo.io/4',
      token: creds.tempoApiToken,
    },
    jiraApi: {
      baseUrl: creds.jiraBaseUrl,
      token: creds.jiraApiToken,
      email: creds.jiraEmail,
      authType: creds.jiraAuthType,
      tempoAccountCustomFieldId: creds.jiraTempoAccountCustomFieldId,
    },
  };
}

export function buildMcpServer(creds: UserCredentials): McpServer {
  const ctx = ctxFromCreds(creds);
  const tools = createTools(ctx);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
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
        return errorResponse('retrieveWorklogs', error);
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
        return errorResponse('createWorklog', error);
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
        return errorResponse('bulkCreateWorklogs', error);
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
        return errorResponse('editWorklog', error);
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
        return errorResponse('deleteWorklog', error);
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
        return errorResponse('getMissingWorklogDays', error);
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
        return errorResponse('getWorklogAnalytics', error);
      }
    },
  );

  return server;
}

function errorResponse(toolName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] ${toolName} failed: ${message}`);
  return {
    content: [
      { type: 'text' as const, text: `Error in ${toolName}: ${message}` },
    ],
    isError: true,
  };
}
