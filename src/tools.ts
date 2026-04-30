import axios from 'axios';
import {
  ToolResponse,
  TempoWorklog,
  WorkAttribute,
  WorklogResult,
  WorklogError,
  WorklogEntry,
  DaySchedule,
  MissingWorklogDay,
  AnalyticsGroup,
  AnalyticsGroupBy,
  Ctx,
} from './types.js';
import { createJiraClient, JiraClient } from './jira.js';
import {
  formatError,
  getIssueInfoMap,
  extractWorklogIssueIds,
  calculateEndTime,
  formatHours,
  formatPercent,
} from './utils.js';

// Tempo's /worklogs endpoints accept up to limit=1000 per page (sibling
// endpoints cap at 5000; 1000 is the documented safe practical cap).
const TEMPO_PAGE_LIMIT = 1000;

// Safety cap on total pages — protects against an infinite loop if Tempo's
// `metadata.next` ever fails to terminate. At limit=1000 this is 500,000
// worklogs / 100,000 schedule entries, well beyond any realistic query.
const MAX_PAGES = 500;

export interface Tools {
  retrieveWorklogs(startDate: string, endDate: string): Promise<ToolResponse>;
  createWorklog(
    issueKey: string,
    timeSpentHours: number,
    date: string,
    description?: string,
    startTime?: string,
    attributes?: WorkAttribute[],
  ): Promise<ToolResponse>;
  bulkCreateWorklogs(worklogEntries: WorklogEntry[]): Promise<ToolResponse>;
  editWorklog(
    worklogId: string,
    timeSpentHours: number,
    description?: string | null,
    date?: string | null,
    startTime?: string,
    attributes?: WorkAttribute[],
  ): Promise<ToolResponse>;
  deleteWorklog(worklogId: string): Promise<ToolResponse>;
  getMissingWorklogDays(
    startDate: string,
    endDate: string,
    minHoursPerDay?: number,
  ): Promise<ToolResponse>;
  getWorklogAnalytics(
    startDate: string,
    endDate: string,
    groupBy?: AnalyticsGroupBy,
  ): Promise<ToolResponse>;
}

export function createTools(ctx: Ctx, jira?: JiraClient): Tools {
  const jiraClient = jira ?? createJiraClient(ctx);

  // Tempo API tokens are static (no refresh) so a single Axios instance is fine.
  const api = axios.create({
    baseURL: ctx.tempoApi.baseUrl,
    headers: {
      Authorization: `Bearer ${ctx.tempoApi.token}`,
      'Content-Type': 'application/json',
    },
  });

  // Helper: paginated fetch from Tempo `metadata.next` URLs.
  // Tempo's "next" URLs are absolute and don't include the bearer header —
  // we re-attach it on each follow-up request.
  async function fetchAllWorklogs(
    startDate: string,
    endDate: string,
  ): Promise<{ worklogs: any[]; pagesProcessed: number }> {
    const accountId = await jiraClient.getCurrentUserAccountId();

    let allWorklogs: any[] = [];
    let nextUrl: string | null = null;
    let isFirstRequest = true;
    let pageCount = 0;

    do {
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Reached maximum page limit (${MAX_PAGES}) while fetching worklogs ` +
            `for ${startDate}..${endDate}. Results would be incomplete — ` +
            `narrow the date range and try again.`,
        );
      }

      let response;
      if (isFirstRequest) {
        response = await api.get(`/worklogs/user/${accountId}`, {
          params: { from: startDate, to: endDate, limit: TEMPO_PAGE_LIMIT },
        });
        isFirstRequest = false;
      } else {
        response = await axios.get(nextUrl!, {
          headers: {
            Authorization: `Bearer ${ctx.tempoApi.token}`,
            'Content-Type': 'application/json',
          },
        });
      }

      const pageWorklogs = response.data.results || [];
      allWorklogs = allWorklogs.concat(pageWorklogs);

      nextUrl = response.data.metadata?.next || null;
      pageCount++;
    } while (nextUrl);

    return { worklogs: allWorklogs, pagesProcessed: pageCount };
  }

  async function fetchTempoAccountFromIssue({
    tempoAccountId,
  }: {
    tempoAccountId?: string;
  }) {
    return tempoAccountId ? await retrieveAccount(tempoAccountId) : undefined;
  }

  async function retrieveAccount(
    id: string,
  ): Promise<{ key: string; name: string }> {
    const response = await api.get(`/accounts/${id}`);
    return response.data;
  }

  async function fetchUserSchedule(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<DaySchedule[]> {
    let allDays: DaySchedule[] = [];
    let nextUrl: string | null = null;
    let isFirstRequest = true;
    let pageCount = 0;

    try {
      do {
        if (pageCount >= MAX_PAGES) {
          throw new Error(
            `Reached maximum page limit (${MAX_PAGES}) while fetching user ` +
              `schedule for ${startDate}..${endDate}. Results would be ` +
              `incomplete — narrow the date range and try again.`,
          );
        }

        let response;
        if (isFirstRequest) {
          response = await api.get(`/user-schedule/${accountId}`, {
            params: { from: startDate, to: endDate, limit: TEMPO_PAGE_LIMIT },
          });
          isFirstRequest = false;
        } else {
          response = await axios.get(nextUrl!, {
            headers: {
              Authorization: `Bearer ${ctx.tempoApi.token}`,
              'Content-Type': 'application/json',
            },
          });
        }

        const days: DaySchedule[] = Array.isArray(response.data)
          ? response.data
          : response.data.results || [];
        allDays = allDays.concat(days);

        nextUrl = Array.isArray(response.data)
          ? null
          : response.data.metadata?.next || null;
        pageCount++;
      } while (nextUrl);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(
          'Tempo API returned 403 for /user-schedule. Your TEMPO_API_TOKEN ' +
            'is missing the "Schemes" scope (which covers Workload Schemes, ' +
            'Holiday Schemes, and User Schedule). Tempo does not allow ' +
            'modifying scopes on an existing token — create a new token at ' +
            'Tempo > Settings > API Integration with both "Worklogs" and ' +
            '"Schemes" scopes, then update TEMPO_API_TOKEN.',
        );
      }
      throw error;
    }

    return allDays;
  }

  function validateDateRange(
    startDate: string,
    endDate: string,
  ): ToolResponse | null {
    if (startDate > endDate) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid range: startDate (${startDate}) must be on or before endDate (${endDate}).`,
          },
        ],
      };
    }
    return null;
  }

  return {
    async retrieveWorklogs(
      startDate: string,
      endDate: string,
    ): Promise<ToolResponse> {
      try {
        const { worklogs, pagesProcessed } = await fetchAllWorklogs(
          startDate,
          endDate,
        );

        if (worklogs.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No worklogs found for the specified date range.',
              },
            ],
          };
        }

        const issueInfoMap = await getIssueInfoMap(
          jiraClient,
          extractWorklogIssueIds(worklogs),
        );

        const formattedContent = worklogs.map((worklog: any) => {
          const tempoWorklogId = worklog.tempoWorklogId || 'Unknown';
          const issueId = worklog.issue?.id || 'Unknown';
          const issueKey = issueInfoMap[issueId]?.key || 'Unknown';
          const description = worklog.description || 'No description';
          const timeSpentHours = (worklog.timeSpentSeconds / 3600).toFixed(2);
          const date = worklog.startDate || 'Unknown';
          const startTime = worklog.startTime || '';
          const attributeValues = worklog.attributes?.values;
          const attributesInfo = attributeValues?.length
            ? ` | Attributes: ${JSON.stringify(attributeValues)}`
            : '';

          return {
            type: 'text' as const,
            text: `TempoWorklogId: ${tempoWorklogId} | IssueKey: ${issueKey} | IssueId: ${issueId} | Date: ${date}${startTime ? ` | StartTime: ${startTime}` : ''} | Hours: ${timeSpentHours} | Description: ${description}${attributesInfo}`,
          };
        });

        return {
          content: formattedContent,
          metadata: {
            totalCount: worklogs.length,
            pagesProcessed,
            startDate,
            endDate,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error retrieving worklogs: ${formatError(error)}`,
            },
          ],
        };
      }
    },

    async createWorklog(
      issueKey: string,
      timeSpentHours: number,
      date: string,
      description: string = '',
      startTime: string | undefined = undefined,
      attributes?: WorkAttribute[],
    ): Promise<ToolResponse> {
      try {
        const issue = await jiraClient.getIssue(issueKey);
        const accountId = await jiraClient.getCurrentUserAccountId();

        const account = await fetchTempoAccountFromIssue(issue);

        const { id: issueId } = issue;
        const attributesArray = mergeAttributes(account, attributes);
        const payload = {
          issueId: Number(issueId),
          timeSpentSeconds: Math.round(timeSpentHours * 3600),
          startDate: date,
          authorAccountId: accountId,
          description,
          ...(startTime && { startTime: `${startTime}:00` }),
          ...(attributesArray.length > 0 && { attributes: attributesArray }),
        };

        const response = await api.post('/worklogs', payload);

        let timeInfo = '';
        if (startTime) {
          const endTime = calculateEndTime(startTime, timeSpentHours);
          timeInfo = ` starting at ${startTime} and ending at ${endTime}`;
        }

        const accountInfo = account ? ` with account '${account.name}'` : '';
        const userAttrInfo =
          attributes && attributes.length > 0
            ? ` with attributes: ${attributes.map((a) => `${a.key}=${a.value}`).join(', ')}`
            : '';

        return {
          content: [
            {
              type: 'text',
              text: `Worklog with ID ${response.data.tempoWorklogId} created successfully for ${issueKey}${accountInfo}${userAttrInfo}. Time logged: ${timeSpentHours} hours on ${date}${timeInfo}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to create worklog: ${formatError(error)}`,
            },
          ],
        };
      }
    },

    async bulkCreateWorklogs(
      worklogEntries: WorklogEntry[],
    ): Promise<ToolResponse> {
      try {
        const authorAccountId = await jiraClient.getCurrentUserAccountId();

        const entriesByIssueKey: Record<string, WorklogEntry[]> = {};
        worklogEntries.forEach((entry) => {
          if (!entriesByIssueKey[entry.issueKey]) {
            entriesByIssueKey[entry.issueKey] = [];
          }
          entriesByIssueKey[entry.issueKey].push(entry);
        });

        const results: WorklogResult[] = [];
        const errors: WorklogError[] = [];

        for (const [issueKey, entries] of Object.entries(entriesByIssueKey)) {
          try {
            const issue = await jiraClient.getIssue(issueKey);

            const account = await fetchTempoAccountFromIssue(issue);

            const formattedEntries = entries.map((entry) => {
              const attributesArray = mergeAttributes(
                account,
                entry.attributes,
              );
              return {
                timeSpentSeconds: Math.round(entry.timeSpentHours * 3600),
                startDate: entry.date,
                authorAccountId,
                description: entry.description || '',
                ...(entry.startTime && { startTime: `${entry.startTime}:00` }),
                ...(attributesArray.length > 0 && {
                  attributes: attributesArray,
                }),
              };
            });

            const { id: issueId } = issue;

            const response = await api.post(
              `/worklogs/issue/${Number(issueId)}/bulk`,
              formattedEntries,
            );
            const createdWorklogs = response.data || [];

            entries.forEach((entry, i) => {
              const created = createdWorklogs[i] || null;

              let endTime = undefined;
              if (entry.startTime && created) {
                endTime = calculateEndTime(
                  entry.startTime,
                  entry.timeSpentHours,
                );
              }

              results.push({
                issueKey,
                timeSpentHours: entry.timeSpentHours,
                date: entry.date,
                worklogId: created?.tempoWorklogId || null,
                success: !!created,
                startTime: entry.startTime,
                endTime,
                account: account?.name,
              });
            });
          } catch (error) {
            const errorMessage = formatError(error);

            entries.forEach((entry) => {
              errors.push({
                issueKey,
                timeSpentHours: entry.timeSpentHours,
                date: entry.date,
                error: errorMessage,
              });
            });
          }
        }

        const content: Array<{ type: 'text'; text: string }> = [];
        const successCount = results.filter((r) => r.success).length;

        if (successCount > 0) {
          content.push({
            type: 'text',
            text: `Successfully created ${successCount} worklogs:`,
          });

          results
            .filter((r) => r.success)
            .forEach((result) => {
              let timeInfo = '';
              if (result.startTime) {
                timeInfo = ` starting at ${result.startTime}${result.endTime ? ` and ending at ${result.endTime}` : ''}`;
              }

              const accountInfo = result.account
                ? ` for account '${result.account}'`
                : '';

              content.push({
                type: 'text',
                text: `- Issue ${result.issueKey}: ${result.timeSpentHours} hours on ${result.date}${timeInfo}${accountInfo}`,
              });
            });
        }

        if (errors.length > 0) {
          content.push({
            type: 'text',
            text: `Failed to create ${errors.length} worklogs:`,
          });

          errors.forEach((error) => {
            content.push({
              type: 'text',
              text: `- Issue ${error.issueKey}: ${error.timeSpentHours} hours on ${error.date}. Error: ${error.error}`,
            });
          });
        }

        return {
          content,
          metadata: {
            totalSuccess: successCount,
            totalFailure: errors.length,
            details: {
              successes: results.filter((r) => r.success),
              failures: errors,
            },
          },
          isError: errors.length > 0 && successCount === 0,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error processing bulk worklogs: ${formatError(error)}`,
            },
          ],
        };
      }
    },

    async editWorklog(
      worklogId: string,
      timeSpentHours: number,
      description: string | null = null,
      date: string | null = null,
      startTime: string | undefined = undefined,
      attributes?: WorkAttribute[],
    ): Promise<ToolResponse> {
      try {
        const response = await api.get<TempoWorklog>(`/worklogs/${worklogId}`);
        const worklog = response.data;

        const existingAttributes: WorkAttribute[] = (
          worklog.attributes?.values || []
        ).map((attr) => ({ key: attr.key, value: attr.value }));
        const mergedAttributes = mergeExistingWithUserAttributes(
          existingAttributes,
          attributes,
        );

        const updatePayload = {
          authorAccountId: worklog.author.accountId,
          startDate: date || worklog.startDate,
          timeSpentSeconds: Math.round(timeSpentHours * 3600),
          billableSeconds: Math.round(timeSpentHours * 3600),
          ...(description !== null && { description }),
          ...(startTime && { startTime: `${startTime}:00` }),
          ...(mergedAttributes.length > 0 && { attributes: mergedAttributes }),
        };

        await api.put(`/worklogs/${worklogId}`, updatePayload);

        let updateInfo = `Worklog updated successfully`;

        if (startTime) {
          const endTime = calculateEndTime(startTime, timeSpentHours);
          updateInfo += `. Time logged: ${timeSpentHours} hours starting at ${startTime} and ending at ${endTime}`;
        }

        return {
          content: [{ type: 'text', text: updateInfo }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to edit worklog: ${formatError(error)}`,
            },
          ],
        };
      }
    },

    async deleteWorklog(worklogId: string): Promise<ToolResponse> {
      try {
        try {
          await api.get<TempoWorklog>(`/worklogs/${worklogId}`);
        } catch (error) {
          console.error(
            `Could not fetch worklog details: ${(error as Error).message}`,
          );
        }

        await api.delete(`/worklogs/${worklogId}`);

        return {
          content: [{ type: 'text', text: 'Worklog deleted successfully' }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to delete worklog: ${formatError(error)}`,
            },
          ],
        };
      }
    },

    async getMissingWorklogDays(
      startDate: string,
      endDate: string,
      minHoursPerDay?: number,
    ): Promise<ToolResponse> {
      const rangeError = validateDateRange(startDate, endDate);
      if (rangeError) return rangeError;

      try {
        const accountId = await jiraClient.getCurrentUserAccountId();

        const [schedule, { worklogs }] = await Promise.all([
          fetchUserSchedule(accountId, startDate, endDate),
          fetchAllWorklogs(startDate, endDate),
        ]);

        if (schedule.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No user-schedule entries returned by Tempo for ${startDate} to ${endDate}. The user may not have a workload scheme configured for this period.`,
              },
            ],
            metadata: {
              totalMissingDays: 0,
              totalMissingHours: 0,
              startDate,
              endDate,
            },
          };
        }

        const loggedByDate = new Map<string, Map<string, number>>();
        for (const w of worklogs) {
          const date = w.startDate;
          if (!date) continue;
          const issueId = w.issue?.id ? String(w.issue.id) : 'unknown';
          const issueMap = loggedByDate.get(date) ?? new Map<string, number>();
          issueMap.set(
            issueId,
            (issueMap.get(issueId) ?? 0) + Number(w.timeSpentSeconds ?? 0),
          );
          loggedByDate.set(date, issueMap);
        }

        const overrideSeconds =
          minHoursPerDay !== undefined
            ? Math.round(minHoursPerDay * 3600)
            : null;

        const missing: MissingWorklogDay[] = [];
        for (const day of schedule) {
          if (day.requiredSeconds <= 0) continue;

          const requiredSeconds = overrideSeconds ?? day.requiredSeconds;
          const dayIssues = loggedByDate.get(day.date);
          const loggedSeconds = dayIssues
            ? Array.from(dayIssues.values()).reduce((s, v) => s + v, 0)
            : 0;
          if (loggedSeconds >= requiredSeconds) continue;

          const breakdown = dayIssues
            ? Array.from(dayIssues.entries()).map(([issueId, seconds]) => ({
                issueId,
                hours: seconds / 3600,
              }))
            : [];

          missing.push({
            date: day.date,
            type: day.type,
            expectedHours: requiredSeconds / 3600,
            loggedHours: loggedSeconds / 3600,
            missingHours: (requiredSeconds - loggedSeconds) / 3600,
            ...(day.holiday?.name ? { holiday: day.holiday.name } : {}),
            ...(breakdown.length > 0 ? { loggedBreakdown: breakdown } : {}),
          });
        }

        const partialIssueIds = new Set<string>();
        for (const m of missing) {
          for (const b of m.loggedBreakdown ?? []) {
            if (b.issueId !== 'unknown') partialIssueIds.add(b.issueId);
          }
        }
        const issueInfoMap =
          partialIssueIds.size > 0
            ? await getIssueInfoMap(jiraClient, Array.from(partialIssueIds))
            : {};

        if (missing.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `All working days between ${startDate} and ${endDate} meet the expected hours.`,
              },
            ],
            metadata: {
              totalMissingDays: 0,
              totalMissingHours: 0,
              startDate,
              endDate,
            },
          };
        }

        const totalMissingHours = missing.reduce(
          (sum, d) => sum + d.missingHours,
          0,
        );

        const dayWord = missing.length === 1 ? 'day' : 'days';
        const lines: string[] = [
          `Found ${missing.length} ${dayWord} with missing worklogs · ${startDate} to ${endDate}`,
          `Total missing: ${formatHours(totalMissingHours)}`,
          '',
        ];
        for (const d of missing) {
          const typeBadge = d.type === 'WORKING_DAY' ? '' : ` [${d.type}]`;
          const holidayBadge = d.holiday ? ` (${d.holiday})` : '';
          lines.push(
            `${d.date}${typeBadge}${holidayBadge} — missing ${formatHours(d.missingHours)} (${formatHours(d.loggedHours)} of ${formatHours(d.expectedHours)} logged)`,
          );
          for (const b of d.loggedBreakdown ?? []) {
            const info = issueInfoMap[b.issueId];
            const label = info
              ? info.summary
                ? `${info.key} — ${info.summary}`
                : info.key
              : b.issueId === 'unknown'
                ? 'Unknown issue'
                : `Issue ${b.issueId}`;
            lines.push(`    ${label}: ${formatHours(b.hours)}`);
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          metadata: {
            totalMissingDays: missing.length,
            totalMissingHours,
            startDate,
            endDate,
            details: missing,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to get missing worklog days: ${formatError(error)}`,
            },
          ],
        };
      }
    },

    async getWorklogAnalytics(
      startDate: string,
      endDate: string,
      groupBy: AnalyticsGroupBy = 'issue',
    ): Promise<ToolResponse> {
      const rangeError = validateDateRange(startDate, endDate);
      if (rangeError) return rangeError;

      try {
        const { worklogs } = await fetchAllWorklogs(startDate, endDate);

        if (worklogs.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No worklogs found between ${startDate} and ${endDate}.`,
              },
            ],
            metadata: {
              totalHours: 0,
              totalWorklogs: 0,
              groupBy,
              startDate,
              endDate,
            },
          };
        }

        let issueInfoMap: Record<string, { key: string; summary: string }> = {};
        if (groupBy === 'issue') {
          issueInfoMap = await getIssueInfoMap(
            jiraClient,
            extractWorklogIssueIds(worklogs),
          );
        }

        const buckets = new Map<string, { seconds: number; count: number }>();
        for (const w of worklogs) {
          const key = computeGroupKey(w, groupBy, issueInfoMap);
          const bucket = buckets.get(key) ?? { seconds: 0, count: 0 };
          bucket.seconds += Number(w.timeSpentSeconds ?? 0);
          bucket.count += 1;
          buckets.set(key, bucket);
        }

        const totalSeconds = Array.from(buckets.values()).reduce(
          (s, b) => s + b.seconds,
          0,
        );
        const totalHours = totalSeconds / 3600;

        const groups: AnalyticsGroup[] = Array.from(buckets.entries())
          .map(([key, b]) => ({
            key,
            hours: b.seconds / 3600,
            worklogCount: b.count,
            percentage: totalSeconds > 0 ? (b.seconds / totalSeconds) * 100 : 0,
          }))
          .sort((a, b) => b.hours - a.hours);

        const worklogWord = worklogs.length === 1 ? 'worklog' : 'worklogs';
        const groupWord = groups.length === 1 ? 'group' : 'groups';
        const lines: string[] = [
          `Worklog analytics · ${startDate} to ${endDate} · grouped by ${groupBy}`,
          `Total: ${formatHours(totalHours)} across ${worklogs.length} ${worklogWord} in ${groups.length} ${groupWord}`,
          '',
        ];
        for (const g of groups) {
          const wlWord = g.worklogCount === 1 ? 'worklog' : 'worklogs';
          const stats = `${formatHours(g.hours)} · ${formatPercent(g.percentage)} · ${g.worklogCount} ${wlWord}`;
          if (groupBy === 'issue') {
            lines.push(g.key);
            lines.push(`    ${stats}`);
          } else {
            lines.push(`${g.key} · ${stats}`);
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          metadata: {
            totalHours,
            totalWorklogs: worklogs.length,
            groupCount: groups.length,
            groupBy,
            startDate,
            endDate,
            details: groups,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to get worklog analytics: ${formatError(error)}`,
            },
          ],
        };
      }
    },
  };
}

/**
 * Merge auto-detected account attribute with user-provided attributes.
 * Auto-detected keys (_Account_) take precedence over user-provided duplicates.
 */
export function mergeAttributes(
  account: { key: string; name: string } | undefined,
  userAttributes?: WorkAttribute[],
): WorkAttribute[] {
  const attributesArray: WorkAttribute[] = [];
  const autoKeys = new Set<string>();

  if (account) {
    attributesArray.push({ key: '_Account_', value: account.key });
    autoKeys.add('_Account_');
  }

  if (userAttributes && userAttributes.length > 0) {
    for (const attr of userAttributes) {
      if (!autoKeys.has(attr.key)) {
        attributesArray.push(attr);
      }
    }
  }

  return attributesArray;
}

/**
 * Merge existing worklog attributes with user-provided overrides.
 */
function mergeExistingWithUserAttributes(
  existingAttributes: WorkAttribute[],
  userAttributes?: WorkAttribute[],
): WorkAttribute[] {
  if (!userAttributes || userAttributes.length === 0) {
    return existingAttributes;
  }

  const merged = new Map<string, string>();
  for (const attr of existingAttributes) {
    merged.set(attr.key, attr.value);
  }
  for (const attr of userAttributes) {
    merged.set(attr.key, attr.value);
  }

  return Array.from(merged.entries()).map(([key, value]) => ({ key, value }));
}

function computeGroupKey(
  worklog: any,
  groupBy: AnalyticsGroupBy,
  issueInfoMap: Record<string, { key: string; summary: string }>,
): string {
  switch (groupBy) {
    case 'issue': {
      const issueId = worklog.issue?.id;
      if (!issueId) return 'Unknown issue';
      const info = issueInfoMap[issueId];
      if (!info) return `Issue ${issueId}`;
      return info.summary ? `${info.key} — ${info.summary}` : info.key;
    }
    case 'account': {
      const accountAttr = worklog.attributes?.values?.find(
        (a: { key: string }) => a.key === '_Account_',
      );
      return accountAttr?.value || 'No account';
    }
    case 'day':
      return worklog.startDate || 'Unknown date';
    case 'week':
      return worklog.startDate ? toIsoWeek(worklog.startDate) : 'Unknown week';
    case 'month':
      return worklog.startDate
        ? worklog.startDate.slice(0, 7)
        : 'Unknown month';
  }
}

function toIsoWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
