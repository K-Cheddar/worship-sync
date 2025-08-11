import { useContext, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { ref, get, onValue } from "firebase/database";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  tickTimers,
  syncTimers,
  syncTimersFromRemote,
  setShouldUpdateTimers,
} from "../../store/timersSlice";
import { TimerInfo } from "../../types";
import { mergeTimers } from "../../utils/timerUtils";

const TimerManager = () => {
  const dispatch = useDispatch();
  const { user, firebaseDb, hostId } = useContext(GlobalInfoContext) || {};
  const { timers, timersFromDocs } = useSelector(
    (state: RootState) => state.timers,
  );
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!firebaseDb || user === "Demo" || !hostId) return;

    const getTimersRef = ref(firebaseDb, "users/" + user + "/v2/timers");
    onValue(getTimersRef, (snapshot) => {
      const data = snapshot.val();
      const remoteTimers = data?.filter(
        (timer: TimerInfo) => timer?.hostId !== hostId,
      );

      if (remoteTimers?.length > 0) {
        dispatch(syncTimersFromRemote(remoteTimers));
      }
    });
  }, [firebaseDb, user, dispatch, hostId]);

  useEffect(() => {
    const removeInactiveTimers = async() => {
      if (!firebaseDb || user === "Demo" || !hostId) return;

      const activeInstancesRef = ref(
        firebaseDb,
        "users/" + user + "/v2/activeInstances",
      );
      const timersRef = ref(firebaseDb, "users/" + user + "/v2/timers");
      const timers = await get(timersRef).then((snapshot) => snapshot.val());
      const hostIds = await get(activeInstancesRef).then((snapshot) =>
        snapshot.val() ? Object.keys(snapshot.val()) : [],
      );

      const timersWithActiveHosts =
        timers?.filter((timer: TimerInfo) => hostIds.includes(timer.hostId)) ||
        [];

      const mergedTimers = mergeTimers(
        timersWithActiveHosts,
        timersFromDocs,
        hostId,
      );

      dispatch(setShouldUpdateTimers(true));
      dispatch(syncTimers(mergedTimers));
    };

    removeInactiveTimers();
  }, [firebaseDb, user, dispatch, hostId, timersFromDocs]);

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const activeInstancesRef = ref(
      firebaseDb,
      "users/" + user + "/v2/activeInstances",
    );
    onValue(activeInstancesRef, (snapshot) => {
      const data = snapshot.val();
      dispatch(setShouldUpdateTimers(data?.length > 0));
    });
  }, [firebaseDb, user, dispatch]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    // Only set up interval if there are running timers
    const hasRunningTimers = timers.some(
      (timer) => timer.isActive && timer.status === "running",
    );

    if (hasRunningTimers) {
      const currentInterval = setInterval(() => {
        const now = Date.now();
        const runningTimers = timers.filter(
          (timer) =>
            timer.isActive && timer.status === "running" && timer.endTime,
        );

        // Check if any timer needs updating
        const shouldUpdate = runningTimers.some((timer) => {
          const endTime = new Date(timer.endTime!).getTime();
          const remainingSeconds = Math.floor((endTime - now) / 1000);
          return remainingSeconds !== timer.remainingTime;
        });

        if (shouldUpdate) {
          dispatch(tickTimers());
        }
      }, 16); // ~60fps for smoother updates

      intervalRef.current = currentInterval;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timers, dispatch]);

  return null;
};

export default TimerManager;
