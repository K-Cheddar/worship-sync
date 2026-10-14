import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ServiceTime } from "../types";
import {
  getDisplayedUpcomingService,
  getUpcomingServiceRefreshDelay,
} from "../utils/serviceTimes";
import {
  getServerTimeOffset,
  serverDate,
  subscribeServerTimeOffset,
} from "../utils/serverTime";
import { useChurchServiceTimeZone } from "../context/churchServiceTimeZone";

type UseDisplayedUpcomingServiceOptions = {
  keepRecentlyElapsedDuringGrace?: boolean;
};

export const useDisplayedUpcomingService = (
  services: ServiceTime[],
  graceMs = 0,
  options: UseDisplayedUpcomingServiceOptions = {},
) => {
  const keepRecentlyElapsedDuringGrace =
    options.keepRecentlyElapsedDuringGrace ?? false;
  const configuration = useChurchServiceTimeZone();
  const serviceTimeZone = configuration.status === "ready"
    ? configuration.timeZone
    : null;
  const serverTimeOffset = useSyncExternalStore(
    subscribeServerTimeOffset,
    getServerTimeOffset,
    getServerTimeOffset,
  );
  const [occurrenceVersion, refreshOccurrence] = useState(0);

  useEffect(() => {
    let timeoutId: number | null = null;
    if (!serviceTimeZone) {
      return;
    }

    const syncUpcomingService = () => {
      const now = serverDate();
      const delayMs = getUpcomingServiceRefreshDelay(
        services,
        now,
        graceMs,
        { keepRecentlyElapsedDuringGrace },
        serviceTimeZone,
      );
      if (delayMs != null) {
        timeoutId = window.setTimeout(() => {
          refreshOccurrence((version) => version + 1);
          syncUpcomingService();
        }, delayMs);
      }
    };

    syncUpcomingService();

    return () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    services,
    graceMs,
    keepRecentlyElapsedDuringGrace,
    serverTimeOffset,
    serviceTimeZone,
  ]);

  // Countdown text ticks separately; recurrence resolution runs only when its
  // inputs, synchronized clock, or next occurrence boundary change.
  return useMemo(
    () => serviceTimeZone
      ? getDisplayedUpcomingService(services, serverDate(), graceMs, {
        keepRecentlyElapsedDuringGrace,
      }, serviceTimeZone)
      : null,
    // serverDate reads the external clock; offset and boundary tokens must
    // invalidate this memo even though they are not resolver arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, serviceTimeZone, graceMs, keepRecentlyElapsedDuringGrace,
      serverTimeOffset, occurrenceVersion],
  );
};

export default useDisplayedUpcomingService;
