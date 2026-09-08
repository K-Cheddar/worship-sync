import { useSelector } from "../hooks";
import { useOutputForSurface } from "../hooks/useOutputForSurface";
import { selectResolvedOutputSlot } from "../store/presentationSlice";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import ProjectorFull from "./ProjectorFull";
import { useWakeLock } from "../hooks/useWakeLock";
import { useHideProjectorCursor } from "../hooks/useHideProjectorCursor";
import { useResolvedDisplaySettings } from "../hooks/useResolvedDisplaySettings";

import DisplayBoardTakeover from "../components/DisplayWindow/DisplayBoardTakeover";

/**
 * Windowed projector output: draggable, with a button to go fullscreen.
 *
 * A screen marked headless renders the bare full-frame output instead. That flag
 * is a per-screen setting rather than a separate surface type, so one machine in
 * the booth can keep its fullscreen button while the ceiling projector showing
 * the same display has no chrome at all.
 */
const Projector = () => {
  const output = useOutputForSurface("projector");
  const { isHeadless } = useResolvedDisplaySettings(output.id);
  const boardAliasId = useSelector(
    (state) => selectResolvedOutputSlot(state, output.id, "projector").boardAliasId,
  );
  const projectorInfo = useSelector(
    (state) => selectResolvedOutputSlot(state, output.id, "projector").info,
  );
  const prevProjectorInfo = useSelector(
    (state) => selectResolvedOutputSlot(state, output.id, "projector").prevInfo,
  );
  const projectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === projectorInfo.timerId),
  );
  const prevProjectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevProjectorInfo.timerId),
  );

  useWakeLock();
  // Board takeover is output-only on an already-linked projector. Headless and
  // /projector-full hide the cursor from ProjectorFull; chromeed windowed mode
  // keeps it so the operator can still use the fullscreen control.
  useHideProjectorCursor(Boolean(boardAliasId));

  // A board sent to this projector replaces its presentation content, the same
  // swap the monitor does.
  if (boardAliasId) {
    return <DisplayBoardTakeover aliasId={boardAliasId} outputId={output.id} />;
  }

  if (isHeadless) return <ProjectorFull />;

  return (
    <FullscreenPresentation
      outputId={output.id}
      displayInfo={projectorInfo}
      prevDisplayInfo={prevProjectorInfo}
      timerInfo={projectorTimer}
      prevTimerInfo={prevProjectorTimer}
    />
  );
};

export default Projector;
