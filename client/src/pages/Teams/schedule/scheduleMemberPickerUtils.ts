import type { TeamRosterMember } from "../../../api/authTypes";
import {
  compareTeamRosterMembersByScheduleDisplay,
  memberMatchesScheduleQuery,
} from "../teamsUtils";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";

export type ScheduleMemberPickerMember = {
  member: TeamRosterMember;
  eligible: boolean;
  issue: string;
  usesSubmenu: boolean;
  /** Member asked for this position via intake. A soft preference signal. */
  desiresPosition: boolean;
  /**
   * Non-blocking caution (e.g. marked this service unavailable on intake). The
   * member is still selectable; this just informs the scheduler.
   */
  warning: string;
};

export const splitTypedMemberName = (raw: string) => {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || "";
  return { firstName, lastName: parts.join(" ") };
};

export const memberQualifiesForPosition = (
  member: TeamRosterMember,
  positionId: string,
) => (member.positionIds || []).includes(positionId);

export const memberDesiresPosition = (
  member: TeamRosterMember,
  positionId: string,
) => (member.desiredPositionIds || []).includes(positionId);

/** 0 = fully available, 1 = selectable with caution, 2 = not selectable. */
export const getScheduleMemberPickerAvailabilityRank = (
  row: ScheduleMemberPickerMember,
) => {
  if (!row.eligible) return 2;
  if (row.warning) return 1;
  return 0;
};

export const sortScheduleMemberPickerRows = (
  rows: ScheduleMemberPickerMember[],
  positionId: string,
  duplicateFirstNames: Set<string>,
) =>
  [...rows].sort((a, b) => {
    const aRank = getScheduleMemberPickerAvailabilityRank(a);
    const bRank = getScheduleMemberPickerAvailabilityRank(b);
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    const aQualifies = memberQualifiesForPosition(a.member, positionId);
    const bQualifies = memberQualifiesForPosition(b.member, positionId);
    if (aQualifies !== bQualifies) {
      return aQualifies ? -1 : 1;
    }
    // Among otherwise-equal members, float those who asked for this position
    // (intake desire) to the top so schedulers reach for willing people first.
    if (a.desiresPosition !== b.desiresPosition) {
      return a.desiresPosition ? -1 : 1;
    }
    return compareTeamRosterMembersByScheduleDisplay(
      a.member,
      b.member,
      duplicateFirstNames,
    );
  });

export const shouldShowScheduleMemberPositionGroupDivider = (
  rows: ScheduleMemberPickerMember[],
  index: number,
  positionId: string,
) =>
  index > 0 &&
  memberQualifiesForPosition(rows[index - 1].member, positionId) &&
  !memberQualifiesForPosition(rows[index].member, positionId);

export const shouldShowScheduleMemberEligibilityGroupDivider = (
  rows: ScheduleMemberPickerMember[],
  index: number,
) => index > 0 && rows[index - 1].eligible && !rows[index].eligible;

export const isSelectableScheduleMember = ({
  memberId,
  currentPrimaryMemberId,
  hasPrimaryAssignee,
  getIssue,
  getAssignmentActionIssues,
}: {
  memberId: string;
  currentPrimaryMemberId: string;
  hasPrimaryAssignee: boolean;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (
    memberId: string,
  ) => MemberAssignmentActionIssues;
}) => {
  const usesSubmenu =
    hasPrimaryAssignee &&
    Boolean(getAssignmentActionIssues) &&
    memberId !== currentPrimaryMemberId;
  if (usesSubmenu && getAssignmentActionIssues) {
    const issues = getAssignmentActionIssues(memberId);
    return !issues.replace || !issues.shadow || !issues.reverseShadow;
  }
  return !getIssue(memberId);
};

export const getScheduleMemberUnavailableReason = ({
  memberId,
  currentPrimaryMemberId,
  hasPrimaryAssignee,
  getIssue,
  getAssignmentActionIssues,
}: {
  memberId: string;
  currentPrimaryMemberId: string;
  hasPrimaryAssignee: boolean;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (
    memberId: string,
  ) => MemberAssignmentActionIssues;
}) => {
  const usesSubmenu =
    hasPrimaryAssignee &&
    Boolean(getAssignmentActionIssues) &&
    memberId !== currentPrimaryMemberId;
  if (usesSubmenu && getAssignmentActionIssues) {
    const issues = getAssignmentActionIssues(memberId);
    // Shadow is the most permissive action (it doesn't require position
    // eligibility), so when a member is fully blocked its shadow reason is the
    // real, binding constraint. Lead with it so we don't mislead with
    // "Not eligible for this position" when the true reason is e.g. blocked
    // out, marked unavailable, or already assigned.
    return (
      issues.shadow || issues.replace || issues.reverseShadow || "Unavailable"
    );
  }
  return getIssue(memberId) || "Unavailable";
};

export const buildScheduleMemberPickerMembers = ({
  members,
  positionId,
  assignmentQuery,
  currentPrimaryMemberId,
  hasPrimaryAssignee,
  duplicateFirstNames,
  getIssue,
  getAssignmentActionIssues,
  getWarning,
  filterByQuery = true,
}: {
  members: TeamRosterMember[];
  positionId: string;
  assignmentQuery: string;
  currentPrimaryMemberId: string;
  hasPrimaryAssignee: boolean;
  duplicateFirstNames: Set<string>;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (
    memberId: string,
  ) => MemberAssignmentActionIssues;
  getWarning?: (memberId: string) => string;
  filterByQuery?: boolean;
}): ScheduleMemberPickerMember[] => {
  const trimmedQuery = assignmentQuery.trim();
  const issueArgs = {
    currentPrimaryMemberId,
    hasPrimaryAssignee,
    getIssue,
    getAssignmentActionIssues,
  };

  // When a primary is already assigned, every pick goes through the action
  // submenu (replace / shadow / reverse shadow). A plain shadow does not require
  // position eligibility, so keep all team members here and let the per-action
  // eligibility check decide what is offered. Without a primary we are choosing
  // the primary, which must qualify for the position.
  const submenuMode = hasPrimaryAssignee && Boolean(getAssignmentActionIssues);

  const filteredMembers = members
    .filter(
      (member) => submenuMode || memberQualifiesForPosition(member, positionId),
    )
    .filter((member) => member.memberId !== currentPrimaryMemberId)
    .filter((member) => {
      if (!filterByQuery || !trimmedQuery) return true;
      return memberMatchesScheduleQuery(
        member,
        trimmedQuery,
        duplicateFirstNames,
      );
    });

  const rows = filteredMembers.map((member) => {
    const eligible = isSelectableScheduleMember({
      memberId: member.memberId,
      ...issueArgs,
    });
    const usesSubmenu =
      hasPrimaryAssignee &&
      Boolean(getAssignmentActionIssues) &&
      member.memberId !== currentPrimaryMemberId;
    return {
      member,
      eligible,
      issue: eligible
        ? ""
        : getScheduleMemberUnavailableReason({
            memberId: member.memberId,
            ...issueArgs,
          }),
      usesSubmenu: Boolean(usesSubmenu && eligible),
      desiresPosition: memberDesiresPosition(member, positionId),
      // Only surface a warning when the member is actually selectable — a
      // blocked row already shows its blocking reason.
      warning: eligible && getWarning ? getWarning(member.memberId) : "",
    };
  });

  return sortScheduleMemberPickerRows(rows, positionId, duplicateFirstNames);
};

export const shouldOfferCreateMember = ({
  members,
  assignmentQuery,
  duplicateFirstNames,
  canCreate,
}: {
  members: TeamRosterMember[];
  assignmentQuery: string;
  duplicateFirstNames: Set<string>;
  canCreate: boolean;
}) => {
  const trimmedQuery = assignmentQuery.trim();
  if (!canCreate || !trimmedQuery) return false;
  return !members.some((member) =>
    memberMatchesScheduleQuery(member, trimmedQuery, duplicateFirstNames),
  );
};
