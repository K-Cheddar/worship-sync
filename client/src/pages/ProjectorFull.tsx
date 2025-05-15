import { useDispatch, useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect } from "react";
import { syncTimers } from "../store/timersSlice";

const ProjectorFull = () => {
  const dispatch = useDispatch();
  const { projectorInfo, prevProjectorInfo } = useSelector(
    (state) => state.presentation
  );

  const timers = useSelector((state) => state.timers.timers);
  const projectorTimer = timers.find(
    (timer) => timer.id === projectorInfo.timerInfo?.id
  );

  useEffect(() => {
    if (projectorInfo.timerInfo) {
      dispatch(syncTimers([projectorInfo.timerInfo]));
    }
  }, [projectorInfo.timerInfo, dispatch]);

  useEffect(() => {
    const keepScreenOn = async () => {
      try {
        await navigator.wakeLock.request("screen");
      } catch (err) {
        console.error("Error acquiring wake lock:", err);
      }
    };

    keepScreenOn();
  }, []);

  return (
    <DisplayWindow
      boxes={projectorInfo.slide?.boxes || []}
      prevBoxes={prevProjectorInfo.slide?.boxes || []}
      displayType={projectorInfo.displayType}
      shouldAnimate
      width={100}
      timerInfo={projectorTimer}
    />
  );
};

export default ProjectorFull;
