import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useEffect } from "react";

const Projector = () => {
  const { projectorInfo, prevProjectorInfo } = useSelector(
    (state) => state.presentation
  );

  const timers = useSelector((state) => state.timers.timers);
  const projectorTimer = timers.find(
    (timer) => timer.id === projectorInfo.timerId
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
      displayInfo={projectorInfo}
      prevDisplayInfo={prevProjectorInfo}
      timerInfo={projectorTimer}
    />
  );
};

export default Projector;
