import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect } from "react";

const ProjectorFull = () => {
  const { projectorInfo, prevProjectorInfo } = useSelector(
    (state) => state.presentation
  );

  const timers = useSelector((state) => state.timers.timers);
  const projectorTimer = timers.find(
    (timer) => timer.id === projectorInfo.timerId
  );
  const prevProjectorTimer = timers.find(
    (timer) => timer.id === prevProjectorInfo.timerId
  );

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
      shouldPlayVideo
      width={100}
      timerInfo={projectorTimer}
      prevTimerInfo={prevProjectorTimer}
    />
  );
};

export default ProjectorFull;
