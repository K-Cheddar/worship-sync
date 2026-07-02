import {
  useEffect,
  useMemo,
} from "react";
import StreamInfoComponent from "../components/StreamInfo/StreamInfo";
import { useDispatch, useSelector } from "../hooks";
import { RootState } from "../store/store";
import useNextServiceCountdownText from "../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../hooks/useDisplayedUpcomingService";
import { updateService } from "../store/serviceTimesSlice";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../constants/nextServiceTimer";
import { serverDate } from "../utils/serverTime";

const StreamInfo = () => {
  const dispatch = useDispatch();
  const services = useSelector(
    (state: RootState) => state.undoable.present.serviceTimes.list,
  );

  const upcomingService = useDisplayedUpcomingService(
    services,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );

  const targetIso = useMemo(() => {
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [upcomingService]);
  const timeText = useNextServiceCountdownText(targetIso);

  // Clear overrideDateTimeISO when the time passes
  useEffect(() => {
    const checkAndClearOverrides = () => {
      const now = serverDate();
      services.forEach((service) => {
        if (service.overrideDateTimeISO) {
          const overrideTime = new Date(service.overrideDateTimeISO);
          if (overrideTime <= now) {
            // Time has passed, clear the override
            // Update Redux which will sync to Firebase, updating local state
            dispatch(
              updateService({
                id: service.id,
                changes: { overrideDateTimeISO: undefined },
              })
            );
          }
        }
      });
    };

    // Check immediately
    checkAndClearOverrides();

    // Check every minute to catch any expired overrides
    const interval = setInterval(checkAndClearOverrides, 60000);

    return () => clearInterval(interval);
  }, [dispatch, services]);

  return (
    <StreamInfoComponent
      upcomingService={upcomingService?.service}
      timeText={timeText}
    />
  );
};

export default StreamInfo;
