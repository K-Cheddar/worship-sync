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

export const sortScheduleMemberPickerRows = (
  rows: ScheduleMemberPickerMember[],
  positionId: string,
  duplicateFirstNames: Set<string>,
) =>
  [...rows].sort((a, b) => {
    const aQualifies = memberQualifiesForPosition(a.member, positionId);
    const bQualifies = memberQualifiesForPosition(b.member, positionId);
    if (aQualifies !== bQualifies) {
      return aQualifies ? -1 : 1;
    }
    if (a.eligible !== b.eligible) {
      return a.eligible ? -1 : 1;
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
  positionId: string,
) => {
  if (index <= 0) return false;

  const previousQualifies = memberQualifiesForPosition(
    rows[index - 1].member,
    positionId,
  );
  const currentQualifies = memberQualifiesForPosition(
    rows[index].member,
    positionId,
  );

  return (
    previousQualifies === currentQualifies &&
    rows[index - 1].eligible &&
    !rows[index].eligible
  );
};

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
    return (
      issues.replace || issues.shadow || issues.reverseShadow || "Unavailable"
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
