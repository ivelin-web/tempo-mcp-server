#!/usr/bin/env node
/**
 * Tempo MCP Server
 *
 * A simple Model Context Protocol server for managing Tempo worklogs with TypeScript.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import config from './config.js';
import * as tools from './tools.js';
import {
  retrieveWorklogsSchema,
  createWorklogSchema,
  bulkCreateWorklogsSchema,
  editWorklogSchema,
  deleteWorklogSchema,
  getMissingWorklogDaysSchema,
  getWorklogAnalyticsSchema,
} from './types.js';

// Create MCP server instance
const server = new McpServer({
  name: config.server.name,
  version: config.server.version,
});

// Tool: retrieveWorklogs - fetch worklogs between two dates
server.tool(
  'retrieveWorklogs',
  retrieveWorklogsSchema.shape,
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

// Tool: createWorklog - create a single worklog entry
server.tool(
  'createWorklog',
  createWorklogSchema.shape,
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

// Tool: bulkCreateWorklogs - create multiple worklog entries at once
server.tool(
  'bulkCreateWorklogs',
  bulkCreateWorklogsSchema.shape,
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

// Tool: editWorklog - modify an existing worklog entry
server.tool(
  'editWorklog',
  editWorklogSchema.shape,
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
        description || null,
        date || null,
        startTime || undefined,
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

// Tool: deleteWorklog - remove an existing worklog entry
server.tool(
  'deleteWorklog',
  deleteWorklogSchema.shape,
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

// Tool: getMissingWorklogDays - find working days with insufficient logged time
server.tool(
  'getMissingWorklogDays',
  "Find working days in a date range where the user's logged time is below the expected hours from their Tempo user-schedule. Holidays and non-working days are skipped automatically. Returns days with their expected vs logged hours, plus a per-issue breakdown for partially-logged days. Requires the 'Schemes' scope on the Tempo API token (in addition to 'Worklogs').",
  getMissingWorklogDaysSchema.shape,
  async ({ startDate, endDate, minHoursPerDay }) => {
    try {
      const result = await tools.getMissingWorklogDays(
        startDate,
        endDate,
        minHoursPerDay,
      );
      // Preserve isError so date-range / MAX_PAGES / 403 / etc. surface
      // as proper MCP errors, not successful responses with error text.
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

// Tool: getWorklogAnalytics - aggregate worklogs by issue/account/day/week/month
server.tool(
  'getWorklogAnalytics',
  "Aggregate worklogs in a date range and return hours, worklog count, and percentage per group, sorted by hours descending. groupBy options: 'issue' (default), 'account', 'day', 'week' (ISO 8601), 'month'. Note: 'account' grouping reads the _Account_ work attribute on each worklog — worklogs without an account attribute are bucketed as 'No account', so this grouping is only meaningful if your team uses Tempo accounts.",
  getWorklogAnalyticsSchema.shape,
  async ({ startDate, endDate, groupBy }) => {
    try {
      const result = await tools.getWorklogAnalytics(
        startDate,
        endDate,
        groupBy,
      );
      // Preserve isError so date-range / MAX_PAGES / etc. surface as
      // proper MCP errors, not successful responses with error text.
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

async function startServer(): Promise<void> {
  try {
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

startServer().catch((error) => {
  console.error(
    `[ERROR] Unhandled exception: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
