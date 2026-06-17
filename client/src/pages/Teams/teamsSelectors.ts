import type {
  TeamIntakeSubmission,
  TeamMemberQualificationStatus,
  TeamRecord,
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

export type SubmissionStatusFilter = "needs_action" | "processed" | "all";

// "needs_action" = still open (new); "processed" = resolved (applied or
// dismissed). Once a submission has been linked/applied or dismissed it leaves
// the active "Needs action" view.
const NEEDS_ACTION_STATUSES: ReadonlySet<TeamIntakeSubmission["status"]> =
  new Set(["new"]);

export const intakeSubmissionNeedsAction = (
  submission: Pick<TeamIntakeSubmission, "status">,
) => NEEDS_ACTION_STATUSES.has(submission.status);

export const submissionMatchesStatusFilter = (
  status: TeamIntakeSubmission["status"],
  filter: SubmissionStatusFilter,
) => {
  if (filter === "all") return true;
  const needsAction = NEEDS_ACTION_STATUSES.has(status);
  return filter === "needs_action" ? needsAction : !needsAction;
};

export const normalizeMemberNameKey = (
  firstName: string | undefined,
  lastName: string | undefined,
) =>
  `${firstName || ""} ${lastName || ""}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const splitNormalizedName = (normalizedName: string) => {
  const parts = normalizedName.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.slice(1).join(" "),
  };
};

const isCloseLastNameMatch = (submissionLast: string, memberLast: string) => {
  if (!submissionLast || !memberLast) return false;
  if (submissionLast === memberLast) return true;
  const prefixLength = Math.min(3, submissionLast.length, memberLast.length);
  if (
    prefixLength >= 2 &&
    submissionLast.slice(0, prefixLength) === memberLast.slice(0, prefixLength)
  ) {
    return true;
  }
  return (
    submissionLast.startsWith(memberLast) ||
    memberLast.startsWith(submissionLast)
  );
};

export type MemberListFilterState = {
  teamIds: string[];
  positionIds: string[];
  roleIds: string[];
  qualificationAreaIds: string[];
  qualificationLevelIds: string[];
  qualificationStatuses: TeamMemberQualificationStatus[];
};

export const emptyMemberListFilters = (): MemberListFilterState => ({
  teamIds: [],
  positionIds: [],
  roleIds: [],
  qualificationAreaIds: [],
  qualificationLevelIds: [],
  qualificationStatuses: [],
});

export const countActiveMemberListFilters = (filters: MemberListFilterState) =>
  filters.teamIds.length +
  filters.positionIds.length +
  filters.roleIds.length +
  filters.qualificationAreaIds.length +
  filters.qualificationLevelIds.length +
  filters.qualificationStatuses.length;

export const isMemberOnTeam = (
  member: TeamRosterMember,
  teamId: string,
  teamsById: Map<string, TeamRecord>,
) => {
  const team = teamsById.get(teamId);
  if ((team?.memberIds || []).includes(member.memberId)) return true;
  return Boolean(member.teamMemberships?.[teamId]);
};

export const memberMatchesListFilters = (
  member: TeamRosterMember,
  filters: MemberListFilterState,
  teamsById: Map<string, TeamRecord>,
) => {
  if (filters.teamIds.length > 0) {
    const onTeam = filters.teamIds.some((teamId) =>
      isMemberOnTeam(member, teamId, teamsById),
    );
    if (!onTeam) return false;
  }
  if (filters.positionIds.length > 0) {
    const positionIds = member.positionIds || [];
    if (!filters.positionIds.some((id) => positionIds.includes(id))) {
      return false;
    }
  }
  if (filters.roleIds.length > 0) {
    const memberships = member.teamMemberships || {};
    const memberRoleIds = Object.values(memberships)
      .map((membership) => membership.roleId)
      .filter(Boolean) as string[];
    if (!filters.roleIds.some((id) => memberRoleIds.includes(id))) {
      return false;
    }
  }
  const qualifications = member.qualifications || [];
  const hasQualificationFilters =
    filters.qualificationAreaIds.length > 0 ||
    filters.qualificationLevelIds.length > 0 ||
    filters.qualificationStatuses.length > 0;

  if (hasQualificationFilters) {
    const matchesQualificationFilters = qualifications.some((qualification) => {
      if (
        filters.qualificationAreaIds.length > 0 &&
        !filters.qualificationAreaIds.includes(qualification.areaId)
      ) {
        return false;
      }
      if (
        filters.qualificationLevelIds.length > 0 &&
        !filters.qualificationLevelIds.includes(qualification.levelId)
      ) {
        return false;
      }
      if (
        filters.qualificationStatuses.length > 0 &&
        !filters.qualificationStatuses.includes(qualification.status)
      ) {
        return false;
      }
      return true;
    });
    if (!matchesQualificationFilters) return false;
  }
  return true;
};

export const selectIntakeMemberMatch = (
  submission: TeamIntakeSubmission,
  members: TeamRosterMember[],
) => {
  const exact = members.find(
    (member) =>
      normalizeMemberNameKey(member.firstName, member.lastName) ===
      submission.normalizedName,
  );
  if (exact) return exact;

  const { first: submissionFirst, last: submissionLast } = splitNormalizedName(
    submission.normalizedName,
  );
  if (!submissionFirst) return undefined;

  return members.find((member) => {
    const memberKey = normalizeMemberNameKey(member.firstName, member.lastName);
    const { first: memberFirst, last: memberLast } =
      splitNormalizedName(memberKey);
    return (
      submissionFirst === memberFirst &&
      isCloseLastNameMatch(submissionLast, memberLast)
    );
  });
};
