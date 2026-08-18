import { useSelector, useSyncMonitorSettings } from "../hooks";
import {
  useOutputForSurface,
  useWindowKeyForSurface,
} from "../hooks/useOutputForSurface";
import { selectResolvedOutputSlot } from "../store/presentationSlice";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import { useContext, useCallback } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import DisplayBoardTakeover from "../components/DisplayWindow/DisplayBoardTakeover";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { useWakeLock } from "../hooks/useWakeLock";
import { useResolvedDisplaySettings } from "../hooks/useResolvedDisplaySettings";

const Monitor = () => {
  const output = useOutputForSurface("monitor");
  const windowKey = useWindowKeyForSurface("monitor");
  // A monitor bolted above the stage has nobody to click "go fullscreen", so a
  // screen marked headless renders bare output instead of the gate.
  const { isHeadless } = useResolvedDisplaySettings(output.id);
  const monitorInfo = useSelector(
    (state) => selectResolvedOutputSlot(state, output.id, "monitor").info,
  );
  const prevMonitorInfo = useSelector(
    (state) => selectResolvedOutputSlot(state, output.id, "monitor").prevInfo,
  );

  const { firebaseDb, churchId, sharedDataReady } =
    useContext(GlobalInfoContext) || {};

  useSyncMonitorSettings(firebaseDb, churchId, !!sharedDataReady);

  const monitorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === monitorInfo.timerId),
  );
  const prevMonitorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevMonitorInfo.timerId),
  );

  useWakeLock();

  // Close window on ESC key press when running in Electron
  const closeWindow = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.closeWindow(windowKey);
    }
  }, [windowKey]);

  useCloseOnEscape(closeWindow);

  // When the controller swaps the monitor to a discussion board, show the board
  // here with the clock/timer band composited on top so a countdown stays visible.
  const monitorBoardAliasId = useSelector(
    (state) => selectResolvedOutputSlot(state, output.id, "monitor").boardAliasId,
  );

  if (monitorBoardAliasId) {
    return (
      <DisplayBoardTakeover
        aliasId={monitorBoardAliasId}
        outputId={output.id}
      />
    );
  }

  return (
    <FullscreenPresentation
      outputId={output.id}
      isHeadless={isHeadless}
      displayInfo={monitorInfo}
      prevDisplayInfo={prevMonitorInfo}
      timerInfo={monitorTimer}
      prevTimerInfo={prevMonitorTimer}
    />
  );
};

export default Monitor;
