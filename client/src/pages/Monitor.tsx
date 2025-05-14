import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useEffect } from "react";

const Monitor = () => {
  const { monitorInfo, prevMonitorInfo } = useSelector(
    (state) => state.presentation
  );

  const timers = useSelector((state) => state.timers.timers);
  const monitorTimer = timers.find(
    (timer) => timer.id === monitorInfo.timerInfo?.id
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
    />
  );
};

export default Monitor;
