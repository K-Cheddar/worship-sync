import { useCallback, useContext, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  flushPendingTimerWrites,
  tickTimers,
  setShouldUpdateTimers,
} from "../../store/timersSlice";
import { useSyncRemoteTimers, useFirebaseValueWithRetry } from "../../hooks";
import { getChurchDataPath } from "../../utils/firebasePaths";
import { serverNow } from "../../utils/serverTime";

const TimerManager = () => {
  const dispatch = useDispatch();
  const { churchId, firebaseDb, hostId, loginState, sharedDataReady } =
    useContext(GlobalInfoContext) || {};
  const timers = useSelector((state: RootState) => state.timers.timers);
  const shouldUpdateTimers = useSelector(
    (state: RootState) => state.timers.shouldUpdateTimers
  );
  // Latest timers for the ticker to read without re-creating the interval.
  const timersRef = useRef(timers);
  timersRef.current = timers;

  useSyncRemoteTimers(
    firebaseDb,
    churchId,
    loginState === "guest",
    hostId,
    !!sharedDataReady
  );

  const handleActiveInstances = useCallback(
    (data: unknown) => {
      dispatch(
        setShouldUpdateTimers(
          !!data && Object.keys(data as Record<string, unknown>).length > 0
        )
      );
    },
    [dispatch]
  );

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path: churchId ? getChurchDataPath(churchId, "activeInstances") : null,
    enabled:
      !!firebaseDb &&
      !!churchId &&
      loginState !== "guest" &&
      !!sharedDataReady,
    onData: handleActiveInstances,
    label: "active instances",
  });

  useEffect(() => {
    if (!firebaseDb || !churchId || loginState === "guest" || !shouldUpdateTimers) {
      return;
    }

    dispatch(flushPendingTimerWrites());
  }, [churchId, firebaseDb, loginState, shouldUpdateTimers, dispatch]);

  const hasRunningTimers = timers.some(
    (timer) => timer.isActive && timer.status === "running"
  );

  // The displayed per-second countdown is computed locally by the leaf timer
  // components (useLiveRemainingSeconds), so this effect no longer dispatches
  // every second. Its only job is to auto-stop a timer when it actually expires
  // — a real state change other devices must receive. Keyed on the running
  // boolean so it runs continuously rather than being recreated each render.
  useEffect(() => {
    if (!hasRunningTimers) return;

    const intervalId = setInterval(() => {
      const now = serverNow();
      // Any timer still flagged running whose endTime has passed needs to be
      // formally stopped. We key only on status + endTime (NOT remainingTime):
      // a stale reconcile can leave a timer running with remainingTime already
      // 0, and gating on `remainingTime !== 0` would leave it stuck running
      // forever (never firing wrap-up / auto-advance). tickTimers flips it to
      // stopped, so it won't re-dispatch on the next pass.
      const anyExpired = timersRef.current.some(
        (timer) =>
          timer.isActive &&
          timer.status === "running" &&
          timer.endTime &&
          Math.floor((new Date(timer.endTime).getTime() - now) / 1000) <= 0
      );
      if (anyExpired) {
        dispatch(tickTimers());
      }
    }, 250);

    return () => clearInterval(intervalId);
  }, [hasRunningTimers, dispatch]);

  return null;
};

export default TimerManager;
