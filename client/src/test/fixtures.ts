import {
  ServiceItem,
  CreditsInfo,
  OverlayInfo,
  ServiceTime,
  TimerInfo,
  Presentation,
} from "../types";

export const createServiceItem = (
  overrides: Partial<ServiceItem> & { name: string; _id: string },
): ServiceItem => ({
  ...overrides,
  listId: overrides.listId ?? "list-1",
  type: overrides.type ?? "song",
});

export const createCreditsInfo = (
  overrides: Partial<CreditsInfo> & { id: string; heading: string },
): CreditsInfo => ({
  ...overrides,
  text: overrides.text ?? "",
  hidden: overrides.hidden ?? false,
});

export const createOverlay = (
  overrides: Partial<OverlayInfo> & { id: string },
): OverlayInfo => ({
  ...overrides,
  type: overrides.type ?? "participant",
});

export const createServiceTime = (
  overrides: Partial<ServiceTime> & { id: string; name: string },
): ServiceTime => ({
  ...overrides,
  timerType: overrides.timerType ?? "countdown",
  reccurence: overrides.reccurence ?? "one_time",
});

export const createTimerInfo = (
  overrides: Partial<TimerInfo> & { id: string; hostId: string },
): TimerInfo => ({
  ...overrides,
  hostId: overrides.hostId,
  id: overrides.id,
  name: overrides.name ?? "Timer",
  timerType: overrides.timerType ?? "timer",
  status: overrides.status ?? "stopped",
  isActive: overrides.isActive ?? false,
  countdownTime: overrides.countdownTime ?? "00:00",
  duration: overrides.duration ?? 0,
  remainingTime: overrides.remainingTime ?? 0,
});

export const createPresentation = (
  overrides: Partial<Presentation> = {},
): Presentation => ({
  type: "",
  name: "",
  slide: null,
  displayType: "projector",
  ...overrides,
});
