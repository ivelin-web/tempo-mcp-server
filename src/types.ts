import { z } from 'zod';

// Common validation schemas
export const dateSchema = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');
export const timeSchema = () => z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, 'Time must be in HH:MM format and in 15-minute increments');
export const timeSpentHoursSchema = () => z.number().positive('Time spent must be positive').refine(
  (val) => (val * 4) % 1 === 0,
  'Time spent must be in quarter-hour increments (0.25, 0.5, 0.75, 1, 1.25, etc.)'
);
export const issueKeySchema = () => z.string().min(1, 'Issue key cannot be empty');
export const issueIdSchema = () => z.union([
  z.string().min(1, 'Issue ID cannot be empty'),
  z.number().int().positive('Issue ID must be a positive integer')
]);
export const idOrKeySchema = () => z.union([
  issueKeySchema(),
  issueIdSchema()
]);

// Environment validation
export const envSchema = z.object({
  TEMPO_API_TOKEN: z.string().min(1, 'TEMPO_API_TOKEN is required'),
  JIRA_BASE_URL: z.string().min(1, 'JIRA_BASE_URL is required'),
  JIRA_API_TOKEN: z.string().min(1, 'JIRA_API_TOKEN is required'),
  JIRA_EMAIL: z.string().min(1, 'JIRA_EMAIL is required'),
  JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Worklog entry schema
export const worklogEntrySchema = z.object({
  issueKey: issueKeySchema(),
  timeSpentHours: timeSpentHoursSchema(),
  date: dateSchema(),
  description: z.string().optional(),
  startTime: timeSchema().optional(),
});

export type WorklogEntry = z.infer<typeof worklogEntrySchema>;

// MCP tool schemas
export const retrieveWorklogsSchema = z.object({
  startDate: dateSchema(),
  endDate: dateSchema(),
});

export const createWorklogSchema = z.object({
  issueKey: issueKeySchema(),
  timeSpentHours: timeSpentHoursSchema(),
  date: dateSchema(),
  description: z.string().optional().default(''),
  startTime: timeSchema().optional(),
});

export const bulkCreateWorklogsSchema = z.object({
  worklogEntries: z.array(worklogEntrySchema).min(1, 'At least one worklog entry is required'),
});

export const editWorklogSchema = z.object({
  worklogId: z.string().min(1, 'Worklog ID is required'),
  timeSpentHours: timeSpentHoursSchema(),
  description: z.string().optional().nullable(),
  date: dateSchema().optional().nullable(),
  startTime: timeSchema().optional(),
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
  startTime?: string;
  endTime?: string;
  account?: string;
}

export interface WorklogError {
  issueKey: string;
  timeSpentHours: number;
  date: string;
  error: string;
} 

export interface Config {
  tempoApi: { baseUrl: string; token: string };
  jiraApi: {
    baseUrl: string;
    token: string;
    email: string;
    /**
     * The id of the custom Jira field Id which links jira issues to Tempo accounts.
     * This must be set if your organization has configured a mandatory tempo custom work attribute of type "Account".
     * Example: "10234"
     */
    tempoAccountCustomFieldId?: string;
  };
  server: { name: string; version: string };
}