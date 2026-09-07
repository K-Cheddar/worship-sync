import { useSelector } from "../hooks";
import { selectOutputSlot } from "../store/presentationSlice";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import { useWakeLock } from "../hooks/useWakeLock";

const Projector = () => {
  const projectorInfo = useSelector(
    (state) => selectOutputSlot(state, "projector", "projector").info,
  );
  const prevProjectorInfo = useSelector(
    (state) => selectOutputSlot(state, "projector", "projector").prevInfo,
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
