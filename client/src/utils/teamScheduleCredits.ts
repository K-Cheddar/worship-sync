import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleCellAssignment,
  TeamScheduleOccurrence,
} from "../api/authTypes";
import { parseSlotKey } from "../pages/Teams/schedule/scheduleRequirements";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  getDuplicateScheduleFirstNames,
  scheduleMemberName,
  sortPositionsByOrder,
} from "../pages/Teams/teamsUtils";

export type TeamScheduleCreditEntry = {
  heading: string;
  names: string;
  sourceLabel: string;
};

export const MEDIA_TEAM_NAME = "media";
export const DEFAULT_CREDITS_SERVICE_WINDOW_MINUTES = 180;

type BuildTeamScheduleCreditEntriesInput = {
  schedules: TeamSchedule[];
  positions: TeamPosition[];
  members: TeamRosterMember[];
  teams: TeamRecord[];
  now?: Date;
  mediaTeamName?: string;
  serviceWindowMinutes?: number;
};

type ScheduleOccurrenceWithOwner = {
  schedule: TeamSchedule;
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
  normalizeTokens(value).filter((token) => !GENERIC_CREDIT_ROLE_WORDS.has(token));

const tokensMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((token, index) => token === right[index]);

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
) =>
  entries.find((entry) =>
    teamScheduleCreditHeadingMatches(creditHeading, entry.heading),
  );

const findMediaTeam = (teams: TeamRecord[], mediaTeamName: string) => {
  const mediaNeedle = normalizeTeamName(mediaTeamName);
  return teams.find((team) => {
    if (team.archivedAt) return false;
    const normalizedName = normalizeTeamName(team.name);
    return normalizedName.includes(mediaNeedle);
  });
};

const findTargetOccurrence = (
  schedules: TeamSchedule[],
  now: Date,
  serviceWindowMinutes: number,
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

  const inProgress = occurrences
    .filter(
      (entry) =>
        entry.startsAtMs <= nowMs && nowMs <= entry.startsAtMs + serviceWindowMs,
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
  duplicateFirstNames,
}: {
  names: string[];
  seenMemberIds: Set<string>;
  memberId: string;
  membersById: Map<string, TeamRosterMember>;
  duplicateFirstNames: Set<string>;
}) => {
  if (!memberId || seenMemberIds.has(memberId)) return;
  seenMemberIds.add(memberId);
  names.push(scheduleMemberName(membersById.get(memberId), duplicateFirstNames));
};

const collectCellMemberNames = ({
  cell,
  membersById,
  duplicateFirstNames,
  names,
  seenMemberIds,
}: {
  cell: TeamScheduleCellAssignment;
  membersById: Map<string, TeamRosterMember>;
  duplicateFirstNames: Set<string>;
  names: string[];
  seenMemberIds: Set<string>;
}) => {
  pushMemberName({
    names,
    seenMemberIds,
    memberId: getCellPrimaryMemberId(cell),
    membersById,
    duplicateFirstNames,
  });
  getCellShadowAssignments(cell).forEach((shadow) => {
    pushMemberName({
      names,
      seenMemberIds,
      memberId: shadow.memberId,
      membersById,
      duplicateFirstNames,
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
}: BuildTeamScheduleCreditEntriesInput): TeamScheduleCreditEntry[] => {
  const mediaTeam = findMediaTeam(teams, mediaTeamName);
  if (!mediaTeam) return [];

  const teamSchedules = schedules.filter(
    (schedule) => !schedule.archivedAt && schedule.teamId === mediaTeam.teamId,
  );
  const target = findTargetOccurrence(teamSchedules, now, serviceWindowMinutes);
  if (!target) return [];

  const teamPositions = sortPositionsByOrder(
    positions.filter(
      (position) => !position.archivedAt && position.teamId === mediaTeam.teamId,
    ),
  );
  const positionById = new Map(
    teamPositions.map((position) => [position.positionId, position]),
  );
  const membersById = new Map(members.map((member) => [member.memberId, member]));
  const duplicateFirstNames = getDuplicateScheduleFirstNames(members);
  const namesByPositionId = new Map<string, string[]>();
  const seenMemberIdsByPositionId = new Map<string, Set<string>>();
  const row = target.schedule.assignments?.[target.occurrence.occurrenceId] || {};

  Object.entries(row)
    .map(([cellKey, cell]) => ({ cellKey, cell, slot: parseSlotKey(cellKey) }))
    .filter(
      (entry): entry is {
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
      const names = namesByPositionId.get(slot.positionId) || [];
      const seenMemberIds =
        seenMemberIdsByPositionId.get(slot.positionId) || new Set<string>();
      collectCellMemberNames({
        cell,
        membersById,
        duplicateFirstNames,
        names,
        seenMemberIds,
      });
      namesByPositionId.set(slot.positionId, names);
      seenMemberIdsByPositionId.set(slot.positionId, seenMemberIds);
    });

  return teamPositions.flatMap((position) => {
    const names = namesByPositionId.get(position.positionId) || [];
    if (!names.length) return [];
    return [
      {
        heading: position.name,
        names: names.join("\n"),
        sourceLabel: buildScheduleSourceLabel({
          scheduleName: target.schedule.name,
          occurrenceName: target.occurrence.name,
        }),
      },
    ];
  });
};
