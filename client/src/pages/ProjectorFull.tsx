import { useSelector } from "../hooks";
import {
  useOutputForSurface,
  useWindowKeyForSurface,
} from "../hooks/useOutputForSurface";
import { selectOutputSlot } from "../store/presentationSlice";
import FullscreenPresentation from "../containers/FullscreenPresentation";
import DisplayBoardTakeover from "../components/DisplayWindow/DisplayBoardTakeover";
import { useCallback } from "react";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { useWakeLock } from "../hooks/useWakeLock";

const ProjectorFull = () => {
  const output = useOutputForSurface("projector");
  const windowKey = useWindowKeyForSurface("projector");
  const projectorInfo = useSelector(
    (state) => selectOutputSlot(state, output.id, "projector").info,
  );
  const prevProjectorInfo = useSelector(
    (state) => selectOutputSlot(state, output.id, "projector").prevInfo,
  );
  const boardAliasId = useSelector(
    (state) => selectOutputSlot(state, output.id, "projector").boardAliasId,
  );
  const projectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === projectorInfo.timerId),
  );
  const prevProjectorTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevProjectorInfo.timerId),
  );

  useWakeLock();

  // Close window on ESC key press when running in Electron
  const closeWindow = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.closeWindow(windowKey);
    }
  }, [windowKey]);

  useCloseOnEscape(closeWindow);

  // This is the route Electron opens, so the board swap has to happen here too
  // — not only on the windowed /projector.
  if (boardAliasId) {
    return <DisplayBoardTakeover aliasId={boardAliasId} outputId={output.id} />;
  }

  // Delegates rather than re-implementing the surface. This route is what
  // Electron opens, and every time it carried its own copy of the render it
  // quietly missed a feature the windowed /projector had — the board takeover,
  // then the clock and timer.
  return (
    <FullscreenPresentation
      outputId={output.id}
      isHeadless
      displayInfo={projectorInfo}
      prevDisplayInfo={prevProjectorInfo}
      timerInfo={projectorTimer}
      prevTimerInfo={prevProjectorTimer}
    />
  );
};

export default ProjectorFull;
