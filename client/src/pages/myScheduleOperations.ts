import type { AcceptPendingAssignmentsResponse, MyScheduleOccurrence } from "../api/auth";
import type { TeamRosterMember } from "../api/authTypes";

export type MyScheduleMember = Pick<TeamRosterMember, "memberId" | "churchId" | "firstName" | "lastName" | "blockoutDates" | "updatedAt">;
export type MyScheduleAvailabilityOccurrence = {
  occurrenceId: string;
  serviceId: string;
  name: string;
  startsAt: string;
  /** Saved church-calendar date when the request carries one. */
  serviceDate?: string;
};
export type VolunteerAvailabilityRequest = {
  recipientId: string; formId: string; name: string; responseDeadline: string;
  availabilityMessage: string; respondedAt: string;
  teamIds: string[]; teamNames: string[];
  occurrences: MyScheduleAvailabilityOccurrence[];
  availability: Record<string, "available" | "unavailable">;
};
export type VolunteerBulkResult = AcceptPendingAssignmentsResponse;
export type MyScheduleOperations = {
  load: () => Promise<{ success: boolean; serviceTimeZone?: string; churchName?: string; member: MyScheduleMember | null; occurrences: MyScheduleOccurrence[] }>;
  respond: (body: { scheduleId: string; occurrenceId: string; cellKey: string; response: "accepted" | "declined" }) => Promise<{ success?: boolean; response?: "accepted" | "declined" }>;
  saveBlockouts: (ranges: TeamRosterMember["blockoutDates"], expectedUpdatedAt: string) => Promise<{ success: boolean; member: MyScheduleMember }>;
  acceptUnanswered: (afterScheduleId?: string) => Promise<VolunteerBulkResult>;
  availability: () => Promise<{ success: boolean; requests: VolunteerAvailabilityRequest[] }>;
  submitAvailability: (recipientId: string, formId: string, occurrenceId: string, availability: "available" | "unavailable") => Promise<unknown>;
};

export type PersonalScheduleAccess = {
  churchId: string; memberId: string; churchName?: string; operations: MyScheduleOperations;
};
