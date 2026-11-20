import {
  logicalOccurrenceIdForGroup,
  logicalOccurrenceIdForService,
  resolveOccurrenceIdentity,
} from "../shared/teamScheduleOccurrences.ts";

const groupKeyForId = (occurrenceId) => {
  const match = String(occurrenceId || "").match(/^group:(.+)@(\d{4}-\d{2}-\d{2})$/);
  return match ? { groupId: match[1], serviceDate: match[2] } : null;
};

const validAnswer = (answer) => answer === "available" || answer === "unavailable";

const occurrenceIdentity = (occurrence, timeZone) =>
  resolveOccurrenceIdentity(occurrence, timeZone);

const scheduleRowsForForm = (form, schedules) => {
  const teamIds = Array.isArray(form?.teamIds)
    ? new Set(form.teamIds.filter((teamId) => typeof teamId === "string" && teamId.trim()))
    : new Set();
  if (!teamIds.size) return [];
  return (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => teamIds.has(schedule?.teamId) && !schedule?.archivedAt)
    .flatMap((schedule) => (Array.isArray(schedule.occurrences) ? schedule.occurrences : [])
      .filter(Boolean)
      .map((occurrence) => ({ schedule, occurrence })));
};

const hasSavedIdentityProof = ({ form, groupId, serviceId, serviceDate, schedules, timeZone }) => {
  const rows = scheduleRowsForForm(form, schedules);
  const groupLogicalId = logicalOccurrenceIdForGroup(groupId, serviceDate);
  const serviceLogicalId = logicalOccurrenceIdForService(serviceId, serviceDate);
  const rowsBySchedule = new Map();
  rows.forEach(({ schedule, occurrence }) => {
    const sameScheduleRows = rowsBySchedule.get(schedule) || [];
    sameScheduleRows.push({ occurrence, identity: occurrenceIdentity(occurrence, timeZone) });
    rowsBySchedule.set(schedule, sameScheduleRows);
  });
  const groupMemberships = new Set();
  let hasPairedSnapshot = false;

  for (const sameScheduleRows of rowsBySchedule.values()) {
    const groupSnapshots = sameScheduleRows.filter(({ identity }) =>
      identity?.logicalOccurrenceId === groupLogicalId && identity.groupId === groupId,
    );
    groupSnapshots.forEach(({ identity }) => groupMemberships.add(identity.serviceIds.join("\u0000")));
    const groupMatches = groupSnapshots.filter(({ identity }) => identity.serviceIds.includes(serviceId));
    const serviceMatches = sameScheduleRows.filter(({ identity }) =>
      identity?.logicalOccurrenceId === serviceLogicalId && !identity.groupId &&
      identity.serviceIds.length === 1 && identity.serviceIds[0] === serviceId,
    );
    if (groupMatches.length === 1 && serviceMatches.length === 1) hasPairedSnapshot = true;
    if (groupMatches.length > 1 || serviceMatches.length > 1) return false;
  }

  // A repeated group/date with different saved memberships means the historical
  // snapshot no longer identifies one unambiguous scheduling opportunity.
  return groupMemberships.size === 1 && hasPairedSnapshot;
};

/**
 * Read-only compatibility projection for already-issued availability forms.
 * The saved form scope and revisions remain raw; only pairs proven by exact
 * saved schedule identities are presented as one logical occurrence.
 */
export const projectVolunteerAvailabilityResponse = ({
  form,
  member,
  serviceTimeZone,
  services = [],
  schedules = [],
  evidenceComplete = true,
}) => {
  const sourceOccurrences = Array.isArray(form?.availabilityOccurrences)
    ? form.availabilityOccurrences
    : [];
  const rawOccurrenceIds = [...new Set(sourceOccurrences
    .map((occurrence) => String(occurrence?.occurrenceId || "").trim())
    .filter(Boolean))];
  const aliasesByGroupOccurrence = new Map();

  if (evidenceComplete && serviceTimeZone && typeof serviceTimeZone === "string") {
    const serviceById = new Map((Array.isArray(services) ? services : [])
      .map((service) => [String(service?.serviceId || service?.id || ""), service]));
    const groupedRows = sourceOccurrences.flatMap((occurrence) => {
      const key = groupKeyForId(occurrence?.occurrenceId);
      if (!key) return [];
      const identity = occurrenceIdentity(occurrence, serviceTimeZone);
      return identity?.logicalOccurrenceId === logicalOccurrenceIdForGroup(key.groupId, key.serviceDate)
        ? [{ occurrence, ...key }]
        : [];
    });
    const standaloneRows = sourceOccurrences.filter((occurrence) => {
      const serviceId = String(occurrence?.serviceId || "").trim();
      if (!serviceId || String(occurrence?.occurrenceId || "").startsWith("group:")) return false;
      const identity = occurrenceIdentity(occurrence, serviceTimeZone);
      return Boolean(identity && !identity.groupId && identity.serviceIds.length === 1 &&
        identity.serviceIds[0] === serviceId &&
        identity.logicalOccurrenceId === logicalOccurrenceIdForService(serviceId, identity.serviceDate));
    });

    for (const grouped of groupedRows) {
      const groupId = grouped.groupId;
      const groupOccurrenceId = String(grouped.occurrence.occurrenceId);
      const candidateStandalone = standaloneRows.filter((occurrence) => {
        const serviceId = String(occurrence.serviceId || "").trim();
        const identity = occurrenceIdentity(occurrence, serviceTimeZone);
        const service = serviceById.get(serviceId);
        return identity?.serviceDate === grouped.serviceDate &&
          service && !service.archivedAt && service.serviceGroupId === groupId;
      });
      const possibleStandalone = candidateStandalone.filter((occurrence) => {
        const serviceId = String(occurrence.serviceId || "").trim();
        return hasSavedIdentityProof({
            form, groupId, serviceId, serviceDate: grouped.serviceDate,
            schedules, timeZone: serviceTimeZone,
          });
      });
      const matchingGroups = groupedRows.filter((candidate) =>
        candidate.groupId === groupId && candidate.serviceDate === grouped.serviceDate,
      );
      const duplicatedServiceIds = new Set(possibleStandalone.map(({ serviceId }) => serviceId));
      if (matchingGroups.length !== 1 || !possibleStandalone.length ||
          duplicatedServiceIds.size !== possibleStandalone.length) continue;
      const aliasIds = [groupOccurrenceId, ...possibleStandalone.map(({ occurrenceId }) => String(occurrenceId))];
      aliasesByGroupOccurrence.set(groupOccurrenceId, aliasIds);
    }
  }

  const consumed = new Set();
  const occurrences = [];
  const availability = {};
  const conflictingOccurrenceIds = [];
  for (const source of sourceOccurrences) {
    const occurrenceId = String(source?.occurrenceId || "").trim();
    if (!occurrenceId || consumed.has(occurrenceId)) continue;
    const aliasIds = aliasesByGroupOccurrence.get(occurrenceId) || [occurrenceId];
    aliasIds.forEach((id) => consumed.add(id));
    const canonicalId = aliasIds[0];
    const knownAnswers = [...new Set(aliasIds
      .map((id) => member?.serviceAvailability?.[id])
      .filter(validAnswer))];
    if (knownAnswers.length === 1) availability[canonicalId] = knownAnswers[0];
    if (knownAnswers.length > 1) conflictingOccurrenceIds.push(canonicalId);
    occurrences.push({
      occurrenceId: canonicalId,
      name: source.name || "Service",
      startsAt: source.startsAt || "",
      ...(source.serviceDate ? { serviceDate: source.serviceDate } : {}),
      responseOccurrenceIds: aliasIds,
      ...(knownAnswers.length > 1 ? { hasConflictingAnswers: true } : {}),
    });
  }

  return {
    occurrences,
    availability,
    unansweredOccurrenceIds: occurrences
      .map(({ occurrenceId }) => occurrenceId)
      .filter((occurrenceId) => !Object.hasOwn(availability, occurrenceId)),
    availabilityRevision: Object.fromEntries(rawOccurrenceIds.map((occurrenceId) => {
      const revision = member?.serviceAvailabilityRevisions?.[occurrenceId];
      return [occurrenceId, Number.isSafeInteger(revision) && revision >= 0 ? revision : 0];
    })),
    conflictingOccurrenceIds,
  };
};
