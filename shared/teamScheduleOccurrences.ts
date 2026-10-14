export type OccurrenceIdentityShape = {
  occurrenceId?: string;
  logicalOccurrenceId?: string;
  serviceId?: string;
  serviceIds?: string[];
  groupId?: string;
  serviceDate?: string;
  startsAt?: string;
  name?: string;
};

type OccurrenceIdentity = {
  logicalOccurrenceId: string;
  serviceDate: string;
  groupId: string;
  serviceIds: string[];
};

const MAX_TIME_ZONE_CACHE_ENTRIES = 12_000;
const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>();
const serviceDateOffsetsCache = new Map<string, number[]>();
const serviceDateTimeCache = new Map<string, number | null>();

const cacheValue = <T>(cache: Map<string, T>, key: string, value: T): T => {
  if (cache.size >= MAX_TIME_ZONE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
  return value;
};

const wallClockFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = wallClockFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  wallClockFormatterCache.set(timeZone, formatter);
  return formatter;
};

const wallClockPartsAt = (instant: number, timeZone: string): Record<string, string> => {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value])) as Record<string, string>;
};

const getServiceDateOffsets = (date: string, timeZone: string, naive: number): number[] => {
  const key = `${timeZone}|${date}`;
  const cached = serviceDateOffsetsCache.get(key);
  if (cached) return cached;
  const offsets = new Set<number>();
  // Sample both sides of the date so transition days include both valid offsets.
  for (const hours of [-36, 0, 36]) {
    const sample = naive + hours * 60 * 60 * 1000;
    const parts = wallClockPartsAt(sample, timeZone);
    const wallClock = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    offsets.add(Date.parse(`${wallClock}Z`) - sample);
  }
  return cacheValue(serviceDateOffsetsCache, key, [...offsets]);
};

/** Resolve an exact wall-clock time. Gaps return null; folds choose the earlier instant. */
export const serviceDateTimeInTimeZone = (date: string, time: string, timeZone: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return null;
  }
  const cacheKey = `${timeZone}|${date}|${time}`;
  const cached = serviceDateTimeCache.get(cacheKey);
  if (cached !== undefined) return cached === null ? null : new Date(cached);
  const requested = `${date}T${time}:00`;
  const naive = Date.parse(`${requested}Z`);
  try {
    const exact = getServiceDateOffsets(date, timeZone, naive)
      .map((offset) => naive - offset)
      .filter((instant: number) => {
        const parts = wallClockPartsAt(instant, timeZone);
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === requested;
      })
      .sort((left: number, right: number) => left - right);
    const instant = exact[0] ?? null;
    cacheValue(serviceDateTimeCache, cacheKey, instant);
    return instant === null ? null : new Date(instant);
  } catch {
    cacheValue(serviceDateTimeCache, cacheKey, null);
    return null;
  }
};

/** YYYY-MM-DD for an instant in its church's IANA timezone. */
export const calendarDateInTimeZone = (date: Date | string | number, timeZone: string): string => {
  const instant = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const logicalOccurrenceIdForService = (serviceId: string, serviceDate: string): string =>
  `${String(serviceId || "").trim()}@${serviceDate}`;

export const logicalOccurrenceIdForGroup = (groupId: string, serviceDate: string): string =>
  `group:${String(groupId || "").trim()}@${serviceDate}`;

const isPlainDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const normalizeServiceIds = (occurrence: OccurrenceIdentityShape, serviceId: string): string[] => {
  const value = Array.isArray(occurrence?.serviceIds) && occurrence.serviceIds.length
    ? occurrence.serviceIds
    : [serviceId];
  return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))].sort();
};

/** Resolve canonical identity without using display names or scheduled instants as ownership evidence. */
export const resolveOccurrenceIdentity = (
  occurrence: OccurrenceIdentityShape | null | undefined,
  timeZone = "UTC",
): OccurrenceIdentity | null => {
  if (!occurrence || typeof occurrence !== "object") return null;
  const startsAtMs = Date.parse(String(occurrence.startsAt || ""));
  const instantDate = Number.isFinite(startsAtMs)
    ? calendarDateInTimeZone(new Date(startsAtMs), timeZone)
    : "";
  const storedDate = String(occurrence.serviceDate || "").trim();
  // A historical date that disagrees with the authoritative timezone cannot be safely reassigned.
  if (storedDate && !isPlainDate(storedDate)) return null;
  if (storedDate && instantDate && storedDate !== instantDate) return null;

  const legacyGroupMatch = String(occurrence.occurrenceId || "").match(/^group:(.+)@(\d{4}-\d{2}-\d{2})$/);
  const groupId = String(occurrence.groupId || legacyGroupMatch?.[1] || "").trim();
  const serviceId = String(occurrence.serviceId || "").trim();
  const serviceDate = storedDate || legacyGroupMatch?.[2] || instantDate;
  if (!isPlainDate(serviceDate)) return null;

  const serviceIds = normalizeServiceIds(occurrence, serviceId);
  if (serviceIds.length === 0 || (serviceId && !serviceIds.includes(serviceId))) return null;
  if (!groupId && serviceIds.length !== 1) return null;

  const logicalOccurrenceId = groupId
    ? logicalOccurrenceIdForGroup(groupId, serviceDate)
    : logicalOccurrenceIdForService(serviceIds[0], serviceDate);
  const declaredIdentity = String(occurrence.logicalOccurrenceId || "").trim();
  if (declaredIdentity && declaredIdentity !== logicalOccurrenceId) return null;

  return {
    logicalOccurrenceId,
    serviceDate,
    groupId,
    serviceIds,
  };
};

const sameMembership = (
  left: OccurrenceIdentity | null,
  right: OccurrenceIdentity | null,
): boolean => Boolean(
  left && right && left.groupId === right.groupId &&
  left.serviceIds.length === right.serviceIds.length &&
  left.serviceIds.every((serviceId, index) => serviceId === right.serviceIds[index]),
);

const sameNameAndInstant = (left: OccurrenceIdentityShape, right: OccurrenceIdentityShape): boolean => {
  const leftMs = Date.parse(String(left?.startsAt || ""));
  const rightMs = Date.parse(String(right?.startsAt || ""));
  const leftName = String(left?.name || "").trim().toLocaleLowerCase("en-US");
  const rightName = String(right?.name || "").trim().toLocaleLowerCase("en-US");
  return Boolean(Number.isFinite(leftMs) && leftMs === rightMs && leftName && leftName === rightName);
};

export const sameOccurrenceIdentity = (
  left: OccurrenceIdentityShape,
  right: OccurrenceIdentityShape,
  timeZone = "UTC",
): boolean => {
  const leftIdentity = resolveOccurrenceIdentity(left, timeZone);
  const rightIdentity = resolveOccurrenceIdentity(right, timeZone);
  return Boolean(
    leftIdentity && rightIdentity &&
    leftIdentity.logicalOccurrenceId === rightIdentity.logicalOccurrenceId &&
    sameMembership(leftIdentity, rightIdentity),
  );
};

/** One-to-one, read-only compatibility matching for legacy timestamp IDs. */
export const matchOccurrencesByIdentity = <T extends OccurrenceIdentityShape>(
  stored: T[],
  current: T[],
  timeZone = "UTC",
): { matches: Map<string, T>; ambiguousCurrentIds: Set<string>; matchedStoredIds: Set<string> } => {
  const storedRows = (Array.isArray(stored) ? stored : []).map((occurrence) => ({
    occurrence,
    identity: resolveOccurrenceIdentity(occurrence, timeZone),
  }));
  const matches = new Map<string, T>();
  const ambiguousCurrentIds = new Set<string>();
  const matchedStoredIds = new Set<string>();

  (Array.isArray(current) ? current : []).forEach((occurrence) => {
    const currentIdentity = resolveOccurrenceIdentity(occurrence, timeZone);
    if (!currentIdentity) {
      ambiguousCurrentIds.add(String(occurrence?.occurrenceId || ""));
      return;
    }
    const sameKey = storedRows.filter((row) =>
      row.identity?.logicalOccurrenceId === currentIdentity.logicalOccurrenceId,
    );
    if (sameKey.length > 1 || (sameKey.length === 1 && !sameMembership(sameKey[0].identity, currentIdentity))) {
      ambiguousCurrentIds.add(String(occurrence.occurrenceId || ""));
      return;
    }
    if (sameKey.length === 1) {
      matches.set(String(occurrence.occurrenceId || ""), sameKey[0].occurrence);
      matchedStoredIds.add(String(sameKey[0].occurrence?.occurrenceId || ""));
      return;
    }
    const possibleConflict = storedRows.some((row) =>
      row.identity?.serviceDate === currentIdentity.serviceDate &&
      row.identity.serviceIds.some((serviceId) => currentIdentity.serviceIds.includes(serviceId)) ||
      sameNameAndInstant(row.occurrence, occurrence),
    );
    if (possibleConflict) ambiguousCurrentIds.add(String(occurrence.occurrenceId || ""));
  });

  return { matches, ambiguousCurrentIds, matchedStoredIds };
};

export const occurrenceIdentityListsMatch = (
  left: OccurrenceIdentityShape[],
  right: OccurrenceIdentityShape[],
  timeZone = "UTC",
): boolean => {
  const leftRows = (Array.isArray(left) ? left : []).map((occurrence) =>
    resolveOccurrenceIdentity(occurrence, timeZone),
  );
  const rightRows = (Array.isArray(right) ? right : []).map((occurrence) =>
    resolveOccurrenceIdentity(occurrence, timeZone),
  );
  if (leftRows.some((identity) => !identity) || rightRows.some((identity) => !identity) || leftRows.length !== rightRows.length) {
    return false;
  }
  const keys = (rows: OccurrenceIdentity[]) => rows.map((identity) => JSON.stringify([
    identity.logicalOccurrenceId,
    identity.groupId,
    identity.serviceIds,
  ])).sort();
  const validLeftRows = leftRows.filter((identity): identity is OccurrenceIdentity => identity !== null);
  const validRightRows = rightRows.filter((identity): identity is OccurrenceIdentity => identity !== null);
  return keys(validLeftRows).every((key, index) => key === keys(validRightRows)[index]);
};

export const hasOccurrenceIdentityAmbiguity = (
  stored: OccurrenceIdentityShape[],
  current: OccurrenceIdentityShape[],
  timeZone = "UTC",
): boolean => {
  const storedRows = (Array.isArray(stored) ? stored : []).map((occurrence) => ({
    occurrence,
    identity: resolveOccurrenceIdentity(occurrence, timeZone),
  }));
  const currentRows = (Array.isArray(current) ? current : []).map((occurrence) => ({
    occurrence,
    identity: resolveOccurrenceIdentity(occurrence, timeZone),
  }));
  const identityKey = (identity: OccurrenceIdentity | null) => identity?.logicalOccurrenceId || "";
  const duplicateKeys = (rows: Array<{ identity: OccurrenceIdentity | null }>) => {
    const counts = new Map();
    rows.forEach(({ identity }) => {
      const key = identityKey(identity);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.values()].some((count) => count > 1);
  };
  if (duplicateKeys(storedRows) || duplicateKeys(currentRows)) return true;

  return currentRows.some(({ occurrence, identity }) => {
    if (!identity) return true;
    const sameKey = storedRows.filter((row) =>
      identityKey(row.identity) === identity.logicalOccurrenceId,
    );
    if (sameKey.length && !sameMembership(sameKey[0].identity, identity)) return true;
    if (sameKey.length) return false;
    return storedRows.some((row) =>
      row.identity?.serviceDate === identity.serviceDate &&
      row.identity.serviceIds.some((serviceId) => identity.serviceIds.includes(serviceId)) ||
      sameNameAndInstant(row.occurrence, occurrence),
    );
  });
};

export const occurrenceScheduleDetailsMatch = (
  left: OccurrenceIdentityShape[],
  right: OccurrenceIdentityShape[],
  timeZone = "UTC",
): boolean => {
  if (!occurrenceIdentityListsMatch(left, right, timeZone)) return false;
  const currentByIdentity = new Map((Array.isArray(right) ? right : []).map((occurrence) => {
    const identity = resolveOccurrenceIdentity(occurrence, timeZone);
    return [JSON.stringify([identity?.logicalOccurrenceId, identity?.serviceIds]), occurrence];
  }));
  return (Array.isArray(left) ? left : []).every((occurrence) => {
    const identity = resolveOccurrenceIdentity(occurrence, timeZone);
    const current = currentByIdentity.get(JSON.stringify([identity?.logicalOccurrenceId, identity?.serviceIds]));
    return current && occurrence.startsAt === current.startsAt &&
      (occurrence.serviceDate || identity?.serviceDate) === (current.serviceDate || identity?.serviceDate);
  });
};

/** Keep the old map key when refreshing a unique, unchanged logical occurrence. */
export const preserveStoredOccurrenceIds = <T extends OccurrenceIdentityShape>(
  stored: T[],
  current: T[],
  timeZone = "UTC",
): T[] | null => {
  const { matches, ambiguousCurrentIds } = matchOccurrencesByIdentity(stored, current, timeZone);
  if (ambiguousCurrentIds.size || matches.size !== (Array.isArray(current) ? current.length : 0) ||
      matches.size !== (Array.isArray(stored) ? stored.length : 0)) return null;
  return current.map((occurrence) => {
    const previous = matches.get(String(occurrence.occurrenceId || ""));
    return previous ? { ...occurrence, occurrenceId: previous.occurrenceId } : occurrence;
  });
};
