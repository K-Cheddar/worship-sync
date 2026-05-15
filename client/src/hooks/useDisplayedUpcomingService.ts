import { useEffect, useState } from "react";
import type { ServiceTime } from "../types";
import {
  getDisplayedUpcomingService,
  getUpcomingServiceRefreshDelay,
} from "../utils/serviceTimes";

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
  const [upcomingService, setUpcomingService] = useState(() =>
    getDisplayedUpcomingService(services, new Date(), graceMs, {
      keepRecentlyElapsedDuringGrace,
    }),
  );

  useEffect(() => {
    let timeoutId: number | null = null;

    const syncUpcomingService = () => {
      const now = new Date();
      setUpcomingService(
        getDisplayedUpcomingService(services, now, graceMs, {
          keepRecentlyElapsedDuringGrace,
        }),
      );
      const delayMs = getUpcomingServiceRefreshDelay(
        services,
        now,
        graceMs,
        { keepRecentlyElapsedDuringGrace },
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
  }, [services, graceMs, keepRecentlyElapsedDuringGrace]);

  return upcomingService;
};

export default useDisplayedUpcomingService;
