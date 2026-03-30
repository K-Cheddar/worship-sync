import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect, useCallback } from "react";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";

const ProjectorFull = () => {
  const projectorInfo = useSelector((state) => state.presentation.projectorInfo);
  const prevProjectorInfo = useSelector(
    (state) => state.presentation.prevProjectorInfo
  );
  const projectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === projectorInfo.timerId)
  );
  const prevProjectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevProjectorInfo.timerId)
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
      await window.electronAPI.closeWindow("projector");
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
