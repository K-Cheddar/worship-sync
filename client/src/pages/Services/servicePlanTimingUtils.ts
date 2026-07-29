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
    i === index - 1 ? { ...item, durationMinutes: previousDuration } : item,
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
  const updated = applyStartTimeChange(flat, index, startTime).map(
    (element, itemIndex) => {
      if (itemIndex !== index - 1) return element;
      const durationMinutes = Math.max(0, Number(element.durationMinutes) || 0);
      return {
        ...element,
        durationMinutes,
        durationSeconds: Math.round(durationMinutes * 60),
      };
    },
  );
  return writeBackFlatElements(sections, updated);
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
