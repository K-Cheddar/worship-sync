import { useContext, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { ref, get, onValue, set } from "firebase/database";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  tickTimers,
  syncTimers,
  syncTimersFromRemote,
  setShouldUpdateTimers,
} from "../../store/timersSlice";
import { TimerInfo } from "../../types";

const TimerManager = () => {
  const dispatch = useDispatch();
  const { user, firebaseDb, hostId } = useContext(GlobalInfoContext) || {};
  const { timers, timersFromDocs } = useSelector(
    (state: RootState) => state.timers
  );
  const intervalRefs = useRef<{ [key: string]: NodeJS.Timeout }>({});

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const getTimersRef = ref(firebaseDb, "users/" + user + "/v2/timers");
    onValue(getTimersRef, (snapshot) => {
      const data = snapshot.val();
      const remoteTimers = data?.filter(
        (timer: TimerInfo) => timer?.hostId !== hostId
      );
      if (remoteTimers?.length > 0) {
        dispatch(syncTimersFromRemote(remoteTimers));
      }
    });
  }, [firebaseDb, user, dispatch, hostId]);

  // on start, remove timers that don't have active hosts
  // then sync timers
  useEffect(() => {
    const removeInactiveTimers = async () => {
      if (!firebaseDb || user === "Demo") return;
      const activeInstancesRef = ref(
        firebaseDb,
        "users/" + user + "/v2/activeInstances"
      );
      const timersRef = ref(firebaseDb, "users/" + user + "/v2/timers");
      const timers = await get(timersRef).then((snapshot) => {
        const data = snapshot.val();
        return data;
      });
      const hostIds = await get(activeInstancesRef).then((snapshot) => {
        const data = snapshot.val();
        if (data) {
          return Object.keys(data);
        }
        return [];
      });

      const timersWithActiveHosts =
        timers?.filter((timer: TimerInfo) => hostIds.includes(timer.hostId)) ||
        [];

      const mergedTimers = [
        ...timersWithActiveHosts,
        ...timersFromDocs.filter(
          (docTimer: TimerInfo) =>
            !timersWithActiveHosts.some(
              (activeTimer: TimerInfo) => activeTimer.id === docTimer.id
            )
        ),
      ].filter((timer) => timer !== undefined);

      dispatch(setShouldUpdateTimers(true));
      set(timersRef, timersWithActiveHosts);
      dispatch(syncTimers(mergedTimers));
    };
    removeInactiveTimers();
  }, [firebaseDb, user, dispatch, hostId, timersFromDocs]);

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
    // Clear all existing intervals
    Object.values(intervalRefs.current).forEach(clearInterval);
    intervalRefs.current = {};

    // Set up new intervals for running timers
    timers.forEach((timer) => {
      if (timer.isActive && timer.status === "running") {
        const intervalId = setInterval(() => {
          dispatch(tickTimers());
        }, 1000);
        intervalRefs.current[timer.id] = intervalId;
      }
    });

    // Cleanup function
    return () => {
      Object.values(intervalRefs.current).forEach(clearInterval);
      intervalRefs.current = {};
    };
  }, [timers, dispatch]);

  return null;
};

export default TimerManager;
