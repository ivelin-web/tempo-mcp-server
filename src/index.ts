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
  async ({ issueKey, timeSpentHours, date, description, startTime }) => {
    try {
      const result = await tools.createWorklog(
        issueKey,
        timeSpentHours,
        date,
        description,
        startTime,
      );
      return {
        content: result.content,
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
  async ({ worklogId, timeSpentHours, description, date, startTime }) => {
    try {
      const result = await tools.editWorklog(
        worklogId,
        timeSpentHours,
        description || null,
        date || null,
        startTime || undefined,
      );
      return {
        content: result.content,
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
