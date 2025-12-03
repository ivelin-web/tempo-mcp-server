import axios from 'axios';
import { JiraUser, issueIdSchema, idOrKeySchema } from './types.js';
import config from './config.js';

// Build authorization header based on auth type
function getAuthHeader(): string {
  if (config.jiraApi.authType === 'bearer') {
    return `Bearer ${config.jiraApi.token}`;
  }
  // Basic auth (default)
  return `Basic ${Buffer.from(`${config.jiraApi.email}:${config.jiraApi.token}`).toString('base64')}`;
}

// Jira API client with authentication
const jiraApi = axios.create({
  baseURL: config.jiraApi.baseUrl,
  headers: {
    Authorization: getAuthHeader(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

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
 * - For Bearer auth: uses /myself endpoint
 * - For Basic auth: searches by configured email
 */
export async function getCurrentUserAccountId(): Promise<string> {
  try {
    if (config.jiraApi.authType === 'bearer') {
      // Bearer auth: get current user directly
      const response = await jiraApi.get<JiraUser>('/rest/api/3/myself');
      return response.data.accountId;
    }

    // Basic auth: search by email
    const response = await jiraApi.get<JiraUser[]>('/rest/api/3/user/search', {
      params: { query: config.jiraApi.email },
    });

    const users = response.data;
    if (!users || users.length === 0) {
      throw new Error(`No user found with email: ${config.jiraApi.email}`);
    }

    // Find exact email match
    const user = users.find((u) => u.emailAddress === config.jiraApi.email);
    if (!user) {
      throw new Error(`No exact match for email: ${config.jiraApi.email}`);
    }

    return user.accountId;
  } catch (error) {
    throw formatJiraError(error, 'Failed to get user account ID');
  }
}

/**
 * Get Jira issue key from issue ID
 */
export async function getIssueKeyById(
  issueId: string | number,
): Promise<string> {
  try {
    // Validate issue ID using the schema
    const result = issueIdSchema().safeParse(issueId);
    if (!result.success) {
      throw new Error(
        result.error.errors[0].message || 'Issue ID validation failed',
      );
    }

    const response = await jiraApi.get(`/rest/api/3/issue/${issueId}`);
    return response.data.key;
  } catch (error) {
    throw formatJiraError(error, `Failed to get issue key for ID ${issueId}`);
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
