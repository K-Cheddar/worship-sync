import { resolveOccurrenceIdentity } from "../shared/teamScheduleOccurrences.ts";

const rowKey = (row) => JSON.stringify([
  row.date,
  row.groupId,
  [...row.serviceIds].sort(),
]);

/**
 * Build a comparison-only view of saved availability occurrences.
 *
 * Group membership comes from the occurrence snapshot itself. Current service
 * group configuration must never rewrite the meaning of an issued form.
 */
export const canonicalizeAvailabilityOccurrenceScope = (
  occurrences,
  timeZone = "UTC",
) => {
  const groupedByDateAndId = new Map();
  const standaloneByDateAndService = new Map();
  let ambiguous = false;

  for (const occurrence of Array.isArray(occurrences) ? occurrences : []) {
    const identity = resolveOccurrenceIdentity(occurrence, timeZone);
    if (!identity) return { keys: [], rows: [], ambiguous: true };
    const row = {
      date: identity.serviceDate,
      groupId: identity.groupId,
      serviceIds: [...identity.serviceIds].sort(),
    };

    if (row.groupId) {
      const key = `${row.date}\u0000${row.groupId}`;
      const existing = groupedByDateAndId.get(key);
      if (existing && rowKey(existing) !== rowKey(row)) ambiguous = true;
      if (!existing) groupedByDateAndId.set(key, row);
      continue;
    }

    const serviceId = row.serviceIds[0];
    const key = `${row.date}\u0000${serviceId}`;
    if (standaloneByDateAndService.has(key)) ambiguous = true;
    else standaloneByDateAndService.set(key, { date: row.date, serviceId });
  }

  const consumedStandaloneKeys = new Set();
  for (const group of groupedByDateAndId.values()) {
    const groupMemberSet = new Set(group.serviceIds);
    const aliases = [...standaloneByDateAndService.entries()].filter(([, row]) =>
      row.date === group.date && groupMemberSet.has(row.serviceId),
    );
    if (!aliases.length) continue;

    const aliasIds = aliases.map(([, row]) => row.serviceId);
    const exactEquivalent = aliasIds.length === groupMemberSet.size &&
      new Set(aliasIds).size === groupMemberSet.size &&
      [...groupMemberSet].every((serviceId) => aliasIds.includes(serviceId));
    if (exactEquivalent) {
      aliases.forEach(([key]) => consumedStandaloneKeys.add(key));
    } else {
      // A partial overlap may be an independent historical occurrence or an
      // incomplete duplicate representation. Preserve it for review.
      ambiguous = true;
    }
  }

  const rows = [
    ...groupedByDateAndId.values(),
    ...[...standaloneByDateAndService.entries()]
      .filter(([key]) => !consumedStandaloneKeys.has(key))
      .map(([, row]) => ({ date: row.date, groupId: "", serviceIds: [row.serviceId] })),
  ];
  const keys = rows.map(rowKey).sort();
  if (new Set(keys).size !== keys.length) ambiguous = true;
  return { keys, rows, ambiguous };
};

export const availabilityOccurrenceScopesOverlap = (left, right) =>
  left.some((leftRow) => right.some((rightRow) =>
    leftRow.date === rightRow.date &&
    leftRow.serviceIds.some((serviceId) => rightRow.serviceIds.includes(serviceId)),
  ));
