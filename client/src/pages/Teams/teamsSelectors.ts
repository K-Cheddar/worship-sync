import type {
  TeamIntakeSubmission,
  TeamRosterMember,
} from "../../api/authTypes";
import type { TeamsData } from "./types";
import { isActive } from "./teamsUtils";

export type NormalizedEntityList<T extends Record<string, unknown>> = {
  byId: Record<string, T>;
  ids: string[];
};

export type NormalizedTeamsData = {
  members: NormalizedEntityList<TeamsData["members"][number]>;
  positions: NormalizedEntityList<TeamsData["positions"][number]>;
  teams: NormalizedEntityList<TeamsData["teams"][number]>;
  teamRoles: NormalizedEntityList<TeamsData["teamRoles"][number]>;
  qualificationAreas: NormalizedEntityList<
    TeamsData["qualificationAreas"][number]
  >;
  qualificationLevels: NormalizedEntityList<
    TeamsData["qualificationLevels"][number]
  >;
  schedules: NormalizedEntityList<TeamsData["schedules"][number]>;
  intakeForms: NormalizedEntityList<TeamsData["intakeForms"][number]>;
  intakeSubmissions: NormalizedEntityList<
    TeamsData["intakeSubmissions"][number]
  >;
};

const normalizeList = <T extends Record<string, unknown>>(
  items: T[],
  idField: keyof T,
): NormalizedEntityList<T> => {
  const byId: Record<string, T> = {};
  const ids: string[] = [];
  items.forEach((item) => {
    const id = String(item[idField] || "");
    if (!id) return;
    byId[id] = item;
    ids.push(id);
  });
  return { byId, ids };
};

export const normalizeTeamsForSelectors = (
  data: TeamsData,
): NormalizedTeamsData => ({
  members: normalizeList(data.members, "memberId"),
  positions: normalizeList(data.positions, "positionId"),
  teams: normalizeList(data.teams, "teamId"),
  teamRoles: normalizeList(data.teamRoles, "roleId"),
  qualificationAreas: normalizeList(data.qualificationAreas, "areaId"),
  qualificationLevels: normalizeList(data.qualificationLevels, "levelId"),
  schedules: normalizeList(data.schedules, "scheduleId"),
  intakeForms: normalizeList(data.intakeForms, "formId"),
  intakeSubmissions: normalizeList(data.intakeSubmissions, "submissionId"),
});

export const selectActiveMembers = (data: TeamsData) =>
  data.members.filter(isActive);

export const selectNewestIntakeSubmissions = (data: TeamsData) =>
  [...(data.intakeSubmissions || [])].sort(
    (a, b) =>
      new Date(b.submittedAt || 0).getTime() -
      new Date(a.submittedAt || 0).getTime(),
  );

export const normalizeMemberNameKey = (
  firstName: string | undefined,
  lastName: string | undefined,
) =>
  `${firstName || ""} ${lastName || ""}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export const selectIntakeMemberMatch = (
  submission: TeamIntakeSubmission,
  members: TeamRosterMember[],
) =>
  members.find(
    (member) =>
      normalizeMemberNameKey(member.firstName, member.lastName) ===
      submission.normalizedName,
  );
