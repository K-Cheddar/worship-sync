import { useSelector, useDispatch } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useContext, useEffect, useCallback } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import { onValue, ref } from "firebase/database";
import {
  setMonitorClockFontSize,
  setMonitorShowTimer,
  setMonitorShowClock,
  setMonitorTimerId,
} from "../store/preferencesSlice";
import { setMonitorTimerFontSize } from "../store/preferencesSlice";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { capitalizeFirstLetter } from "../utils/generalUtils";

const Monitor = () => {
  const { monitorInfo, prevMonitorInfo } = useSelector(
    (state) => state.presentation
  );

  const dispatch = useDispatch();

  const { firebaseDb, database } = useContext(GlobalInfoContext) || {};

  useEffect(() => {
    const getMonitorSettingsFromFirebase = async () => {
      if (!firebaseDb) return;

      const monitorSettingsRef = ref(
        firebaseDb,
        "users/" + capitalizeFirstLetter(database) + "/v2/monitorSettings"
      );
      onValue(monitorSettingsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Support both old (defaultMonitor*) and new (monitorSettings) formats
          dispatch(setMonitorShowClock(data.showClock));
          dispatch(setMonitorShowTimer(data.showTimer));
          dispatch(setMonitorClockFontSize(data.clockFontSize));
          dispatch(setMonitorTimerFontSize(data.timerFontSize));
          dispatch(setMonitorTimerId(data.timerId || null));
        }
      });
    };
    getMonitorSettingsFromFirebase();
  }, [firebaseDb, database, dispatch]);

  const timers = useSelector((state) => state.timers.timers);
  const monitorTimer = timers.find((timer) => timer.id === monitorInfo.timerId);
  const prevMonitorTimer = timers.find(
    (timer) => timer.id === prevMonitorInfo.timerId
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
      await window.electronAPI.closeMonitorWindow();
    }
  }, []);

  useCloseOnEscape(closeWindow);

  return (
    <Presentation
      displayInfo={monitorInfo}
      prevDisplayInfo={prevMonitorInfo}
      timerInfo={monitorTimer}
      prevTimerInfo={prevMonitorTimer}
    />
  );
};

export default Monitor;
