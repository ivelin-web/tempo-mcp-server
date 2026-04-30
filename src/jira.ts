import axios, { AxiosInstance } from 'axios';
import { JiraUser, issueIdSchema, idOrKeySchema, Ctx } from './types.js';

export interface JiraClient {
  getCurrentUserAccountId(): Promise<string>;
  getIssueInfoById(
    issueId: string | number,
  ): Promise<{ key: string; summary: string }>;
  getIssue(idOrKey: string | number): Promise<{
    id: string;
    key: string;
    tempoAccountId?: string;
  }>;
}

function basicAuthHeader(email: string, token: string): string {
  // btoa is available in both Node 16+ and the Workers runtime.
  return `Basic ${btoa(`${email}:${token}`)}`;
}

function formatJiraError(error: unknown, context: string): Error {
  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status;
    const message =
      error.response?.data?.message ||
      error.response?.data?.errorMessages?.join(', ') ||
      error.message;
    return new Error(`${context}: ${statusCode} - ${message}`);
  }
  return new Error(`${context}: ${(error as Error).message}`);
}

/**
 * Build a Jira API client bound to a specific Ctx.
 *
 * The returned object lazily constructs an Axios instance, refreshing it when
 * the Ctx-provided token rotates (OAuth path). For basic/bearer this is a
 * one-shot construction.
 */
export function createJiraClient(ctx: Ctx): JiraClient {
  let cached: { token: string; baseUrl: string; client: AxiosInstance } | null =
    null;

  async function client(): Promise<AxiosInstance> {
    let token = ctx.jiraApi.token;
    let baseUrl = ctx.jiraApi.baseUrl;

    if (ctx.refreshJira) {
      const r = await ctx.refreshJira();
      token = r.token;
      if (r.baseUrl) baseUrl = r.baseUrl;
    }

    if (cached && cached.token === token && cached.baseUrl === baseUrl) {
      return cached.client;
    }

    const authHeader =
      ctx.jiraApi.authType === 'basic'
        ? basicAuthHeader(ctx.jiraApi.email ?? '', token)
        : `Bearer ${token}`;

    const instance = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    cached = { token, baseUrl, client: instance };
    return instance;
  }

  return {
    /**
     * Get user's account ID.
     *
     * Uses /myself for all auth types — it returns the authenticated user's own
     * accountId regardless of basic / bearer / oauth, and avoids the email-based
     * /user/search which can return empty results when email visibility is
     * restricted by Atlassian privacy settings or scoped API token limits.
     *
     * Falls back to email search for basic auth if /myself fails, to preserve
     * backwards compatibility with edge cases where /myself is unavailable.
     */
    async getCurrentUserAccountId(): Promise<string> {
      const jiraApi = await client();
      try {
        const response = await jiraApi.get<JiraUser>('/rest/api/3/myself');
        return response.data.accountId;
      } catch (myselfError) {
        if (ctx.jiraApi.authType === 'basic' && ctx.jiraApi.email) {
          try {
            const response = await jiraApi.get<JiraUser[]>(
              '/rest/api/3/user/search',
              { params: { query: ctx.jiraApi.email } },
            );
            const users = response.data;
            const user = users?.find(
              (u) => u.emailAddress === ctx.jiraApi.email,
            );
            if (user) return user.accountId;
            if (users.length === 1) return users[0].accountId;

            const myselfMessage = formatJiraError(
              myselfError,
              'Jira /myself failed',
            ).message;
            throw new Error(
              `No user found with email: ${ctx.jiraApi.email}. ${myselfMessage}`,
            );
          } catch (searchError) {
            throw formatJiraError(searchError, 'Failed to get user account ID');
          }
        }
        throw formatJiraError(myselfError, 'Failed to get user account ID');
      }
    },

    /**
     * Get Jira issue key + summary by ID.
     */
    async getIssueInfoById(
      issueId: string | number,
    ): Promise<{ key: string; summary: string }> {
      try {
        const result = issueIdSchema().safeParse(issueId);
        if (!result.success) {
          throw new Error(
            result.error.issues[0].message || 'Issue ID validation failed',
          );
        }
        const jiraApi = await client();
        const response = await jiraApi.get(`/rest/api/3/issue/${issueId}`);
        return {
          key: response.data.key,
          summary: response.data.fields?.summary || '',
        };
      } catch (error) {
        throw formatJiraError(
          error,
          `Failed to get issue info for ID ${issueId}`,
        );
      }
    },

    /**
     * Get Jira issue from issue ID or key.
     */
    async getIssue(idOrKey: string | number): Promise<{
      id: string;
      key: string;
      tempoAccountId?: string;
    }> {
      try {
        const result = idOrKeySchema().safeParse(idOrKey);
        if (!result.success) {
          throw new Error(
            result.error.issues[0].message ||
              'Issue identifier validation failed',
          );
        }
        const jiraApi = await client();
        const response = await jiraApi.get(`/rest/api/3/issue/${idOrKey}`);

        const tempoAccountId = ctx.jiraApi.tempoAccountCustomFieldId
          ? response.data.fields[
              `customfield_${ctx.jiraApi.tempoAccountCustomFieldId}`
            ]?.id
          : undefined;

        return {
          id: response.data.id,
          key: response.data.key,
          ...(tempoAccountId ? { tempoAccountId } : {}),
        };
      } catch (error) {
        throw formatJiraError(error, `Failed to get issue for ${idOrKey}`);
      }
    },
  };
}
