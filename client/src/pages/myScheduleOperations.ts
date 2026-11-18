import type { AcceptPendingAssignmentsResponse, MyScheduleOccurrence } from "../api/auth";
import type { TeamRosterMember } from "../api/authTypes";

export type MyScheduleMember = Pick<TeamRosterMember, "memberId" | "churchId" | "firstName" | "lastName" | "blockoutDates" | "updatedAt">;
export type VolunteerAvailabilityRequest = {
  recipientId: string; formId: string; name: string; responseDeadline: string;
  availabilityMessage: string; respondedAt: string; submissionId: string; editable: boolean;
  occurrences: { occurrenceId: string; name: string; startsAt: string; serviceDate?: string }[];
  availability: Record<string, "available" | "unavailable">;
  /** Dates inside the form scope with no explicit saved answer. */
  unansweredOccurrenceIds: string[];
  /** Per-occurrence preconditions returned by the server for the next save. */
  availabilityRevision: Record<string, number>;
};
export type VolunteerBulkResult = AcceptPendingAssignmentsResponse;
export type MyScheduleOperations = {
  load: () => Promise<{ success: boolean; serviceTimeZone?: string; churchName?: string; member: MyScheduleMember | null; occurrences: MyScheduleOccurrence[] }>;
  respond: (body: { scheduleId: string; occurrenceId: string; cellKey: string; response: "accepted" | "declined" }) => Promise<{ success: boolean; response: "accepted" | "declined" }>;
  saveBlockouts: (ranges: TeamRosterMember["blockoutDates"], expectedUpdatedAt: string) => Promise<{ success: boolean; member: MyScheduleMember }>;
  acceptUnanswered: (afterScheduleId?: string) => Promise<VolunteerBulkResult>;
};

export type PersonalScheduleAccess = {
  churchId: string; memberId: string; churchName?: string; operations: MyScheduleOperations;
};
