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
