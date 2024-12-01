import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useEffect } from "react";

const Monitor = () => {
  const { monitorInfo, prevMonitorInfo } = useSelector(
    (state) => state.presentation
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
    <Presentation displayInfo={monitorInfo} prevDisplayInfo={prevMonitorInfo} />
  );
};

export default Monitor;
