const formatterCache = new Map();

export const isValidPortableTimeZone = (timeZone) => {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

const calendarPartsAt = (instant, timeZone) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(instant).map(({ type, value }) => [type, value]));

export const formatPortableDate = (instant, timeZone = "UTC") => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime()) || !isValidPortableTimeZone(timeZone)) return "";
  const parts = calendarPartsAt(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const formatPortableTime = (instant, timeZone = "UTC") => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime()) || !isValidPortableTimeZone(timeZone)) return "";
  const parts = calendarPartsAt(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
};

const partsAt = (instant, timeZone) => {
  if (!formatterCache.has(timeZone)) formatterCache.set(timeZone, new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }));
  const parts = formatterCache.get(timeZone).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
};

/** Convert a portable wall-clock date/time using the same browser timezone the
 * schedule UI uses, without depending on the Node process timezone. */
export const portableWallClockToIso = (date, time, timeZone = "UTC") => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const requested = `${date}T${time}:00`;
  const naive = Date.parse(`${requested}Z`);
  if (Number.isNaN(naive) || new Date(naive).toISOString().slice(0, 19) !== requested) return null;
  try {
    const offsets = new Set();
    for (let hours = -36; hours <= 36; hours += 6) {
      const sample = naive + hours * 60 * 60 * 1000;
      offsets.add(Date.parse(`${partsAt(new Date(sample), timeZone)}Z`) - sample);
    }
    const candidates = [...offsets].map((offset) => naive - offset);
    const exact = candidates.filter((instant) => partsAt(new Date(instant), timeZone) === requested).sort((a, b) => a - b);
    if (exact.length) return new Date(exact[0]).toISOString();
    // Match Date#setHours behavior across a spring-forward gap: move forward
    // by the size of the gap while keeping minutes intact.
    const forward = candidates.map((instant) => ({ instant, wall: partsAt(new Date(instant), timeZone) }))
      .filter(({ wall }) => wall.slice(0, 10) === date && wall > requested)
      .sort((a, b) => a.wall.localeCompare(b.wall) || a.instant - b.instant)[0];
    return forward ? new Date(forward.instant).toISOString() : null;
  } catch {
    return null;
  }
};
