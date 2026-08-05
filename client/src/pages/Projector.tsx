import { useSelector } from "../hooks";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import { useWakeLock } from "../hooks/useWakeLock";

const Projector = () => {
  const projectorInfo = useSelector((state) => state.presentation.projectorInfo);
  const prevProjectorInfo = useSelector(
    (state) => state.presentation.prevProjectorInfo,
  );
  const projectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === projectorInfo.timerId),
  );
  const prevProjectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevProjectorInfo.timerId),
  );

  useWakeLock();

  return (
    <FullscreenPresentation
      displayInfo={projectorInfo}
      prevDisplayInfo={prevProjectorInfo}
      timerInfo={projectorTimer}
      prevTimerInfo={prevProjectorTimer}
    />
  );
};

export default Projector;
