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
import { ServiceTime, TimerInfo } from "../types";
import { onValue, ref } from "firebase/database";
import {
  getClosestUpcomingService,
  getEffectiveTargetTime,
} from "../utils/serviceTimes";
import { useDispatch, useSelector } from "../hooks";
import { RootState } from "../store/store";
import { addTimer, deleteTimer } from "../store/timersSlice";
import { updateService } from "../store/serviceTimesSlice";

const StreamInfo = () => {
  const { user, firebaseDb, hostId } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const timers = useSelector((s: RootState) => s.timers.timers);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [upcomingService, setUpcomingService] = useState<{
    service: ServiceTime;
    nextAt: Date;
  } | null>(null);

  const [services, setServices] = useState<ServiceTime[]>([]);

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const getServicesRef = ref(firebaseDb, "users/" + user + "/v2/services");
    onValue(getServicesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setServices(data);
      }
    });
  }, [firebaseDb, user]);

  const updateUpcomingService = useCallback(() => {
    if (!services?.length) return;
    setUpcomingService(getClosestUpcomingService(services));
  }, [services]);

  useEffect(() => {
    updateUpcomingService();
  }, [updateUpcomingService]);

  const targetIso = useMemo(() => {
    if (!upcomingService) return null;

    // Get the effective target time (considers override if set)
    const effectiveTime = getEffectiveTargetTime(upcomingService.service);
    return effectiveTime ? effectiveTime.toISOString() : null;
  }, [upcomingService]);

  useEffect(() => {
    const service = upcomingService?.service;
    if (!targetIso || !service) return;

    const id = `next-service`;
    const existing = timers.find((t) => t.id === id);

    const target = new Date(targetIso);
    const now = new Date();
    const remainingSeconds = Math.max(
      0,
      Math.floor((target.getTime() - now.getTime()) / 1000)
    );
    if (remainingSeconds <= 0) return;

    const timerInfo: TimerInfo = {
      hostId: hostId || "stream-info",
      id,
      name: service.name || "Next Service",
      color: service.color,
      timerType: "timer",
      status: "running",
      isActive: true,
      duration: remainingSeconds,
      remainingTime: remainingSeconds,
      endTime: targetIso || undefined,
      showMinutesOnly: false,
    };

    if (existing) {
      dispatch(deleteTimer(id));
    }
    dispatch(addTimer(timerInfo));
    // We intentionally exclude `timers` here to avoid an update loop when updating the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, targetIso, upcomingService?.service?.id]);

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
    const fifteenMin = 15 * 60 * 1000;

    let delayMs: number;
    if (msUntilTarget > 0) {
      // schedule at target time + 15 minutes
      delayMs = msUntilTarget + fifteenMin;
    } else {
      // already past target; wait the remaining time in the 15-minute window, or refresh now if beyond it
      const pastMs = Math.abs(msUntilTarget);
      delayMs = Math.max(0, fifteenMin - pastMs);
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

  return <StreamInfoComponent upcomingService={upcomingService?.service} />;
};

export default StreamInfo;
