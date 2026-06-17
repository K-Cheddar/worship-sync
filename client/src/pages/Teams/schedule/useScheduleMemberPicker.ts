import { useMemo } from "react";
import type { TeamRosterMember } from "../../../api/authTypes";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";
import {
  buildScheduleMemberPickerMembers,
  shouldOfferCreateMember,
  type ScheduleMemberPickerMember,
} from "./scheduleMemberPickerUtils";

export type UseScheduleMemberPickerArgs = {
  members: TeamRosterMember[];
  positionId: string;
  assignmentQuery: string;
  currentPrimaryMemberId: string;
  duplicateFirstNames: Set<string>;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (
    memberId: string,
  ) => MemberAssignmentActionIssues;
  getWarning?: (memberId: string) => string;
  canCreateMember?: boolean;
  filterByQuery?: boolean;
};

export type UseScheduleMemberPickerResult = {
  positionMembers: ScheduleMemberPickerMember[];
  eligibleMembers: TeamRosterMember[];
  ineligibleMembers: Array<{ member: TeamRosterMember; issue: string }>;
  filteredEligible: TeamRosterMember[];
  filteredIneligible: Array<{ member: TeamRosterMember; issue: string }>;
  showCreateOption: boolean;
  hasPrimaryAssignee: boolean;
};

export const useScheduleMemberPicker = ({
  members,
  positionId,
  assignmentQuery,
  currentPrimaryMemberId,
  duplicateFirstNames,
  getIssue,
  getAssignmentActionIssues,
  getWarning,
  canCreateMember = false,
  filterByQuery = true,
}: UseScheduleMemberPickerArgs): UseScheduleMemberPickerResult => {
  const hasPrimaryAssignee = Boolean(currentPrimaryMemberId);

  const positionMembers = useMemo(
    () =>
      buildScheduleMemberPickerMembers({
        members,
        positionId,
        assignmentQuery,
        currentPrimaryMemberId,
        hasPrimaryAssignee,
        duplicateFirstNames,
        getIssue,
        getAssignmentActionIssues,
        getWarning,
        filterByQuery,
      }),
    [
      assignmentQuery,
      currentPrimaryMemberId,
      duplicateFirstNames,
      filterByQuery,
      getAssignmentActionIssues,
      getIssue,
      getWarning,
      hasPrimaryAssignee,
      members,
      positionId,
    ],
  );

  const eligibleMembers = useMemo(
    () =>
      positionMembers
        .filter((item) => item.eligible)
        .map((item) => item.member),
    [positionMembers],
  );

  const ineligibleMembers = useMemo(
    () =>
      positionMembers
        .filter((item) => !item.eligible)
        .map((item) => ({ member: item.member, issue: item.issue })),
    [positionMembers],
  );

  const showCreateOption = useMemo(
    () =>
      shouldOfferCreateMember({
        members,
        assignmentQuery,
        duplicateFirstNames,
        canCreate: canCreateMember,
      }),
    [assignmentQuery, canCreateMember, duplicateFirstNames, members],
  );

  return {
    positionMembers,
    eligibleMembers,
    ineligibleMembers,
    filteredEligible: eligibleMembers,
    filteredIneligible: ineligibleMembers,
    showCreateOption,
    hasPrimaryAssignee,
  };
};
