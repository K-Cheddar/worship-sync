import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useEffect } from "react";

const Monitor = () => {
  const { monitorInfo, prevMonitorInfo } = useSelector(
    (state) => state.presentation
  );

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
