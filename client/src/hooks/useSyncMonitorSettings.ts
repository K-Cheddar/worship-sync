import { useCallback } from "react";
import { type Database } from "firebase/database";
import { useDispatch } from "./reduxHooks";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";
import {
  setMonitorClockFontSize,
  setMonitorShowClock,
  setMonitorShowNextSlide,
  setMonitorShowTimer,
  setMonitorTimerFontSize,
  setMonitorTimerId,
} from "../store/preferencesSlice";
import { getChurchDataPath } from "../utils/firebasePaths";

/**
 * Sync church monitorSettings from Firebase into Redux so monitor previews
 * (clock/timer band) know which timer to show. Used by /monitor and by
 * controller-like pages that render TransmitHandler without loading local prefs.
 */
export const useSyncMonitorSettings = (
  firebaseDb: Database | null | undefined,
  churchId: string | null | undefined,
  sharedDataReady: boolean,
) => {
  const dispatch = useDispatch();

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
      dispatch(setMonitorShowClock(settings.showClock));
      dispatch(setMonitorShowTimer(settings.showTimer));
      if (settings.showNextSlide !== undefined) {
        dispatch(setMonitorShowNextSlide(settings.showNextSlide));
      }
      dispatch(setMonitorClockFontSize(settings.clockFontSize));
      dispatch(setMonitorTimerFontSize(settings.timerFontSize));
      dispatch(setMonitorTimerId(settings.timerId || null));
    },
    [dispatch],
  );

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path: churchId ? getChurchDataPath(churchId, "monitorSettings") : null,
    enabled: !!firebaseDb && !!churchId && !!sharedDataReady,
    onData: handleMonitorSettings,
    label: "monitor settings",
  });
};
