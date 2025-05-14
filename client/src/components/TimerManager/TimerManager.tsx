import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { tickTimers, setIntervalId } from "../../store/timersSlice";

const TimerManager = () => {
  const dispatch = useDispatch();
  const { intervalId, timers } = useSelector(
    (state: RootState) => state.timers
  );
  const hasRunningTimers = timers.some(
    (timer) => timer.isActive && timer.timerInfo?.status === "running"
  );

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
