import { useDispatch, useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useEffect } from "react";
import { syncTimers } from "../store/timersSlice";

const Projector = () => {
  const dispatch = useDispatch();
  const { projectorInfo, prevProjectorInfo } = useSelector(
    (state) => state.presentation
  );

  const timers = useSelector((state) => state.timers.timers);
  const projectorTimer = timers.find(
    (timer) => timer.id === projectorInfo.timerInfo?.id
  );

  useEffect(() => {
    if (projectorInfo.timerInfo) {
      dispatch(syncTimers([projectorInfo.timerInfo]));
    }
  }, [projectorInfo.timerInfo, dispatch]);

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
