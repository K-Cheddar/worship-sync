const MAX_TIME_ZONE_CACHE_ENTRIES = 12_000;
const wallClockFormatterCache = new Map();
const serviceDateOffsetsCache = new Map();
const serviceDateTimeCache = new Map();

const cacheValue = (cache, key, value) => {
  if (cache.size >= MAX_TIME_ZONE_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
};

const wallClockFormatter = (timeZone) => {
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

const wallClockPartsAt = (instant, timeZone) => {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const getServiceDateOffsets = (date, timeZone, naive) => {
  const key = `${timeZone}|${date}`;
  const cached = serviceDateOffsetsCache.get(key);
  if (cached) return cached;
  const offsets = new Set();
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
export const serviceDateTimeInTimeZone = (date, time, timeZone) => {
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
      .filter((instant) => {
        const parts = wallClockPartsAt(instant, timeZone);
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === requested;
      })
      .sort((left, right) => left - right);
    const instant = exact[0] ?? null;
    cacheValue(serviceDateTimeCache, cacheKey, instant);
    return instant === null ? null : new Date(instant);
  } catch {
    cacheValue(serviceDateTimeCache, cacheKey, null);
    return null;
  }
};

/** YYYY-MM-DD for an instant in its church's IANA timezone. */
export const calendarDateInTimeZone = (date, timeZone) => {
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

export const logicalOccurrenceIdForService = (serviceId, serviceDate) =>
  `${String(serviceId || "").trim()}@${serviceDate}`;

export const logicalOccurrenceIdForGroup = (groupId, serviceDate) =>
  `group:${String(groupId || "").trim()}@${serviceDate}`;

const isPlainDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const normalizeServiceIds = (occurrence, serviceId) => {
  const value = Array.isArray(occurrence?.serviceIds) && occurrence.serviceIds.length
    ? occurrence.serviceIds
    : [serviceId];
  return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))].sort();
};

/** Resolve canonical identity without using display names or scheduled instants as ownership evidence. */
export const resolveOccurrenceIdentity = (occurrence, timeZone = "UTC") => {
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

const sameMembership = (left, right) =>
  left.groupId === right.groupId &&
  left.serviceIds.length === right.serviceIds.length &&
  left.serviceIds.every((serviceId, index) => serviceId === right.serviceIds[index]);

export const sameOccurrenceIdentity = (left, right, timeZone = "UTC") => {
  const leftIdentity = resolveOccurrenceIdentity(left, timeZone);
  const rightIdentity = resolveOccurrenceIdentity(right, timeZone);
  return Boolean(
    leftIdentity && rightIdentity &&
    leftIdentity.logicalOccurrenceId === rightIdentity.logicalOccurrenceId &&
    sameMembership(leftIdentity, rightIdentity),
  );
};

/** One-to-one, read-only compatibility matching for legacy timestamp IDs. */
export const matchOccurrencesByIdentity = (stored, current, timeZone = "UTC") => {
  const storedRows = (Array.isArray(stored) ? stored : []).map((occurrence) => ({
    occurrence,
    identity: resolveOccurrenceIdentity(occurrence, timeZone),
  }));
  const matches = new Map();
  const ambiguousCurrentIds = new Set();
  const matchedStoredIds = new Set();

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
      row.identity.serviceIds.some((serviceId) => currentIdentity.serviceIds.includes(serviceId)),
    );
    if (possibleConflict) ambiguousCurrentIds.add(String(occurrence.occurrenceId || ""));
  });

  return { matches, ambiguousCurrentIds, matchedStoredIds };
};

export const occurrenceIdentityListsMatch = (left, right, timeZone = "UTC") => {
  const leftRows = (Array.isArray(left) ? left : []).map((occurrence) =>
    resolveOccurrenceIdentity(occurrence, timeZone),
  );
  const rightRows = (Array.isArray(right) ? right : []).map((occurrence) =>
    resolveOccurrenceIdentity(occurrence, timeZone),
  );
  if (leftRows.some((identity) => !identity) || rightRows.some((identity) => !identity) || leftRows.length !== rightRows.length) {
    return false;
  }
  const keys = (rows) => rows.map((identity) => JSON.stringify([
    identity.logicalOccurrenceId,
    identity.groupId,
    identity.serviceIds,
  ])).sort();
  return keys(leftRows).every((key, index) => key === keys(rightRows)[index]);
};

export const hasOccurrenceIdentityAmbiguity = (stored, current, timeZone = "UTC") => {
  const storedRows = (Array.isArray(stored) ? stored : []).map((occurrence) => ({
    occurrence,
    identity: resolveOccurrenceIdentity(occurrence, timeZone),
  }));
  const currentRows = (Array.isArray(current) ? current : []).map((occurrence) => ({
    occurrence,
    identity: resolveOccurrenceIdentity(occurrence, timeZone),
  }));
  const identityKey = (identity) => identity?.logicalOccurrenceId || "";
  const duplicateKeys = (rows) => {
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
      row.identity.serviceIds.some((serviceId) => identity.serviceIds.includes(serviceId)),
    );
  });
};

export const occurrenceScheduleDetailsMatch = (left, right, timeZone = "UTC") => {
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
export const preserveStoredOccurrenceIds = (stored, current, timeZone = "UTC") => {
  const { matches, ambiguousCurrentIds } = matchOccurrencesByIdentity(stored, current, timeZone);
  if (ambiguousCurrentIds.size || matches.size !== (Array.isArray(current) ? current.length : 0) ||
      matches.size !== (Array.isArray(stored) ? stored.length : 0)) return null;
  return current.map((occurrence) => {
    const previous = matches.get(String(occurrence.occurrenceId || ""));
    return previous ? { ...occurrence, occurrenceId: previous.occurrenceId } : occurrence;
  });
};
