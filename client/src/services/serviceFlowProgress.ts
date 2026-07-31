import type {
  PublicServiceFlow,
  PublicServiceFlowItem,
  PublicServiceFlowSection,
} from "./serviceFlowTypes";

export type TimedServiceFlowItem = {
  item: PublicServiceFlowItem;
  section: PublicServiceFlowSection;
  startsAtMs: number;
  endsAtMs: number;
};

export type ServiceFlowProgress = {
  state: "upcoming" | "live" | "complete";
  current: TimedServiceFlowItem | null;
  next: TimedServiceFlowItem | null;
  items: TimedServiceFlowItem[];
  isManual: boolean;
  /** The schedule was restarted at a real service-day transition. */
  isAdjusted: boolean;
};

export const getTimedServiceFlowItems = (
  service: PublicServiceFlow,
): TimedServiceFlowItem[] => {
  let startsAtMs = Date.parse(service.startsAt);
  const anchorItemIndex = service.live.mode === "anchored"
    ? service.sections.flatMap((section) => section.items).findIndex(
      (item) => item.id === service.live.currentItemId,
    )
    : -1;
  const anchorStartsAtMs = service.live.mode === "anchored"
    ? Date.parse(service.live.startedAt)
    : Number.NaN;
  let itemIndex = 0;
  return service.sections.flatMap((section) =>
    section.items.map((item) => {
      if (itemIndex === anchorItemIndex && Number.isFinite(anchorStartsAtMs)) {
        startsAtMs = anchorStartsAtMs;
      }
      const durationMs = Math.max(0, item.durationSeconds) * 1000;
      const timed = {
        item,
        section,
        startsAtMs,
        endsAtMs: startsAtMs + durationMs,
      };
      startsAtMs += durationMs;
      itemIndex += 1;
      return timed;
    }),
  );
};

export const getServiceFlowProgress = (
  service: PublicServiceFlow,
  nowMs: number,
): ServiceFlowProgress => {
  const items = getTimedServiceFlowItems(service);
  const live = service.live;
  const manuallySelected = live.mode === "manual"
    ? items.find((timed) => timed.item.id === live.currentItemId) || null
    : null;

  if (manuallySelected) {
    const index = items.indexOf(manuallySelected);
    return {
      state: "live",
      current: manuallySelected,
      next: items[index + 1] || null,
      items,
      isManual: true,
      isAdjusted: false,
    };
  }

  const anchoredItemIndex = live.mode === "anchored"
    ? items.findIndex((timed) => timed.item.id === live.currentItemId)
    : -1;
  // Planned items before the re-anchor can overlap the adjusted time range.
  // They are already complete in the real service, so never select them again.
  const activeItems = anchoredItemIndex >= 0 ? items.slice(anchoredItemIndex) : items;
  let scheduled = activeItems.find(
    (timed) => nowMs >= timed.startsAtMs && nowMs < timed.endsAtMs,
  ) || null;
  // A zero-duration plan has no boundaries to advance through. Keep a newly
  // anchored item live in that case rather than making it disappear instantly.
  if (
    !scheduled &&
    live.mode === "anchored" &&
    anchoredItemIndex >= 0 &&
    !activeItems.some((timed) => timed.endsAtMs > timed.startsAtMs)
  ) {
    scheduled = items[anchoredItemIndex];
  }
  const plannedStartMs = Date.parse(service.startsAt);
  // A Make live anchor restarts the timeline at its selected item. The service
  // status must use that same boundary; otherwise an early anchor would still
  // read as upcoming until the originally planned start time.
  const effectiveStartMs = activeItems[0]?.startsAtMs ?? plannedStartMs;
  const last = activeItems.at(-1);
  // With no durations set anywhere, every item ends the instant it starts, so
  // the plan would read as "complete" the moment it begins. Without any
  // duration information there is nothing to say the service has ended, so it
  // stays live once started.
  const hasAnyDuration = Boolean(last && last.endsAtMs > effectiveStartMs);
  const state = nowMs < effectiveStartMs
    ? "upcoming"
    : hasAnyDuration && last && nowMs >= last.endsAtMs
      ? "complete"
      : "live";
  const index = scheduled ? items.indexOf(scheduled) : -1;
  return {
    state,
    current: scheduled,
    next: scheduled ? items[index + 1] || null : state === "upcoming" ? items[0] || null : null,
    items,
    isManual: false,
    isAdjusted:
      service.live.mode === "anchored" &&
      items.some((timed) => timed.item.id === service.live.currentItemId),
  };
};
