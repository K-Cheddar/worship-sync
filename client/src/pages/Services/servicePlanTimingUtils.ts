import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const parseTimeToMinutes = (time: string): number | null => {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const formatMinutesToTime = (totalMinutes: number): string => {
  // The editor's start-time control is minute-granular. Keep an item with a
  // seconds duration in its containing minute rather than rounding it into
  // the next one; public live following still uses durationSeconds exactly.
  const normalized = Math.floor(((totalMinutes % 1440) + 1440) % 1440);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

/** Minutes past midnight for an instant, read in the plan's own timezone. */
const localMinutesInTimezone = (
  timeMs: number,
  timeZone: string,
): number | null => {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timeMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    // An unusable stored zone shouldn't break the timeline.
    return null;
  }
};

const getFirstElementStartTime = (sections: ServicePlanSection[]): string => {
  for (const section of sections || []) {
    for (const element of section?.elements || []) {
      const startTime = String(element?.startTime || "").trim();
      if (TIME_PATTERN.test(startTime)) return startTime;
    }
  }
  return "";
};

/**
 * The instant the plan's item timeline begins. Start times chain forward from
 * the FIRST element, whose wall clock can sit before the occurrence's own
 * start (a 9:45 pre-service item on a 10:00 service), so the occurrence time
 * is the wrong anchor — following items would all read late by that gap.
 * Falls back to the occurrence start when no element carries a usable time.
 */
export const resolvePlanTimelineStartMs = (
  startsAtMs: number,
  timezone: string,
  sections: ServicePlanSection[],
): number => {
  const match = TIME_PATTERN.exec(getFirstElementStartTime(sections));
  if (!match) return startsAtMs;
  const planStartMinutes = localMinutesInTimezone(startsAtMs, timezone);
  if (planStartMinutes == null) return startsAtMs;
  let deltaMinutes = Number(match[1]) * 60 + Number(match[2]) - planStartMinutes;
  // Element times are bare wall clocks with no date, so keep the anchor on the
  // nearest side of the service start rather than jumping most of a day.
  if (deltaMinutes > 720) deltaMinutes -= 1440;
  else if (deltaMinutes < -720) deltaMinutes += 1440;
  return startsAtMs + deltaMinutes * 60_000;
};

type TimedItem = {
  startTime?: string;
  durationSeconds?: number;
  durationMinutes?: number;
};

const getTimedItemDurationMinutes = (item: TimedItem): number => {
  const seconds = Number(item.durationSeconds);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds / 60;
  const minutes = Number(item.durationMinutes);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
};

/**
 * Recomputes every item's startTime forward from `anchorStartTime`, chaining
 * item[i].startTime = item[i-1].startTime + item[i-1]'s duration. Exact
 * seconds take precedence when present. Durations are left untouched.
 */
export const recomputeStartTimesFromAnchor = <T extends TimedItem>(
  items: T[],
  anchorStartTime: string,
): T[] => {
  const anchorMinutes = parseTimeToMinutes(anchorStartTime);
  if (anchorMinutes == null) return items;
  let cursor = anchorMinutes;
  return items.map((item) => {
    const startTime = formatMinutesToTime(cursor);
    cursor += getTimedItemDurationMinutes(item);
    return { ...item, startTime };
  });
};

/**
 * After editing item[index]'s duration, every later item's startTime shifts
 * to match (items before `index` are untouched). This is "duration drives
 * time": lengthening/shortening one item pushes everything after it.
 */
export const applyDurationChange = <T extends TimedItem>(
  items: T[],
  index: number,
  durationMinutes: number,
): T[] => {
  if (index < 0 || index >= items.length) return items;
  const nextMinutes = Math.max(0, durationMinutes);
  const updated = items.map((item, i) =>
    i === index
      ? {
          ...item,
          durationMinutes: nextMinutes,
          // Keep seconds in sync — recompute prefers durationSeconds when set.
          durationSeconds: Math.round(nextMinutes * 60),
        }
      : item,
  );
  const anchor = updated[0]?.startTime;
  if (!anchor) return updated;
  return recomputeStartTimesFromAnchor(updated, anchor);
};

/**
 * After editing item[index]'s start time directly, stretch/shrink the
 * PREVIOUS item's duration so it now ends exactly at the new start time (for
 * index 0 there's no previous item — this just moves the whole plan's
 * anchor), then recompute every later start time forward. This is "time
 * drives duration": pulling one item's start earlier/later resizes what
 * comes right before it.
 */
export const applyStartTimeChange = <T extends TimedItem>(
  items: T[],
  index: number,
  startTime: string,
): T[] => {
  if (index < 0 || index >= items.length) return items;
  const newStartMinutes = parseTimeToMinutes(startTime);
  if (newStartMinutes == null) return items;

  if (index === 0) {
    return recomputeStartTimesFromAnchor(items, startTime);
  }

  const previous = items[index - 1];
  const previousStartMinutes = previous.startTime
    ? parseTimeToMinutes(previous.startTime)
    : null;
  if (previousStartMinutes == null) return items;
  const previousDuration = Math.max(0, newStartMinutes - previousStartMinutes);
  const updated = items.map((item, i) =>
    i === index - 1
      ? {
          ...item,
          durationMinutes: previousDuration,
          // Must be written *before* the recompute below: that reads duration
          // via getTimedItemDurationMinutes, which prefers durationSeconds —
          // leaving the old seconds here would recompute every later start
          // time from the stale duration.
          durationSeconds: Math.round(previousDuration * 60),
        }
      : item,
  );
  const anchor = updated[0]?.startTime;
  if (!anchor) return updated;
  return recomputeStartTimesFromAnchor(updated, anchor);
};

// --- Section-aware wrappers: the timing chain runs continuously across every
// section in order, but elements live nested inside sections, so these flatten
// to run the chain math above, then write results back into place. ---

const flattenElements = (
  sections: ServicePlanSection[],
): ServicePlanElement[] => sections.flatMap((section) => section.elements);

const writeBackFlatElements = (
  sections: ServicePlanSection[],
  flat: ServicePlanElement[],
): ServicePlanSection[] => {
  const byId = new Map(flat.map((element) => [element.id, element]));
  return sections.map((section) => ({
    ...section,
    elements: section.elements.map(
      (element) => byId.get(element.id) || element,
    ),
  }));
};

export const applyElementDurationChange = (
  sections: ServicePlanSection[],
  elementId: string,
  durationMinutes: number,
): ServicePlanSection[] => {
  const flat = flattenElements(sections);
  const index = flat.findIndex((element) => element.id === elementId);
  if (index === -1) return sections;
  return writeBackFlatElements(
    sections,
    applyDurationChange(flat, index, durationMinutes),
  );
};

/** New duration editor path: seconds are canonical while the minute value is
 * retained for older documents and minute-granular schedule displays. */
export const applyElementDurationSecondsChange = (
  sections: ServicePlanSection[],
  elementId: string,
  durationSeconds: number,
): ServicePlanSection[] => {
  const seconds = Math.max(0, Math.round(durationSeconds));
  const flat = flattenElements(sections);
  const index = flat.findIndex((element) => element.id === elementId);
  if (index === -1) return sections;
  const withDuration = flat.map((element, i) =>
    i === index
      ? {
          ...element,
          durationSeconds: seconds,
          durationMinutes: seconds / 60,
        }
      : element,
  );
  const anchor = withDuration[0]?.startTime;
  const recomputed = anchor
    ? recomputeStartTimesFromAnchor(withDuration, anchor)
    : withDuration;
  return writeBackFlatElements(sections, recomputed);
};

export const applyElementStartTimeChange = (
  sections: ServicePlanSection[],
  elementId: string,
  startTime: string,
): ServicePlanSection[] => {
  const flat = flattenElements(sections);
  const index = flat.findIndex((element) => element.id === elementId);
  if (index === -1) return sections;
  // applyStartTimeChange keeps durationMinutes and durationSeconds in step
  // itself, so there's nothing to reconcile afterwards.
  return writeBackFlatElements(
    sections,
    applyStartTimeChange(flat, index, startTime),
  );
};

/** Set (or reset) the whole plan's anchor start time, recomputing every
 * element's startTime forward from it without touching any durations. */
export const applyPlanAnchorStartTime = (
  sections: ServicePlanSection[],
  anchorStartTime: string,
): ServicePlanSection[] => {
  const flat = flattenElements(sections);
  return writeBackFlatElements(
    sections,
    recomputeStartTimesFromAnchor(flat, anchorStartTime),
  );
};
