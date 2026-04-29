import axios, { AxiosInstance } from 'axios';
import { JiraUser, issueIdSchema, idOrKeySchema } from './types.js';
import config from './config.js';
import { getOAuthToken, OAuthConfig } from './oauth.js';

// Build authorization header based on auth type
function getAuthHeader(): string {
  if (config.jiraApi.authType === 'bearer') {
    return `Bearer ${config.jiraApi.token}`;
  }
  // Basic auth (default)
  return `Basic ${Buffer.from(`${config.jiraApi.email}:${config.jiraApi.token}`).toString('base64')}`;
}

let _jiraApi: AxiosInstance | null = null;

async function getJiraApi(): Promise<AxiosInstance> {
  if (config.jiraApi.authType === 'oauth') {
    const oauthCfg: OAuthConfig = {
      clientId: config.jiraApi.oauthClientId!,
      clientSecret: config.jiraApi.oauthClientSecret!,
      siteUrl: config.jiraApi.baseUrl,
    };
    const { token, cloudId } = await getOAuthToken(oauthCfg);

    if (!_jiraApi) {
      _jiraApi = axios.create({
        baseURL: `https://api.atlassian.com/ex/jira/${cloudId}`,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
    }
    _jiraApi.defaults.headers.common.Authorization = `Bearer ${token}`;
    return _jiraApi;
  }

  // Jira API client with authentication
  if (!_jiraApi) {
    _jiraApi = axios.create({
      baseURL: config.jiraApi.baseUrl,
      headers: {
        Authorization: getAuthHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }
  return _jiraApi;
}

// Standardized error handling for Jira API
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
export async function getCurrentUserAccountId(): Promise<string> {
  const jiraApi = await getJiraApi();

  try {
    const response = await jiraApi.get<JiraUser>('/rest/api/3/myself');
    return response.data.accountId;
  } catch (myselfError) {
    // For basic auth, try the legacy email-search fallback
    if (config.jiraApi.authType === 'basic' && config.jiraApi.email) {
      try {
        const response = await jiraApi.get<JiraUser[]>(
          '/rest/api/3/user/search',
          { params: { query: config.jiraApi.email } },
        );
        const users = response.data;
        const user = users?.find(
          (u) => u.emailAddress === config.jiraApi.email,
        );
        if (user) return user.accountId;
        throw new Error(`No user found with email: ${config.jiraApi.email}`);
      } catch (searchError) {
        throw formatJiraError(searchError, 'Failed to get user account ID');
      }
    }
    throw formatJiraError(myselfError, 'Failed to get user account ID');
  }
}

/**
 * Get Jira issue key + summary by ID.
 * Used by tools that need to render human-friendly issue labels like
 * "PPSG-50 — [AI/Backend] Structural AI Generation of Localized".
 */
export async function getIssueInfoById(
  issueId: string | number,
): Promise<{ key: string; summary: string }> {
  try {
    const result = issueIdSchema().safeParse(issueId);
    if (!result.success) {
      throw new Error(
        result.error.errors[0].message || 'Issue ID validation failed',
      );
    }

    const jiraApi = await getJiraApi();
    const response = await jiraApi.get(`/rest/api/3/issue/${issueId}`);
    return {
      key: response.data.key,
      summary: response.data.fields?.summary || '',
    };
  } catch (error) {
    throw formatJiraError(error, `Failed to get issue info for ID ${issueId}`);
  }
}

/**
 * Get Jira issue from issue ID or key
 */
export async function getIssue(idOrKey: string | number): Promise<{
  id: string;
  key: string;
  /** If the issue has a Tempo account associated, this will be the account ID */
  tempoAccountId?: string;
}> {
  try {
    // Validate issue ID using the schema
    const result = idOrKeySchema().safeParse(idOrKey);
    if (!result.success) {
      throw new Error(
        result.error.errors[0].message || 'Issue identifier validation failed',
      );
    }

    const jiraApi = await getJiraApi();
    const response = await jiraApi.get(`/rest/api/3/issue/${idOrKey}`);

    // Find the Tempo account key
    const tempoAccountId = config.jiraApi.tempoAccountCustomFieldId
      ? response.data.fields[
          `customfield_${config.jiraApi.tempoAccountCustomFieldId}`
        ].id
      : undefined;

    const id = response.data.id;
    const key = response.data.key;

    return {
      id,
      key,
      ...(tempoAccountId ? { tempoAccountId } : {}),
    };
  } catch (error) {
    throw formatJiraError(error, `Failed to get issue for ${idOrKey}`);
  }
}
