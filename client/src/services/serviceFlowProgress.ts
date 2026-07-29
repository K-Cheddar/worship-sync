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
};

export const getTimedServiceFlowItems = (
  service: PublicServiceFlow,
): TimedServiceFlowItem[] => {
  let startsAtMs = Date.parse(service.startsAt);
  return service.sections.flatMap((section) =>
    section.items.map((item) => {
      const durationMs = Math.max(0, item.durationSeconds) * 1000;
      const timed = {
        item,
        section,
        startsAtMs,
        endsAtMs: startsAtMs + durationMs,
      };
      startsAtMs += durationMs;
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
    };
  }

  const scheduled = items.find(
    (timed) => nowMs >= timed.startsAtMs && nowMs < timed.endsAtMs,
  ) || null;
  const start = Date.parse(service.startsAt);
  const last = items.at(-1);
  // With no durations set anywhere, every item ends the instant it starts, so
  // the plan would read as "complete" the moment it begins. Without any
  // duration information there is nothing to say the service has ended, so it
  // stays live once started.
  const hasAnyDuration = Boolean(last && last.endsAtMs > start);
  const state = nowMs < start
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
  };
};
