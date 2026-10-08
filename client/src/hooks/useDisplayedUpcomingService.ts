import { useEffect, useState, useSyncExternalStore } from "react";
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
  const serviceTimeZone = useChurchServiceTimeZone().timeZone || "UTC";
  const serverTimeOffset = useSyncExternalStore(
    subscribeServerTimeOffset,
    getServerTimeOffset,
    getServerTimeOffset,
  );
  const [upcomingService, setUpcomingService] = useState(() =>
    getDisplayedUpcomingService(services, serverDate(), graceMs, {
      keepRecentlyElapsedDuringGrace,
    }, serviceTimeZone),
  );

  useEffect(() => {
    let timeoutId: number | null = null;

    const syncUpcomingService = () => {
      const now = serverDate();
      setUpcomingService(
        getDisplayedUpcomingService(services, now, graceMs, {
          keepRecentlyElapsedDuringGrace,
        }, serviceTimeZone),
      );
      const delayMs = getUpcomingServiceRefreshDelay(
        services,
        now,
        graceMs,
        { keepRecentlyElapsedDuringGrace },
        serviceTimeZone,
      );
      if (delayMs != null) {
        timeoutId = window.setTimeout(syncUpcomingService, delayMs);
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

  return upcomingService;
};

export default useDisplayedUpcomingService;
