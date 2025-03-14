import { z } from 'zod';

// Common validation schemas
export const dateSchema = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');
export const issueKeySchema = () => z.string().min(1, 'Issue key cannot be empty');
export const issueIdSchema = () => z.union([
  z.string().min(1, 'Issue ID cannot be empty'),
  z.number().int().positive('Issue ID must be a positive integer')
]);

// Environment validation
export const envSchema = z.object({
  TEMPO_API_TOKEN: z.string().min(1, 'TEMPO_API_TOKEN is required'),
  JIRA_BASE_URL: z.string().min(1, 'JIRA_BASE_URL is required'),
  JIRA_API_TOKEN: z.string().min(1, 'JIRA_API_TOKEN is required'),
  JIRA_EMAIL: z.string().min(1, 'JIRA_EMAIL is required'),
});

export type Env = z.infer<typeof envSchema>;

// Worklog entry schema
export const worklogEntrySchema = z.object({
  issueKey: issueKeySchema(),
  timeSpentHours: z.number().positive('Time spent must be positive'),
  date: dateSchema(),
  description: z.string().optional(),
});

export type WorklogEntry = z.infer<typeof worklogEntrySchema>;

// MCP tool schemas
export const retrieveWorklogsSchema = z.object({
  startDate: dateSchema(),
  endDate: dateSchema(),
});

export const createWorklogSchema = z.object({
  issueKey: issueKeySchema(),
  timeSpentHours: z.number().positive('Time spent must be positive'),
  date: dateSchema(),
  description: z.string().optional().default(''),
});

export const bulkCreateWorklogsSchema = z.object({
  worklogEntries: z.array(worklogEntrySchema).min(1, 'At least one worklog entry is required'),
});

export const editWorklogSchema = z.object({
  worklogId: z.string().min(1, 'Worklog ID is required'),
  timeSpentHours: z.number().positive('Time spent must be positive'),
  description: z.string().optional().nullable(),
  date: dateSchema().optional().nullable(),
});

export const deleteWorklogSchema = z.object({
  worklogId: z.string().min(1, 'Worklog ID is required'),
});

// API interfaces
export interface JiraUser {
  accountId: string;
  emailAddress: string;
  displayName?: string;
}

export interface TempoWorklog {
  tempoWorklogId: string;
  issueId: string;
  timeSpentSeconds: number;
  startDate: string;
  description?: string;
  author: {
    accountId: string;
  };
  billableSeconds?: number;
  remainingEstimateSeconds?: number;
  startTime?: string;
  attributes?: Array<any>;
}

// MCP response interfaces
export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  metadata?: Record<string, any>;
  isError?: boolean;
}

// Result tracking interfaces
export interface WorklogResult {
  issueKey: string;
  timeSpentHours: number;
  date: string;
  worklogId: string | null;
  success: boolean;
}

export interface WorklogError {
  issueKey: string;
  timeSpentHours: number;
  date: string;
  error: string;
} 

export interface Config {
  tempoApi: { baseUrl: string; token: string };
  jiraApi: { baseUrl: string; token: string; email: string };
  server: { name: string; version: string };
}