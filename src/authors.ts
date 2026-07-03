import axios, { AxiosInstance } from 'axios';
import { JiraClient } from './jira.js';
import { AuthorFilter, JiraUser } from './types.js';
import { fetchAllTempoPages, mapWithConcurrency } from './utils.js';

/** A worklog author resolved to a Jira accountId with a human-readable label. */
export interface ResolvedAuthor {
  accountId: string;
  label: string;
}

export function hasAuthorFilter(filter?: AuthorFilter): filter is AuthorFilter {
  return !!(
    filter &&
    ((filter.users?.length ?? 0) > 0 || filter.program || filter.team)
  );
}

// Atlassian accountIds are either 24-char hex (legacy) or `<prefix>:<uuid>`
// (e.g. "557058:f58131cb-…"). Display names and emails never match either.
const ACCOUNT_ID_RE = /^([0-9a-f]{24}|[a-zA-Z0-9]+:[a-zA-Z0-9-]{8,})$/i;

export function userLabel(user: JiraUser): string {
  if (!user.displayName) return user.accountId;
  return user.emailAddress
    ? `${user.displayName} <${user.emailAddress}>`
    : user.displayName;
}

function describeCandidates(users: JiraUser[]): string {
  const shown = users
    .slice(0, 10)
    .map((u) => `${u.displayName ?? 'Unknown'} (${u.accountId})`);
  const suffix = users.length > 10 ? `, … ${users.length - 10} more` : '';
  return shown.join(', ') + suffix;
}

async function resolveUserEntry(
  jira: JiraClient,
  entry: string,
): Promise<ResolvedAuthor> {
  const value = entry.trim();
  if (ACCOUNT_ID_RE.test(value)) {
    return { accountId: value, label: value };
  }

  const candidates = await jira.searchUsers(value);

  if (value.includes('@')) {
    const exact = candidates.filter(
      (u) => u.emailAddress?.toLowerCase() === value.toLowerCase(),
    );
    if (exact.length >= 1) {
      return { accountId: exact[0].accountId, label: userLabel(exact[0]) };
    }
    // Email hidden by privacy settings but the query still matched server-side.
    if (candidates.length === 1) {
      return {
        accountId: candidates[0].accountId,
        label: userLabel(candidates[0]),
      };
    }
    if (candidates.length === 0) {
      // Jira privacy settings can exclude emails from search entirely. Most
      // org emails are name-based ("ivan.petrov@x"), so retry the local part
      // as a display name and accept only an unambiguous match.
      const nameGuess = value
        .split('@')[0]
        .replace(/[._-]+/g, ' ')
        .trim();
      if (nameGuess) {
        const byName = await jira.searchUsers(nameGuess);
        const exactName = byName.filter(
          (u) => u.displayName?.toLowerCase() === nameGuess.toLowerCase(),
        );
        const pool = exactName.length > 0 ? exactName : byName;
        if (pool.length === 1) {
          return { accountId: pool[0].accountId, label: userLabel(pool[0]) };
        }
      }
      throw new Error(
        `No Jira user found for email "${value}". Jira privacy settings may ` +
          'exclude emails from search — try the display name or accountId instead.',
      );
    }
    throw new Error(
      `Email "${value}" matched ${candidates.length} Jira users and none exposes a matching email address (visibility may be restricted): ${describeCandidates(candidates)}. Pass an accountId instead.`,
    );
  }

  const exact = candidates.filter(
    (u) => u.displayName?.toLowerCase() === value.toLowerCase(),
  );
  const pool = exact.length > 0 ? exact : candidates;
  if (pool.length === 1) {
    return { accountId: pool[0].accountId, label: userLabel(pool[0]) };
  }
  if (pool.length === 0) {
    throw new Error(`No Jira user found matching "${value}".`);
  }
  throw new Error(
    `"${value}" matches ${pool.length} Jira users: ${describeCandidates(pool)}. Use an email or accountId to disambiguate.`,
  );
}

function throwWithTeamsScopeHint(error: unknown, what: string): never {
  if (axios.isAxiosError(error) && error.response?.status === 403) {
    throw new Error(
      `Tempo API returned 403 while fetching ${what}. Your TEMPO_API_TOKEN is ` +
        'likely missing the "Teams" scope (covers Teams and Programs). Tempo ' +
        'does not allow modifying scopes on an existing token — create a new ' +
        'token at Tempo > Settings > API Integration with the "Teams" scope, ' +
        'then update TEMPO_API_TOKEN.',
    );
  }
  throw error;
}

interface NamedRef {
  id: number;
  name: string;
}

function describeRefs(items: NamedRef[]): string {
  const shown = items.slice(0, 25).map((i) => `"${i.name}" (id ${i.id})`);
  const suffix = items.length > 25 ? `, … ${items.length - 25} more` : '';
  return shown.join(', ') + suffix;
}

function matchByIdOrName(
  items: NamedRef[],
  query: string,
  kind: 'program' | 'team',
): NamedRef {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    const byId = items.find((i) => String(i.id) === trimmed);
    if (byId) return byId;
  }

  const lower = trimmed.toLowerCase();
  const exact = items.filter((i) => i.name?.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((i) => i.name?.toLowerCase().includes(lower));
  if (exact.length === 0 && partial.length === 1) return partial[0];

  const ambiguous = exact.length > 1 ? exact : partial;
  if (ambiguous.length > 1) {
    throw new Error(
      `Tempo ${kind} "${query}" is ambiguous — matches: ${describeRefs(ambiguous)}. Use the numeric id.`,
    );
  }
  if (items.length === 0) {
    throw new Error(`No Tempo ${kind}s are visible to this token.`);
  }
  throw new Error(
    `Tempo ${kind} "${query}" not found. Available: ${describeRefs(items)}.`,
  );
}

async function resolveProgramTeamIds(
  tempo: AxiosInstance,
  program: string,
): Promise<number[]> {
  let programs: NamedRef[];
  try {
    const response = await tempo.get('/programs');
    programs = response.data?.results || [];
  } catch (error) {
    throwWithTeamsScopeHint(error, 'programs');
  }

  const match = matchByIdOrName(programs, program, 'program');

  // Preferred path — needs "view program" permission in Tempo, which many
  // team leads don't have even when they can see the teams themselves.
  try {
    const response = await tempo.get(`/programs/${match.id}/teams`);
    const teams: NamedRef[] = response.data?.results || [];
    if (teams.length > 0) return teams.map((t) => t.id);
  } catch {
    // Typically 400 "You do not have permission to view program" —
    // fall back to the team listing below.
  }

  // Fallback: every visible team carries a program reference, so filter the
  // team list. Covers exactly the teams the token owner is allowed to see.
  let allTeams: Array<NamedRef & { program?: { id: number } }>;
  try {
    allTeams = await fetchAllTempoPages(tempo, '/teams', { limit: 100 });
  } catch (error) {
    throwWithTeamsScopeHint(error, 'teams');
  }
  const teamIds = allTeams
    .filter((t) => t.program?.id === match.id)
    .map((t) => t.id);

  if (teamIds.length === 0) {
    throw new Error(
      `No teams of Tempo program "${match.name}" are visible to this token. ` +
        'Either the program has no teams, or you lack permission to view ' +
        "them — ask a Tempo admin to grant access to the program's teams.",
    );
  }
  return teamIds;
}

async function resolveTeamId(
  tempo: AxiosInstance,
  team: string,
): Promise<number> {
  let teams: NamedRef[];
  try {
    teams = await fetchAllTempoPages(tempo, '/teams', { limit: 100 });
  } catch (error) {
    throwWithTeamsScopeHint(error, 'teams');
  }
  return matchByIdOrName(teams, team, 'team').id;
}

async function fetchTeamMemberIds(
  tempo: AxiosInstance,
  teamIds: number[],
): Promise<string[]> {
  const perTeam = await mapWithConcurrency(teamIds, 5, async (teamId) => {
    try {
      return await fetchAllTempoPages(tempo, `/teams/${teamId}/members`, {});
    } catch (error) {
      throwWithTeamsScopeHint(error, `members of team ${teamId}`);
    }
  });

  const ids = new Set<string>();
  for (const membership of perTeam.flat()) {
    const accountId = membership?.member?.accountId;
    if (accountId) ids.add(accountId);
  }
  return [...ids];
}

/**
 * Resolve an author filter to concrete worklog authors.
 *
 * `users` entries go through Jira user search (accountId passthrough, email,
 * or display name). `program`/`team` expand to the *current* members of the
 * matching Tempo teams. All sources are unioned and de-duplicated, then
 * labelled with display names via a best-effort Jira bulk lookup.
 *
 * Throws with an actionable message when anything is ambiguous or missing —
 * callers surface the error text as-is.
 */
export async function resolveAuthorFilter(
  tempo: AxiosInstance,
  jira: JiraClient,
  filter: AuthorFilter,
): Promise<ResolvedAuthor[]> {
  const byId = new Map<string, ResolvedAuthor>();

  if (filter.users?.length) {
    const resolved = await mapWithConcurrency(filter.users, 5, (entry) =>
      resolveUserEntry(jira, entry),
    );
    for (const author of resolved) byId.set(author.accountId, author);
  }

  const teamIds: number[] = [];
  if (filter.program) {
    teamIds.push(...(await resolveProgramTeamIds(tempo, filter.program)));
  }
  if (filter.team) {
    teamIds.push(await resolveTeamId(tempo, filter.team));
  }
  if (teamIds.length > 0) {
    const memberIds = await fetchTeamMemberIds(tempo, [...new Set(teamIds)]);
    for (const accountId of memberIds) {
      if (!byId.has(accountId))
        byId.set(accountId, { accountId, label: accountId });
    }
  }

  if (byId.size === 0) {
    throw new Error(
      'The author filter matched no users (the program/team may have no current members).',
    );
  }

  // Best effort: swap accountId labels for display names.
  const unlabeled = [...byId.values()]
    .filter((a) => a.label === a.accountId)
    .map((a) => a.accountId);
  if (unlabeled.length > 0) {
    const users = await jira.getUsersByAccountIds(unlabeled);
    for (const [accountId, user] of Object.entries(users)) {
      const author = byId.get(accountId);
      if (author) author.label = userLabel(user);
    }
  }

  return [...byId.values()];
}
