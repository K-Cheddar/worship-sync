import { useEffect, useState } from "react";
import type { ServiceTime } from "../types";
import {
  getDisplayedUpcomingService,
  getUpcomingServiceRefreshDelay,
} from "../utils/serviceTimes";

export const useDisplayedUpcomingService = (
  services: ServiceTime[],
  graceMs = 0,
) => {
  const [upcomingService, setUpcomingService] = useState(() =>
    getDisplayedUpcomingService(services, new Date(), graceMs),
  );

  useEffect(() => {
    let timeoutId: number | null = null;

    const syncUpcomingService = () => {
      const now = new Date();
      setUpcomingService(getDisplayedUpcomingService(services, now, graceMs));
      const delayMs = getUpcomingServiceRefreshDelay(services, now, graceMs);
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
  }, [services, graceMs]);

  return upcomingService;
};

export default useDisplayedUpcomingService;
