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
  // Archived schedules remain authoritative historical snapshots for forms
  // that were already issued. Their archive state affects schedule use, not
  // the identity recorded in the historical occurrence snapshot.
  return (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => teamIds.has(schedule?.teamId))
    .flatMap((schedule) => (Array.isArray(schedule.occurrences) ? schedule.occurrences : [])
      .filter(Boolean)
      .map((occurrence) => ({ schedule, occurrence })));
};

const addToNestedMap = (map, key, schedule, value) => {
  let bySchedule = map.get(key);
  if (!bySchedule) {
    bySchedule = new Map();
    map.set(key, bySchedule);
  }
  const rows = bySchedule.get(schedule) || [];
  rows.push(value);
  bySchedule.set(schedule, rows);
};

/**
 * Resolve each scoped saved schedule row once, then reuse its identity when
 * proving every possible historical grouped/standalone alias.
 */
export const createHistoricalIdentityEvidenceIndex = ({
  form,
  schedules,
  timeZone,
  resolveIdentity = occurrenceIdentity,
}) => {
  const groupedRowsByOccurrence = new Map();
  const standaloneRowsByOccurrence = new Map();

  scheduleRowsForForm(form, schedules).forEach(({ schedule, occurrence }) => {
    const identity = resolveIdentity(occurrence, timeZone);
    if (!identity) return;
    if (identity.groupId) {
      const key = `${identity.groupId}\u0000${identity.serviceDate}`;
      addToNestedMap(groupedRowsByOccurrence, key, schedule, identity);
      return;
    }
    if (identity.serviceIds.length === 1) {
      const key = `${identity.serviceIds[0]}\u0000${identity.serviceDate}`;
      addToNestedMap(standaloneRowsByOccurrence, key, schedule, identity);
    }
  });

  return {
    provesAlias({ groupId, serviceId, serviceDate }) {
      const groupKey = `${groupId}\u0000${serviceDate}`;
      const standaloneKey = `${serviceId}\u0000${serviceDate}`;
      const groupRows = groupedRowsByOccurrence.get(groupKey) || new Map();
      const standaloneRows = standaloneRowsByOccurrence.get(standaloneKey) || new Map();
      const groupMemberships = new Set();
      let hasPairedSnapshot = false;

      for (const identities of groupRows.values()) {
        identities.forEach((identity) => groupMemberships.add(identity.serviceIds.join("\u0000")));
      }

      const schedules = new Set([...groupRows.keys(), ...standaloneRows.keys()]);
      for (const schedule of schedules) {
        const groupMatches = (groupRows.get(schedule) || []).filter((identity) =>
          identity.groupId === groupId && identity.serviceIds.includes(serviceId),
        );
        const serviceMatches = (standaloneRows.get(schedule) || []).filter((identity) =>
          !identity.groupId && identity.serviceIds.length === 1 && identity.serviceIds[0] === serviceId,
        );
        if (groupMatches.length > 1 || serviceMatches.length > 1) return false;
        if (groupMatches.length === 1 && serviceMatches.length === 1) hasPairedSnapshot = true;
      }

      // A repeated group/date with different saved memberships means the
      // historical snapshot no longer identifies one scheduling opportunity.
      return groupMemberships.size === 1 && hasPairedSnapshot;
    },
  };
};

const occurrenceSortKey = (row) => {
  const occurrence = row.occurrence;
  const dateInId = String(occurrence?.occurrenceId || "").match(/@(\d{4}-\d{2}-\d{2})$/)?.[1] || "";
  const date = String(occurrence?.serviceDate || dateInId || occurrence?.startsAt || "").slice(0, 10);
  const startsAt = String(occurrence?.startsAt || "");
  const occurrenceId = String(occurrence?.occurrenceId || "").trim();
  const name = String(occurrence?.name || "");
  return [date, startsAt, occurrenceId, name];
};

const compareOccurrenceRows = (first, second) => {
  const firstKey = occurrenceSortKey(first);
  const secondKey = occurrenceSortKey(second);
  for (let index = 0; index < firstKey.length; index += 1) {
    const comparison = firstKey[index].localeCompare(secondKey[index]);
    if (comparison) return comparison;
  }
  return 0;
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
  const sortedSourceOccurrences = sourceOccurrences
    .map((occurrence) => ({ occurrence }))
    .sort(compareOccurrenceRows)
    .map(({ occurrence }) => occurrence);
  const rawOccurrenceIds = [...new Set(sortedSourceOccurrences
    .map((occurrence) => String(occurrence?.occurrenceId || "").trim())
    .filter(Boolean))].sort();
  const aliasesByGroupOccurrence = new Map();

  if (evidenceComplete && serviceTimeZone && typeof serviceTimeZone === "string") {
    const serviceById = new Map((Array.isArray(services) ? services : [])
      .map((service) => [String(service?.serviceId || service?.id || ""), service]));
    const sourceRows = sortedSourceOccurrences.map((occurrence) => ({
      occurrence,
      occurrenceId: String(occurrence?.occurrenceId || "").trim(),
      groupKey: groupKeyForId(occurrence?.occurrenceId),
      identity: occurrenceIdentity(occurrence, serviceTimeZone),
    }));
    const groupedRows = sourceRows.filter(({ groupKey, identity }) =>
      groupKey && identity?.logicalOccurrenceId === logicalOccurrenceIdForGroup(groupKey.groupId, groupKey.serviceDate),
    );
    const standaloneRows = sourceRows.filter(({ occurrence, identity }) => {
      const serviceId = String(occurrence?.serviceId || "").trim();
      if (!serviceId || String(occurrence?.occurrenceId || "").startsWith("group:")) return false;
      return Boolean(identity && !identity.groupId && identity.serviceIds.length === 1 &&
        identity.serviceIds[0] === serviceId &&
        identity.logicalOccurrenceId === logicalOccurrenceIdForService(serviceId, identity.serviceDate));
    });
    const identityEvidence = createHistoricalIdentityEvidenceIndex({ form, schedules, timeZone: serviceTimeZone });
    const groupedRowsByKey = new Map();
    const candidateStandaloneRowsByGroupKey = new Map();
    groupedRows.forEach((row) => {
      const key = `${row.groupKey.groupId}\u0000${row.groupKey.serviceDate}`;
      groupedRowsByKey.set(key, [...(groupedRowsByKey.get(key) || []), row]);
    });
    standaloneRows.forEach((row) => {
      const serviceId = String(row.occurrence.serviceId || "").trim();
      const service = serviceById.get(serviceId);
      if (!service || service.archivedAt || !service.serviceGroupId) return;
      const key = `${service.serviceGroupId}\u0000${row.identity.serviceDate}`;
      candidateStandaloneRowsByGroupKey.set(key, [
        ...(candidateStandaloneRowsByGroupKey.get(key) || []),
        row,
      ]);
    });

    const proposals = [];
    for (const grouped of groupedRows) {
      const { groupId, serviceDate } = grouped.groupKey;
      const candidateStandalone = candidateStandaloneRowsByGroupKey.get(`${groupId}\u0000${serviceDate}`) || [];
      const possibleStandalone = candidateStandalone.filter(({ occurrence }) => {
        const serviceId = String(occurrence.serviceId || "").trim();
        return identityEvidence.provesAlias({ groupId, serviceId, serviceDate });
      });
      const matchingGroups = groupedRowsByKey.get(`${groupId}\u0000${serviceDate}`) || [];
      const duplicatedServiceIds = new Set(possibleStandalone.map(({ occurrence }) =>
        String(occurrence.serviceId || "").trim(),
      ));
      if (matchingGroups.length !== 1 || !possibleStandalone.length ||
          duplicatedServiceIds.size !== possibleStandalone.length) continue;
      proposals.push({
        groupOccurrenceId: grouped.occurrenceId,
        grouped,
        aliases: possibleStandalone,
      });
    }

    const ownersByAlias = new Map();
    proposals.forEach(({ groupOccurrenceId, aliases }) => aliases.forEach(({ occurrenceId }) => {
      const owners = ownersByAlias.get(occurrenceId) || new Set();
      owners.add(groupOccurrenceId);
      ownersByAlias.set(occurrenceId, owners);
    }));
    proposals.forEach(({ groupOccurrenceId, aliases }) => {
      const uniqueAliases = aliases.filter(({ occurrenceId }) => ownersByAlias.get(occurrenceId)?.size === 1);
      if (uniqueAliases.length) {
        aliasesByGroupOccurrence.set(groupOccurrenceId, [
          groupOccurrenceId,
          ...uniqueAliases.map(({ occurrenceId }) => occurrenceId),
        ]);
      }
    });
  }

  const aliasOwnerByOccurrence = new Map();
  aliasesByGroupOccurrence.forEach((aliasIds, canonicalId) => {
    aliasIds.slice(1).forEach((aliasId) => aliasOwnerByOccurrence.set(aliasId, canonicalId));
  });
  const consumed = new Set();
  const occurrences = [];
  const availability = {};
  const conflictingOccurrenceIds = [];
  for (const source of sortedSourceOccurrences) {
    const occurrenceId = String(source?.occurrenceId || "").trim();
    if (!occurrenceId || consumed.has(occurrenceId) || aliasOwnerByOccurrence.has(occurrenceId)) continue;
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
