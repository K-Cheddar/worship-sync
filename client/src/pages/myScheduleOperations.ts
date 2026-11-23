import type { AcceptPendingAssignmentsResponse, MyScheduleOccurrence } from "../api/auth";
import type { TeamRosterMember } from "../api/authTypes";

export type MyScheduleMember = Pick<TeamRosterMember, "memberId" | "churchId" | "firstName" | "lastName" | "blockoutDates" | "updatedAt" | "servingFrequency" | "recurringAvailability">;
export type VolunteerAvailabilityAnswer = "available" | "unavailable";
export type VolunteerSchedulingPreferences = {
  servingFrequency: NonNullable<TeamRosterMember["servingFrequency"]>;
  recurringAvailability: NonNullable<TeamRosterMember["recurringAvailability"]>;
  updatedAt: string;
};
export type VolunteerAvailabilityRequest = {
  recipientId: string; formId: string; name: string; responseDeadline: string;
  availabilityMessage: string;
  /** Server-owned submission metadata; saved answer entries alone do not mean submitted. */
  respondedAt: string; submissionId: string; editable: boolean;
  occurrences: {
    occurrenceId: string;
    name: string;
    startsAt: string;
    serviceDate?: string;
    /** Raw issued-form occurrence IDs represented by this projected logical occurrence. */
    responseOccurrenceIds?: string[];
    hasConflictingAnswers?: boolean;
  }[];
  availability: Record<string, VolunteerAvailabilityAnswer>;
  /** Dates inside the form scope with no explicit saved answer. */
  unansweredOccurrenceIds: string[];
  /** Per-occurrence preconditions returned by the server for the next save. */
  availabilityRevision: Record<string, number>;
  conflictingOccurrenceIds?: string[];
};
export type VolunteerAvailabilityRequestSummary = Pick<
  VolunteerAvailabilityRequest,
  "recipientId" | "formId" | "name" | "responseDeadline" | "respondedAt" | "submissionId" | "editable"
>;
export type VolunteerAvailabilityReadOptions = {
  /** Return active request status only; load occurrence details when one opens. */
  summary?: boolean;
  /** Include a minimal roster snapshot when an editor needs conflict recovery. */
  includeMemberSnapshot?: boolean;
  /** Load past request summaries only after a volunteer asks to view history. */
  history?: boolean;
  /** Narrow a full read to one request after the server verifies volunteer scope. */
  recipientId?: string;
};
export type VolunteerAvailabilityRead = {
  success: boolean;
  serviceTimeZone?: string | null;
  requests: VolunteerAvailabilityRequest[];
  requestSummaries?: VolunteerAvailabilityRequestSummary[];
  schedulingPreferences?: VolunteerSchedulingPreferences | null;
  /** Safe roster fields from the same member read as schedulingPreferences. */
  memberSnapshot?: MyScheduleMember | null;
};
export type VolunteerSchedulingPreferencesSave = Pick<
  VolunteerSchedulingPreferences,
  "servingFrequency" | "recurringAvailability"
> & { expectedUpdatedAt: string };
export type VolunteerAvailabilitySave = {
  recipientId: string;
  availability: VolunteerAvailabilityRequest["availability"];
  availabilityRevision: VolunteerAvailabilityRequest["availabilityRevision"];
};
export type VolunteerAvailabilitySaveResult = {
  success: boolean;
  submissionId: string;
  submittedAt?: string;
};
export type VolunteerAvailabilityOperations = {
  loadAvailability: (options?: VolunteerAvailabilityReadOptions) => Promise<VolunteerAvailabilityRead>;
  saveAvailability: (request: VolunteerAvailabilitySave) => Promise<VolunteerAvailabilitySaveResult>;
  saveSchedulingPreferences?: (request: VolunteerSchedulingPreferencesSave) => Promise<{
    success: boolean;
    schedulingPreferences: VolunteerSchedulingPreferences;
    /** Authoritative member fields and revision from the same committed write. */
    memberSnapshot: MyScheduleMember;
  }>;
};
export type VolunteerBulkResult = AcceptPendingAssignmentsResponse;
export type MyScheduleOperations = {
  load: () => Promise<{ success: boolean; serviceTimeZone?: string; churchName?: string; member: MyScheduleMember | null; occurrences: MyScheduleOccurrence[] }>;
  respond: (body: { scheduleId: string; occurrenceId: string; cellKey: string; response: "accepted" | "declined" }) => Promise<{ success: boolean; response: "accepted" | "declined" }>;
  saveBlockouts: (ranges: TeamRosterMember["blockoutDates"], expectedUpdatedAt: string) => Promise<{
    success: boolean;
    member: MyScheduleMember;
    memberSnapshot: MyScheduleMember;
  }>;
  acceptUnanswered: (afterScheduleId?: string) => Promise<VolunteerBulkResult>;
};

export type PersonalScheduleAccess = {
  churchId: string; memberId: string; churchName?: string; sessionKey?: string;
  operations: MyScheduleOperations & Partial<VolunteerAvailabilityOperations>;
};
