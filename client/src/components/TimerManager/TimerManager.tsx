import { useContext, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { ref, get, onValue } from "firebase/database";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  tickTimers,
  setIntervalId,
  syncTimers,
  setHostId,
  updateTimerFromRemote,
  syncTimersFromRemote,
} from "../../store/timersSlice";
import generateRandomId from "../../utils/generateRandomId";
import { TimerInfo } from "../../types";

const TimerManager = () => {
  const dispatch = useDispatch();
  const { user, firebaseDb } = useContext(GlobalInfoContext) || {};
  const { intervalId, timers, hostId } = useSelector(
    (state: RootState) => state.timers
  );
  const hasRunningTimers = timers.some(
    (timer) => timer.isActive && timer.status === "running"
  );

  useEffect(() => {
    dispatch(setHostId(generateRandomId()));
  }, [dispatch]);

  useEffect(() => {
    if (!firebaseDb || user === "Demo") return;

    const getTimersRef = ref(firebaseDb, "users/" + user + "/v2/timers");
    get(getTimersRef).then((snapshot) => {
      const data = snapshot.val();
      dispatch(syncTimers(data));
    });
    onValue(getTimersRef, (snapshot) => {
      const data = snapshot.val();
      const remoteTimers = data.filter(
        (timer: TimerInfo) => timer?.hostId !== hostId
      );
      if (remoteTimers.length > 0) {
        dispatch(syncTimersFromRemote(remoteTimers));
      }
    });
  }, [firebaseDb, user, dispatch, hostId]);

  useEffect(() => {
    if (hasRunningTimers && !intervalId) {
      const id = setInterval(() => {
        dispatch(tickTimers());
      }, 1000);
      dispatch(setIntervalId(id));
    } else if (!hasRunningTimers && intervalId) {
      clearInterval(intervalId);
      dispatch(setIntervalId(null));
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        dispatch(setIntervalId(null));
      }
    };
  }, [hasRunningTimers, intervalId, dispatch]);

  return null;
};

export default TimerManager;
