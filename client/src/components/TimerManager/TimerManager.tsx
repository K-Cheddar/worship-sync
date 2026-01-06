import { useContext, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { ref, onValue } from "firebase/database";
import { GlobalInfoContext } from "../../context/globalInfo";
import { tickTimers, setShouldUpdateTimers } from "../../store/timersSlice";
import { useSyncRemoteTimers } from "../../hooks";

const TimerManager = () => {
  const dispatch = useDispatch();
  const { user, firebaseDb, hostId } = useContext(GlobalInfoContext) || {};
  const { timers } = useSelector((state: RootState) => state.timers);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  console.log(timers, "timers");

  useSyncRemoteTimers(firebaseDb, user, hostId);

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const activeInstancesRef = ref(
      firebaseDb,
      "users/" + user + "/v2/activeInstances"
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
      (timer) => timer.isActive && timer.status === "running"
    );

    if (hasRunningTimers) {
      const currentInterval = setInterval(() => {
        const now = Date.now();
        const runningTimers = timers.filter(
          (timer) =>
            timer.isActive && timer.status === "running" && timer.endTime
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
