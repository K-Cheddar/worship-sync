import { useEffect, useMemo } from "react";
import { useStore } from "react-redux";
import { useDispatch } from "./reduxHooks";
import {
  NEXT_SERVICE_TIMER_ID,
  getNextServiceTimerId,
} from "../constants/nextServiceTimer";
import { addTimer, deleteTimer } from "../store/timersSlice";
import type { RootState } from "../store/store";
import type { ServiceTime, TimerInfo } from "../types";
import { getEffectiveTargetTime } from "../utils/serviceTimes";

export type UpcomingServiceSelection = {
  service: ServiceTime;
  nextAt: Date;
} | null;

/**
 * Keeps the synthetic `next-service` timer in sync for countdown UIs (stream-info, info controller).
 * Removes the timer when there is no upcoming target or the start time is not in the future.
 */
export const useSyncNextServiceTimer = (
  upcomingService: UpcomingServiceSelection,
  hostId: string | undefined,
) => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();

  const targetIso = useMemo(() => {
    if (!upcomingService) return null;
    const effectiveTime = getEffectiveTargetTime(upcomingService.service);
    return effectiveTime ? effectiveTime.toISOString() : null;
  }, [upcomingService]);

  useEffect(() => {
    const timerId = getNextServiceTimerId(hostId);

    const clearNextServiceTimer = () => {
      dispatch(deleteTimer(timerId));
      if (timerId !== NEXT_SERVICE_TIMER_ID) {
        dispatch(deleteTimer(NEXT_SERVICE_TIMER_ID));
      }
    };

    const service = upcomingService?.service;
    if (!targetIso || !service) {
      clearNextServiceTimer();
      return clearNextServiceTimer;
    }

    const target = new Date(targetIso);
    const now = new Date();
    const remainingSeconds = Math.max(
      0,
      Math.floor((target.getTime() - now.getTime()) / 1000),
    );

    if (remainingSeconds <= 0) {
      clearNextServiceTimer();
      return clearNextServiceTimer;
    }

    const resolvedHostId = hostId?.trim() ? hostId : "stream-info";
    const id = timerId;
    const existing = store.getState().timers.timers.find((t) => t.id === id);

    const timerInfo: TimerInfo = {
      hostId: resolvedHostId,
      id,
      name: service.name || "Next Service",
      color: service.color,
      timerType: "timer",
      status: "running",
      isActive: true,
      duration: remainingSeconds,
      remainingTime: remainingSeconds,
      endTime: targetIso,
      showMinutesOnly: false,
    };

    if (existing) {
      dispatch(deleteTimer(id));
    }
    dispatch(addTimer(timerInfo));

    return clearNextServiceTimer;
    // Intentionally narrow deps: avoid loops when timers tick; `store` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror StreamInfo page behavior
  }, [dispatch, store, targetIso, upcomingService?.service?.id, hostId]);

  return targetIso;
};
