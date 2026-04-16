import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import StreamInfoComponent from "../components/StreamInfo/StreamInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { ServiceTime } from "../types";
import { onValue, ref } from "firebase/database";
import { getClosestUpcomingService, getEffectiveTargetTime } from "../utils/serviceTimes";
import { useDispatch } from "../hooks";
import useNextServiceCountdownText from "../hooks/useNextServiceCountdownText";
import { updateService } from "../store/serviceTimesSlice";
import { getChurchDataPath } from "../utils/firebasePaths";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../constants/nextServiceTimer";

const StreamInfo = () => {
  const { churchId, firebaseDb, loginState } =
    useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [upcomingService, setUpcomingService] = useState<{
    service: ServiceTime;
    nextAt: Date;
  } | null>(null);

  const [services, setServices] = useState<ServiceTime[]>([]);

  useEffect(() => {
    if (!firebaseDb || loginState === "guest" || !churchId) return;

    const getServicesRef = ref(firebaseDb, getChurchDataPath(churchId, "services"));
    onValue(getServicesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setServices(data);
      }
    });
  }, [churchId, firebaseDb, loginState]);

  const updateUpcomingService = useCallback(() => {
    if (!services?.length) return;
    setUpcomingService(getClosestUpcomingService(services));
  }, [services]);

  useEffect(() => {
    updateUpcomingService();
  }, [updateUpcomingService]);

  const targetIso = useMemo(() => {
    if (!upcomingService) return null;
    const effectiveTime = getEffectiveTargetTime(upcomingService.service);
    return effectiveTime ? effectiveTime.toISOString() : null;
  }, [upcomingService]);
  const timeText = useNextServiceCountdownText(targetIso);

  // when the current upcomingService reaches 0, wait 15 minutes, then refresh
  useEffect(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current as unknown as number);
      intervalRef.current = null;
    }

    if (!targetIso) return;

    const now = new Date();
    const target = new Date(targetIso);
    const msUntilTarget = target.getTime() - now.getTime();
    let delayMs: number;
    if (msUntilTarget > 0) {
      // schedule at target time + grace window
      delayMs = msUntilTarget + NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS;
    } else {
      // already past target; wait the remaining time in the grace window, or refresh now if beyond it
      const pastMs = Math.abs(msUntilTarget);
      delayMs = Math.max(0, NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS - pastMs);
    }

    if (delayMs === 0) {
      updateUpcomingService();
      return;
    }

    intervalRef.current = setTimeout(() => {
      updateUpcomingService();
      intervalRef.current = null;
    }, delayMs) as unknown as NodeJS.Timeout;

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current as unknown as number);
        intervalRef.current = null;
      }
    };
  }, [targetIso, updateUpcomingService]);

  // Clear overrideDateTimeISO when the time passes
  useEffect(() => {
    const checkAndClearOverrides = () => {
      const now = new Date();
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
