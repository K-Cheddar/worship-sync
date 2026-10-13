import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleCellAssignment,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
} from "../api/authTypes";
import { isHydratedSchedule } from "../api/authTypes";
import { parseSlotKey } from "../pages/Teams/schedule/scheduleRequirements";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  memberName,
  sortPositionsByOrder,
} from "../pages/Teams/teamsUtils";
import { resolveMemberMinorStatus } from "../pages/Teams/memberPreferences";
import { getServicePlanKey } from "./servicePlanKeys";

export type TeamScheduleCreditEntry = {
  positionId: string;
  heading: string;
  names: string;
  sourceLabel: string;
};

export type TeamScheduleCreditPosition = Pick<
  TeamScheduleCreditEntry,
  "positionId" | "heading"
>;

export type TeamScheduleCreditAvailability =
  | "loaded"
  | "missing"
  | "unhydrated"
  | "incomplete"
  | "failed";

export const MEDIA_TEAM_NAME = "media";
export const DEFAULT_CREDITS_SERVICE_WINDOW_MINUTES = 180;

type BuildTeamScheduleCreditEntriesInput = {
  /**
   * Every schedule, summaries included. Pre-filtering with
   * `onlyHydratedSchedules` hides the difference between "nobody is on the
   * media team for this service" and "we never fetched that schedule's cells",
   * and credits go out with names missing either way.
   */
  schedules: (TeamSchedule | TeamScheduleSummary)[];
  positions: TeamPosition[];
  members: TeamRosterMember[];
  teams: TeamRecord[];
  now?: Date;
  mediaTeamName?: string;
  serviceWindowMinutes?: number;
  /** Selected dated service plan; overrides the default in-progress/upcoming heuristic. */
  servicePlanKey?: string;
};

export type TeamScheduleCreditsResult = {
  entries: TeamScheduleCreditEntry[];
  /** Known headings can still be reported when assignment details are unavailable. */
  positions: TeamScheduleCreditPosition[];
  availability: TeamScheduleCreditAvailability;
};

/** Stable credit ID for a scheduled position across generation retries and refreshes. */
export const getGeneratedScheduleCreditId = (positionId: string) =>
  `generated-schedule-${encodeURIComponent(positionId)}`;

type ScheduleOccurrenceWithOwner = {
  schedule: TeamSchedule | TeamScheduleSummary;
  occurrence: TeamScheduleOccurrence;
  startsAtMs: number;
};

const GENERIC_CREDIT_ROLE_WORDS = new Set([
  "engineer",
  "member",
  "operator",
  "staff",
  "team",
  "tech",
  "technician",
  "volunteer",
]);

const singularizeToken = (token: string) => {
  if (token.endsWith("ies") && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
};

const normalizeTokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token))
    .map(singularizeToken);

const normalizeTeamName = (value: string) => normalizeTokens(value).join(" ");

const coreCreditTokens = (value: string) =>
  normalizeTokens(value).filter(
    (token) => !GENERIC_CREDIT_ROLE_WORDS.has(token),
  );

const tokensMatch = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((token, index) => token === right[index]);

export const teamScheduleCreditHeadingMatches = (
  creditHeading: string,
  scheduleHeading: string,
) => {
  const creditTokens = normalizeTokens(creditHeading);
  const scheduleTokens = normalizeTokens(scheduleHeading);
  if (!creditTokens.length || !scheduleTokens.length) return false;
  if (tokensMatch(creditTokens, scheduleTokens)) return true;

  const creditCore = coreCreditTokens(creditHeading);
  const scheduleCore = coreCreditTokens(scheduleHeading);
  if (!creditCore.length || !scheduleCore.length) return false;
  return tokensMatch(creditCore, scheduleCore);
};

export const findTeamScheduleCreditEntryForHeading = (
  entries: TeamScheduleCreditEntry[],
  creditHeading: string,
) => {
  const matches = entries.filter((entry) =>
    teamScheduleCreditHeadingMatches(creditHeading, entry.heading),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

export type TeamScheduleCreditMatchResolution = {
  matchedEntriesByCreditIndex: Map<number, number>;
  ambiguousCreditIndexes: Set<number>;
  ambiguousEntryIndexes: Set<number>;
};

/**
 * Resolves the schedule/credit relationship as a whole. Stable generated IDs
 * claim their position first; remaining heading matches must form a one-to-one
 * relationship. Ambiguous connected groups are left for the operator.
 */
export const resolveTeamScheduleCreditMatches = (
  entries: TeamScheduleCreditEntry[],
  credits: Array<{ id: string; heading: string }>,
): TeamScheduleCreditMatchResolution => {
  const matchedEntriesByCreditIndex = new Map<number, number>();
  const matchedEntryIndexes = new Set<number>();
  const ambiguousCreditIndexes = new Set<number>();
  const ambiguousEntryIndexes = new Set<number>();
  const entryIndexesByGeneratedId = new Map<string, number[]>();
  const creditIndexesById = new Map<string, number[]>();

  entries.forEach((entry, index) => {
    const generatedId = getGeneratedScheduleCreditId(entry.positionId);
    const indexes = entryIndexesByGeneratedId.get(generatedId) ?? [];
    indexes.push(index);
    entryIndexesByGeneratedId.set(generatedId, indexes);
  });
  credits.forEach((credit, index) => {
    const indexes = creditIndexesById.get(credit.id) ?? [];
    indexes.push(index);
    creditIndexesById.set(credit.id, indexes);
  });

  for (const [generatedId, entryIndexes] of entryIndexesByGeneratedId) {
    if (entryIndexes.length > 1) entryIndexes.forEach((index) => ambiguousEntryIndexes.add(index));
    const creditIndexes = creditIndexesById.get(generatedId) ?? [];
    if (!creditIndexes.length) continue;
    if (entryIndexes.length === 1 && creditIndexes.length === 1) {
      matchedEntriesByCreditIndex.set(creditIndexes[0], entryIndexes[0]);
      matchedEntryIndexes.add(entryIndexes[0]);
      continue;
    }
    entryIndexes.forEach((index) => ambiguousEntryIndexes.add(index));
    creditIndexes.forEach((index) => ambiguousCreditIndexes.add(index));
  }

  const creditEdges = new Map<number, number[]>();
  const entryEdges = new Map<number, number[]>();
  credits.forEach((credit, creditIndex) => {
    if (matchedEntriesByCreditIndex.has(creditIndex) || ambiguousCreditIndexes.has(creditIndex)) return;
    entries.forEach((entry, entryIndex) => {
      if (matchedEntryIndexes.has(entryIndex) || ambiguousEntryIndexes.has(entryIndex)) return;
      if (!teamScheduleCreditHeadingMatches(credit.heading, entry.heading)) return;
      creditEdges.set(creditIndex, [...(creditEdges.get(creditIndex) ?? []), entryIndex]);
      entryEdges.set(entryIndex, [...(entryEdges.get(entryIndex) ?? []), creditIndex]);
    });
  });

  for (const [creditIndex, entryIndexes] of creditEdges) {
    for (const entryIndex of entryIndexes) {
      const creditIndexes = entryEdges.get(entryIndex) ?? [];
      if (entryIndexes.length === 1 && creditIndexes.length === 1) {
        matchedEntriesByCreditIndex.set(creditIndex, entryIndex);
        matchedEntryIndexes.add(entryIndex);
      } else {
        ambiguousCreditIndexes.add(creditIndex);
        ambiguousEntryIndexes.add(entryIndex);
      }
    }
  }

  return {
    matchedEntriesByCreditIndex,
    ambiguousCreditIndexes,
    ambiguousEntryIndexes,
  };
};

const findMediaTeam = (teams: TeamRecord[], mediaTeamName: string) => {
  const mediaNeedle = normalizeTeamName(mediaTeamName);
  return teams.find((team) => {
    if (team.archivedAt) return false;
    const normalizedName = normalizeTeamName(team.name);
    return normalizedName.includes(mediaNeedle);
  });
};

const findTargetOccurrence = (
  schedules: (TeamSchedule | TeamScheduleSummary)[],
  now: Date,
  serviceWindowMinutes: number,
  servicePlanKey?: string,
): ScheduleOccurrenceWithOwner | null => {
  const nowMs = now.getTime();
  const serviceWindowMs = Math.max(serviceWindowMinutes, 0) * 60 * 1000;
  const occurrences = schedules.flatMap((schedule) =>
    (schedule.occurrences || []).flatMap((occurrence) => {
      const startsAtMs = new Date(occurrence.startsAt).getTime();
      return Number.isFinite(startsAtMs)
        ? [{ schedule, occurrence, startsAtMs }]
        : [];
    }),
  );

  if (servicePlanKey) {
    return occurrences.find((entry) => getServicePlanKey(entry.occurrence) === servicePlanKey) || null;
  }

  const inProgress = occurrences
    .filter(
      (entry) =>
        entry.startsAtMs <= nowMs &&
        nowMs <= entry.startsAtMs + serviceWindowMs,
    )
    .sort((a, b) => b.startsAtMs - a.startsAtMs);
  if (inProgress[0]) return inProgress[0];

  const upcoming = occurrences
    .filter((entry) => entry.startsAtMs > nowMs)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  return upcoming[0] || null;
};

const buildScheduleSourceLabel = ({
  scheduleName,
  occurrenceName,
}: {
  scheduleName: string;
  occurrenceName: string;
}) => {
  const sourceParts = [scheduleName, occurrenceName].filter((part) =>
    part.trim(),
  );
  return sourceParts.length
    ? `Media schedule: ${sourceParts.join(" - ")}`
    : "Media schedule";
};

const pushMemberName = ({
  names,
  seenMemberIds,
  memberId,
  membersById,
}: {
  names: string[];
  seenMemberIds: Set<string>;
  memberId: string;
  membersById: Map<string, TeamRosterMember>;
}) => {
  if (!memberId || seenMemberIds.has(memberId)) return;
  seenMemberIds.add(memberId);
  const member = membersById.get(memberId);
  if (!member) return;
  names.push(resolveMemberMinorStatus(member) ? member.firstName.trim() : memberName(member));
};

const collectCellMemberNames = ({
  cell,
  membersById,
  names,
  seenMemberIds,
}: {
  cell: TeamScheduleCellAssignment;
  membersById: Map<string, TeamRosterMember>;
  names: string[];
  seenMemberIds: Set<string>;
}) => {
  pushMemberName({
    names,
    seenMemberIds,
    memberId: getCellPrimaryMemberId(cell),
    membersById,
  });
  getCellShadowAssignments(cell).forEach((shadow) => {
    pushMemberName({
      names,
      seenMemberIds,
      memberId: shadow.memberId,
      membersById,
    });
  });
};

export const buildTeamScheduleCreditEntries = ({
  schedules,
  positions,
  members,
  teams,
  now = new Date(),
  mediaTeamName = MEDIA_TEAM_NAME,
  serviceWindowMinutes = DEFAULT_CREDITS_SERVICE_WINDOW_MINUTES,
  servicePlanKey,
}: BuildTeamScheduleCreditEntriesInput): TeamScheduleCreditsResult => {
  const mediaTeam = findMediaTeam(teams, mediaTeamName);
  if (!mediaTeam) {
    return { entries: [], positions: [], availability: "missing" };
  }

  const teamPositions = sortPositionsByOrder(
    positions.filter(
      (position) =>
        !position.archivedAt && position.teamId === mediaTeam.teamId,
    ),
  );
  const creditPositions = teamPositions.map((position) => ({
    positionId: position.positionId,
    heading: position.name,
  }));

  const teamSchedules = schedules.filter(
    (schedule) => !schedule.archivedAt && schedule.teamId === mediaTeam.teamId,
  );
  const target = findTargetOccurrence(teamSchedules, now, serviceWindowMinutes, servicePlanKey);
  if (!target) {
    return { entries: [], positions: creditPositions, availability: "missing" };
  }
  // The schedule the credits would come from is outside the bootstrap's
  // hydrated window. Reporting no names would be indistinguishable from an
  // unstaffed service, so hand the caller the difference.
  if (!isHydratedSchedule(target.schedule)) {
    return { entries: [], positions: creditPositions, availability: "unhydrated" };
  }
  const targetSchedule = target.schedule;

  const positionById = new Map(
    teamPositions.map((position) => [position.positionId, position]),
  );
  const membersById = new Map(
    members.map((member) => [member.memberId, member]),
  );
  const namesByPositionId = new Map<string, string[]>();
  const seenMemberIdsByPositionId = new Map<string, Set<string>>();
  let assignmentsIncomplete = false;
  const row = targetSchedule.assignments?.[target.occurrence.occurrenceId] || {};

  Object.entries(row)
    .map(([cellKey, cell]) => ({ cellKey, cell, slot: parseSlotKey(cellKey) }))
    .filter(
      (
        entry,
      ): entry is {
        cellKey: string;
        cell: TeamScheduleCellAssignment;
        slot: { positionId: string; slot: number };
      } => Boolean(entry.slot && positionById.has(entry.slot.positionId)),
    )
    .sort(
      (a, b) =>
        a.slot.positionId.localeCompare(b.slot.positionId) ||
        a.slot.slot - b.slot.slot ||
        a.cellKey.localeCompare(b.cellKey),
    )
    .forEach(({ cell, slot }) => {
      const assignedMemberIds = [
        getCellPrimaryMemberId(cell),
        ...getCellShadowAssignments(cell).map((shadow) => shadow.memberId),
      ];
      if (assignedMemberIds.some((memberId) => memberId && !membersById.has(memberId))) {
        assignmentsIncomplete = true;
      }
      const names = namesByPositionId.get(slot.positionId) || [];
      const seenMemberIds =
        seenMemberIdsByPositionId.get(slot.positionId) || new Set<string>();
      collectCellMemberNames({
        cell,
        membersById,
        names,
        seenMemberIds,
      });
      namesByPositionId.set(slot.positionId, names);
      seenMemberIdsByPositionId.set(slot.positionId, seenMemberIds);
    });

  const entries = teamPositions.map((position) => {
    const names = namesByPositionId.get(position.positionId) || [];
    return {
      positionId: position.positionId,
      heading: position.name,
      names: names.join("\n"),
      sourceLabel: buildScheduleSourceLabel({
        scheduleName: targetSchedule.name,
        occurrenceName: target.occurrence.name,
      }),
    };
  });
  return {
    entries: assignmentsIncomplete ? [] : entries,
    positions: creditPositions,
    availability: assignmentsIncomplete ? "incomplete" : "loaded",
  };
};
