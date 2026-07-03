import { z } from 'zod';

// Common validation schemas
export const dateSchema = () =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');
export const timeSchema = () =>
  z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM format');
export const issueKeySchema = () =>
  z.string().min(1, 'Issue key cannot be empty');
export const issueIdSchema = () =>
  z.union([
    z.string().min(1, 'Issue ID cannot be empty'),
    z.number().int().positive('Issue ID must be a positive integer'),
  ]);
export const idOrKeySchema = () => z.union([issueKeySchema(), issueIdSchema()]);

// Environment validation
export const envSchema = z
  .object({
    TEMPO_API_TOKEN: z.string().min(1, 'TEMPO_API_TOKEN is required'),
    JIRA_BASE_URL: z.string().min(1, 'JIRA_BASE_URL is required'),
    JIRA_API_TOKEN: z.string().optional(),
    JIRA_EMAIL: z.string().optional(),
    JIRA_AUTH_TYPE: z
      .enum(['basic', 'bearer', 'oauth'])
      .optional()
      .default('basic'),
    JIRA_OAUTH_CLIENT_ID: z.string().optional(),
    JIRA_OAUTH_CLIENT_SECRET: z.string().optional(),
    JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID: z.string().optional(),
  })
  .refine((data) => data.JIRA_AUTH_TYPE === 'oauth' || !!data.JIRA_API_TOKEN, {
    message: 'JIRA_API_TOKEN is required for basic and bearer authentication',
  })
  .refine(
    (data) =>
      data.JIRA_AUTH_TYPE === 'bearer' ||
      data.JIRA_AUTH_TYPE === 'oauth' ||
      !!data.JIRA_EMAIL,
    { message: 'JIRA_EMAIL is required when using basic authentication' },
  )
  .refine(
    (data) =>
      data.JIRA_AUTH_TYPE !== 'oauth' ||
      (!!data.JIRA_OAUTH_CLIENT_ID && !!data.JIRA_OAUTH_CLIENT_SECRET),
    {
      message:
        'JIRA_OAUTH_CLIENT_ID and JIRA_OAUTH_CLIENT_SECRET are required for OAuth authentication',
    },
  );

export type Env = z.infer<typeof envSchema>;

// Worklog entry schema
export const workAttributeSchema = z.object({
  key: z.string().min(1, 'Attribute key cannot be empty'),
  value: z.string().min(1, 'Attribute value cannot be empty'),
});

export type WorkAttribute = z.infer<typeof workAttributeSchema>;

export const worklogEntrySchema = z.object({
  issueKey: issueKeySchema(),
  timeSpentHours: z.number().positive('Time spent must be positive'),
  date: dateSchema(),
  description: z.string().optional(),
  startTime: timeSchema().optional(),
  attributes: z.array(workAttributeSchema).optional(),
});

export type WorklogEntry = z.infer<typeof worklogEntrySchema>;

// Author filter — lets the read tools target other users' worklogs instead of
// the token owner's. All fields resolve to Jira accountIds and are unioned
// when combined. Tempo enforces permissions server-side: worklogs the token
// owner may not view are silently omitted from results.
export const authorFilterShape = {
  users: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Fetch worklogs of these users instead of your own. Each entry may be an email, a display name, or a Jira accountId.',
    ),
  program: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Fetch worklogs of all current members of this Tempo Program (name or numeric id).',
    ),
  team: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Fetch worklogs of all current members of this Tempo Team (name or numeric id).',
    ),
};

export const authorFilterSchema = z.object(authorFilterShape);

export type AuthorFilter = z.infer<typeof authorFilterSchema>;

// MCP tool schemas
export const retrieveWorklogsSchema = z.object({
  startDate: dateSchema(),
  endDate: dateSchema(),
  ...authorFilterShape,
});

export const createWorklogSchema = z.object({
  issueKey: issueKeySchema(),
  timeSpentHours: z.number().positive('Time spent must be positive'),
  date: dateSchema(),
  description: z.string().optional().default(''),
  startTime: timeSchema().optional(),
  attributes: z.array(workAttributeSchema).optional(),
});

export const bulkCreateWorklogsSchema = z.object({
  worklogEntries: z
    .array(worklogEntrySchema)
    .min(1, 'At least one worklog entry is required'),
});

export const editWorklogSchema = z.object({
  worklogId: z.string().min(1, 'Worklog ID is required'),
  timeSpentHours: z.number().positive('Time spent must be positive'),
  description: z.string().optional().nullable(),
  date: dateSchema().optional().nullable(),
  startTime: timeSchema().optional(),
  attributes: z.array(workAttributeSchema).optional(),
});

export const deleteWorklogSchema = z.object({
  worklogId: z.string().min(1, 'Worklog ID is required'),
});

export const getMissingWorklogDaysSchema = z.object({
  startDate: dateSchema(),
  endDate: dateSchema(),
  minHoursPerDay: z
    .number()
    .positive('minHoursPerDay must be positive')
    .optional(),
  ...authorFilterShape,
});

export const analyticsGroupBySchema = z.enum([
  'issue',
  'account',
  'user',
  'day',
  'week',
  'month',
]);

export type AnalyticsGroupBy = z.infer<typeof analyticsGroupBySchema>;

export const getWorklogAnalyticsSchema = z.object({
  startDate: dateSchema(),
  endDate: dateSchema(),
  groupBy: analyticsGroupBySchema.optional().default('issue'),
  ...authorFilterShape,
});

// API interfaces
export interface JiraUser {
  accountId: string;
  emailAddress?: string;
  displayName?: string;
  /** 'atlassian' for humans; 'app' / 'customer' accounts can't log Tempo time. */
  accountType?: string;
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
  attributes?: {
    self?: string;
    values: Array<{ key: string; value: string }>;
  };
}

// MCP response interfaces
export interface ToolResponse {
  content: Array<{
    type: 'text';
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

// Tempo user-schedule API
export type DayScheduleType =
  | 'WORKING_DAY'
  | 'NON_WORKING_DAY'
  | 'HOLIDAY'
  | 'HOLIDAY_AND_NON_WORKING_DAY';

export interface DaySchedule {
  date: string;
  requiredSeconds: number;
  type: DayScheduleType;
  holiday?: { name?: string } | null;
}

export interface MissingWorklogDay {
  date: string;
  type: DayScheduleType;
  expectedHours: number;
  loggedHours: number;
  missingHours: number;
  holiday?: string;
  loggedBreakdown?: { issueId: string; hours: number }[];
}

export interface AnalyticsGroup {
  key: string;
  hours: number;
  worklogCount: number;
  percentage: number;
}

export interface Config {
  tempoApi: { baseUrl: string; token: string };
  jiraApi: {
    baseUrl: string;
    token?: string;
    email?: string;
    /**
     * Authentication type for Jira API.
     * - 'basic': Uses Basic Auth with email:token (default, requires JIRA_EMAIL + JIRA_API_TOKEN)
     * - 'bearer': Uses Bearer token auth (requires JIRA_API_TOKEN)
     * - 'oauth': Uses OAuth 2.0 with PKCE (requires JIRA_OAUTH_CLIENT_ID + JIRA_OAUTH_CLIENT_SECRET)
     */
    authType: 'basic' | 'bearer' | 'oauth';
    oauthClientId?: string;
    oauthClientSecret?: string;
    /**
     * The id of the custom Jira field Id which links jira issues to Tempo accounts.
     * This must be set if your organization has configured a mandatory tempo custom work attribute of type "Account".
     * Example: "10234"
     */
    tempoAccountCustomFieldId?: string;
  };
  server: { name: string; version: string };
}

/**
 * Per-request context that drives Tempo + Jira API calls.
 *
 * Both transports (stdio and the Cloudflare Worker) build a Ctx and hand it
 * to the tools/jira factories. Stdio derives Ctx from process.env once at
 * startup; the Worker derives a fresh Ctx per user from KV-stored credentials.
 *
 * `refreshJira` is the seam that lets stdio support OAuth 2.0 PKCE without
 * bundling oauth.ts (which uses fs/http/os) into the Worker. When set, the
 * Jira factory invokes it before each request to swap in a freshly-refreshed
 * access token. The Worker path leaves it undefined.
 */
export interface Ctx {
  tempoApi: { baseUrl: string; token: string };
  jiraApi: {
    /** Site URL for basic/bearer, or api.atlassian.com/ex/jira/{cloudId} for oauth. */
    baseUrl: string;
    /** Static fallback token. Ignored when `refreshJira` is set. */
    token: string;
    /** Required for basic auth. */
    email?: string;
    authType: 'basic' | 'bearer' | 'oauth';
    tempoAccountCustomFieldId?: string;
  };
  /**
   * Resolves the current Jira bearer token. Set by stdio's OAuth path; left
   * undefined for basic/bearer auth and for the Worker path. May also return a
   * `baseUrl` override (the OAuth flow needs to swap to the Atlassian gateway
   * once the cloudId is known).
   */
  refreshJira?: () => Promise<{ token: string; baseUrl?: string }>;
}
