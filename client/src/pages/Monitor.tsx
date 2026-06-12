import { useSelector, useDispatch, useFirebaseValueWithRetry } from "../hooks";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import { useContext, useEffect, useCallback } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  setMonitorClockFontSize,
  setMonitorShowTimer,
  setMonitorShowClock,
  setMonitorShowNextSlide,
  setMonitorTimerId,
  setMonitorTimerFontSize,
} from "../store/preferencesSlice";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { getChurchDataPath } from "../utils/firebasePaths";

const Monitor = () => {
  const monitorInfo = useSelector((state) => state.presentation.monitorInfo);
  const prevMonitorInfo = useSelector(
    (state) => state.presentation.prevMonitorInfo
  );

  const dispatch = useDispatch();

  const { firebaseDb, churchId, sharedDataReady } =
    useContext(GlobalInfoContext) || {};

  const handleMonitorSettings = useCallback(
    (data: unknown) => {
      if (!data) return;
      const settings = data as {
        showClock: boolean;
        showTimer: boolean;
        showNextSlide?: boolean;
        clockFontSize: number;
        timerFontSize: number;
        timerId?: string | null;
      };
      // Support both old (defaultMonitor*) and new (monitorSettings) formats
      dispatch(setMonitorShowClock(settings.showClock));
      dispatch(setMonitorShowTimer(settings.showTimer));
      if (settings.showNextSlide !== undefined) {
        dispatch(setMonitorShowNextSlide(settings.showNextSlide));
      }
      dispatch(setMonitorClockFontSize(settings.clockFontSize));
      dispatch(setMonitorTimerFontSize(settings.timerFontSize));
      dispatch(setMonitorTimerId(settings.timerId || null));
    },
    [dispatch]
  );

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path: churchId ? getChurchDataPath(churchId, "monitorSettings") : null,
    enabled: !!firebaseDb && !!churchId && !!sharedDataReady,
    onData: handleMonitorSettings,
    label: "monitor settings",
  });

  const monitorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === monitorInfo.timerId)
  );
  const prevMonitorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevMonitorInfo.timerId)
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
      await window.electronAPI.closeWindow("monitor");
    }
  }, []);

  useCloseOnEscape(closeWindow);

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
