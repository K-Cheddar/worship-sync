import { useSelector, useSyncMonitorSettings } from "../hooks";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import { useContext, useEffect, useCallback, useState } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import MonitorBoardView from "../components/DisplayWindow/MonitorBoardView";
import { REFERENCE_HEIGHT } from "../constants";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { useWakeLock } from "../hooks/useWakeLock";

const Monitor = () => {
  const monitorInfo = useSelector((state) => state.presentation.monitorInfo);
  const prevMonitorInfo = useSelector(
    (state) => state.presentation.prevMonitorInfo
  );

  const { firebaseDb, churchId, sharedDataReady } =
    useContext(GlobalInfoContext) || {};

  useSyncMonitorSettings(firebaseDb, churchId, !!sharedDataReady);

  const monitorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === monitorInfo.timerId)
  );
  const prevMonitorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevMonitorInfo.timerId)
  );

  useWakeLock();

  // Close window on ESC key press when running in Electron
  const closeWindow = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.closeWindow("monitor");
    }
  }, []);

  useCloseOnEscape(closeWindow);

  // When the controller swaps the monitor to a discussion board, show the board
  // here with the clock/timer band composited on top so a countdown stays visible.
  const monitorBoardAliasId = useSelector(
    (state) => state.presentation.monitorBoardAliasId
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : REFERENCE_HEIGHT
  );
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (monitorBoardAliasId) {
    return (
      <div className="h-dvh w-dvw bg-black">
        <MonitorBoardView
          aliasId={monitorBoardAliasId}
          scale={viewportHeight / REFERENCE_HEIGHT}
          missingAliasTitle="No discussion board selected."
          missingAliasDescription="Choose a board in moderation, then turn on Show on Monitor."
        />
      </div>
    );
  }

  return (
    <FullscreenPresentation
      displayInfo={monitorInfo}
      prevDisplayInfo={prevMonitorInfo}
      timerInfo={monitorTimer}
      prevTimerInfo={prevMonitorTimer}
    />
  );
};

export default Monitor;
