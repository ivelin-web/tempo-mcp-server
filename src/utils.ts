import axios, { AxiosInstance } from 'axios';
import { JiraClient } from './jira.js';

/**
 * Standard error handling for API errors
 * Extracts the most useful error message from Axios errors.
 * Tempo wraps messages as { errors: [{ message }] }, Jira as
 * { errorMessages: [...] } or { message } — check all three before falling
 * back to Axios' generic "Request failed with status code N".
 */
export function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any;
    const tempoErrors = Array.isArray(data?.errors)
      ? data.errors
          .map((e: any) => e?.message)
          .filter(Boolean)
          .join('; ')
      : '';
    const jiraErrors = Array.isArray(data?.errorMessages)
      ? data.errorMessages.join(', ')
      : '';
    return data?.message || tempoErrors || jiraErrors || error.message;
  }
  return (error as Error).message;
}

/**
 * Run an async mapper over items with bounded concurrency.
 * Preserves input order in the returned array. Used to keep multi-user
 * fan-out (schedules, issue lookups, team members) under Jira/Tempo rate
 * limits instead of firing an unbounded Promise.all.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await fn(items[current], current);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Fetch every page of a paginated Tempo GET endpoint by following
 * `metadata.next`. The next URLs are absolute, which makes Axios ignore the
 * instance baseURL while still applying its auth headers.
 */
export async function fetchAllTempoPages(
  api: AxiosInstance,
  path: string,
  params: Record<string, unknown>,
  maxPages = 500,
): Promise<any[]> {
  let all: any[] = [];
  let nextUrl: string | null = null;
  let isFirstRequest = true;
  let pageCount = 0;

  do {
    if (pageCount >= maxPages) {
      throw new Error(
        `Reached maximum page limit (${maxPages}) while fetching ${path}.`,
      );
    }
    let response;
    if (isFirstRequest) {
      response = await api.get(path, { params });
      isFirstRequest = false;
    } else {
      response = await api.get(nextUrl!);
    }

    all = all.concat(response.data?.results || []);
    nextUrl = response.data?.metadata?.next || null;
    pageCount++;
  } while (nextUrl);

  return all;
}

/**
 * Extract unique Jira issue IDs from a list of worklogs.
 */
export function extractWorklogIssueIds(worklogs: any[]): string[] {
  return [
    ...new Set(
      worklogs
        .map((w) => w.issue?.id)
        .filter((id) => id != null)
        .map(String),
    ),
  ];
}

/**
 * Resolve Jira issue IDs to { key, summary } in parallel.
 * Used by tools that group/display worklogs by issue. Failed lookups are
 * silently dropped — callers fall back to "Issue {id}" / "Unknown issue"
 * labels so a single deleted issue doesn't break the whole response.
 */
export async function getIssueInfoMap(
  jira: JiraClient,
  issueIds: (string | number)[],
): Promise<Record<string, { key: string; summary: string }>> {
  const unique = [...new Set(issueIds.map(String))];
  if (unique.length === 0) return {};

  const map: Record<string, { key: string; summary: string }> = {};
  await mapWithConcurrency(unique, 8, async (issueId) => {
    try {
      map[issueId] = await jira.getIssueInfoById(issueId);
    } catch (error) {
      console.error(
        `Could not get info for issue ID ${issueId}: ${(error as Error).message}`,
      );
    }
  });

  return map;
}

/**
 * Format hours, dropping trailing zeros: 7.50 -> "7.5h", 30 -> "30h",
 * 7.25 -> "7.25h". Caps precision at 2 decimals.
 */
export function formatHours(hours: number): string {
  return `${parseFloat(hours.toFixed(2))}h`;
}

/**
 * Format percentage similarly: 50.0 -> "50%", 25.5 -> "25.5%".
 * Caps precision at 1 decimal.
 */
export function formatPercent(percent: number): string {
  return `${parseFloat(percent.toFixed(1))}%`;
}

/**
 * Calculate end time
 * Calculates the end time based on the start time and hours spent
 * @param startTime Time in format HH:MM
 * @param hoursSpent Duration in hours (can be decimal)
 * @returns End time in format HH:MM
 */
export function calculateEndTime(
  startTime: string,
  hoursSpent: number,
): string {
  const [hours, minutes] = startTime.split(':').map((num) => parseInt(num, 10));

  const startTimeDate = new Date();
  startTimeDate.setHours(hours, minutes, 0, 0);

  const endTimeDate = new Date(
    startTimeDate.getTime() + hoursSpent * 3600 * 1000,
  );

  const endTime = `${endTimeDate.getHours().toString().padStart(2, '0')}:${endTimeDate.getMinutes().toString().padStart(2, '0')}`;

  return endTime;
}
