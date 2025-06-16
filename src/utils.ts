import axios from 'axios';
import { getIssueKeyById } from './jira.js';

/**
 * Standard error handling for API errors
 * Extracts the most useful error message from Axios errors
 */
export function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as any)?.message || error.message;
  }
  return (error as Error).message;
}

/**
 * Get issue keys for worklogs
 * Maps Jira issue IDs to their corresponding issue keys
 */
export async function getIssueKeysMap(
  worklogs: any[],
): Promise<Record<string, string>> {
  // Extract unique issue IDs
  const uniqueIssueIds = [
    ...new Set(
      worklogs.map((worklog) => worklog.issue?.id).filter((id) => id != null),
    ),
  ];

  if (uniqueIssueIds.length === 0) return {};

  // Create issue ID to key map
  const issueIdToKeyMap: Record<string, string> = {};

  // Fetch issue keys in parallel
  await Promise.all(
    uniqueIssueIds.map(async (issueId) => {
      try {
        const issueKey = await getIssueKeyById(issueId);
        issueIdToKeyMap[issueId] = issueKey;
      } catch (error) {
        console.error(
          `Could not get key for issue ID ${issueId}: ${(error as Error).message}`,
        );
      }
    }),
  );

  return issueIdToKeyMap;
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
  // Parse the HH:MM format
  const [hours, minutes] = startTime.split(':').map((num) => parseInt(num, 10));

  // Create a Date object with today's date but with the given hours and minutes
  const startTimeDate = new Date();
  startTimeDate.setHours(hours, minutes, 0, 0);

  // Add the duration in milliseconds
  const endTimeDate = new Date(
    startTimeDate.getTime() + hoursSpent * 3600 * 1000,
  );

  // Format the end time as HH:MM
  const endTime = `${endTimeDate.getHours().toString().padStart(2, '0')}:${endTimeDate.getMinutes().toString().padStart(2, '0')}`;

  return endTime;
}
