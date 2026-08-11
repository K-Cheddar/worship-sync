import type { TeamScheduleCellAssignment } from "../../../api/authTypes";

/**
 * Client mirror of `server/scheduleResponses.js`.
 *
 * Kept here rather than in `teamsUtils` because `teamsUtils` already imports
 * from `scheduleRequirements`, and the fill calculation needs these — routing
 * through it would make the cycle.
 */

export type AssignmentResponse = "pending" | "accepted" | "declined";

export type TeamScheduleAssignmentResponse = {
  memberId: string;
  response: AssignmentResponse;
  respondedAt?: string;
};

/** Assignment responses for a schedule, keyed occurrenceId -> cellKey. */
export type TeamScheduleResponses = Record<
  string,
  Record<string, TeamScheduleAssignmentResponse>
>;

/** Cells are sometimes a bare member-id string on rows written before shadows. */
export const readCellPrimaryMemberId = (
  cell: TeamScheduleCellAssignment | string | undefined,
): string => {
  if (typeof cell === "string") return cell;
  return cell?.primaryMemberId || "";
};

/**
 * A response only counts for whoever currently holds the slot — reassigning
 * must not hand the new person the previous one's "accepted".
 */
export const readAssignmentResponse = (
  record: TeamScheduleAssignmentResponse | undefined,
  memberId: string,
): AssignmentResponse => {
  if (!record || !memberId || record.memberId !== memberId) return "pending";
  const value = record.response;
  return value === "accepted" || value === "declined" ? value : "pending";
};
