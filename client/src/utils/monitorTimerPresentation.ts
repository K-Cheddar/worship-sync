import { Presentation } from "../types";

/**
 * True when the monitor is showing a timer item's countdown slide ({{timer}}).
 * Normal ItemSlides use type "timer"; quick links historically used type "slide"
 * with the same slide + timerId.
 */
export const isMonitorShowingTimerCountdownSlide = (
  monitorInfo: Presentation
): boolean => {
  if (!monitorInfo.slide) return false;
  const hasTimerToken = monitorInfo.slide.boxes?.[1]?.words?.includes?.(
    "{{timer}}"
  );
  if (!hasTimerToken) return false;
  if (monitorInfo.type === "timer") return true;
  return monitorInfo.type === "slide" && !!monitorInfo.timerId;
};
