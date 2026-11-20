import { resolveOccurrenceIdentity } from "../../../utils/teamScheduleOccurrences";

type AvailabilityMember = {
  serviceAvailability?: Record<string, "available" | "unavailable" | undefined>;
};

type SchedulingOccurrence = {
  occurrenceId: string;
  serviceId?: string;
  serviceIds?: string[];
  groupId?: string;
  serviceDate?: string;
  startsAt?: string;
};

/**
 * Preserve the exact occurrence answer and also recognize an older individual
 * answer when the saved schedule proves that service is part of this group/date.
 */
export const hasUnavailableAvailabilityAnswer = (
  member: AvailabilityMember | undefined,
  occurrence: SchedulingOccurrence | undefined,
  serviceTimeZone: string,
) => {
  if (!member || !occurrence) return false;
  if (member.serviceAvailability?.[occurrence.occurrenceId] === "unavailable") return true;
  if (!occurrence.groupId) return false;
  const identity = resolveOccurrenceIdentity(occurrence, serviceTimeZone);
  if (!identity?.groupId) return false;
  return identity.serviceIds.some((serviceId) =>
    member.serviceAvailability?.[`${serviceId}@${identity.serviceDate}`] === "unavailable",
  );
};
