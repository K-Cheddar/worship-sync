import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect, useCallback } from "react";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";

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

  // Close window on ESC key press when running in Electron
  const closeWindow = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.closeProjectorWindow();
    }
  }, []);

  useCloseOnEscape(closeWindow);

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
