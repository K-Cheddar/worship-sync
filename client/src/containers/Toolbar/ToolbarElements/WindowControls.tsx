import { useCallback, useEffect, useMemo } from "react";
import { Monitor, Presentation, Radio } from "lucide-react";
import cn from "classnames";
import { useElectronWindows } from "../../../hooks/useElectronWindows";
import WindowControl from "../../../components/WindowControl/WindowControl";
import { useSelector } from "../../../hooks";
import { selectDisplayOutputs } from "../../../store/displayOutputsSlice";
import {
  DisplayOutputType,
  isPushOutputType,
  PushOutputType,
} from "../../../utils/displayOutputs";

interface WindowControlsProps {
  className?: string;
}

const ICON_BY_TYPE = {
  projector: Presentation,
  monitor: Monitor,
  stream: Radio,
} as const;

/**
 * One window control per display output, so a church running three projectors
 * can open, place, and close each window from the desktop app.
 *
 * Windows are keyed by output id; the main process derives the route from that
 * key plus the render profile, so the renderer never supplies a URL.
 */
const WindowControls = ({ className }: WindowControlsProps) => {
  const {
    isElectron,
    refreshDisplays,
    refreshWindowStates,
    openWindow,
    closeWindow,
    focusWindow,
  } = useElectronWindows();

  const displayOutputs = useSelector(selectDisplayOutputs);
  const windowOutputs = useMemo(
    () =>
      displayOutputs.filter(
        (output) => output.enabled && isPushOutputType(output.type),
      ),
    [displayOutputs],
  );

  // Ask the main process about exactly the windows we render controls for, so a
  // display added on another device still reports state here.
  const windowKeys = useMemo(
    () => windowOutputs.map((output) => output.id),
    [windowOutputs],
  );
  const refreshStates = useCallback(
    () => refreshWindowStates(windowKeys),
    [refreshWindowStates, windowKeys],
  );

  useEffect(() => {
    if (isElectron) {
      refreshDisplays();
      void refreshStates();
    }
  }, [isElectron, refreshDisplays, refreshStates]);

  if (!isElectron) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {windowOutputs.map((output) => (
        <WindowControl
          key={output.id}
          windowType={output.id}
          title={`${output.name} Window`}
          icon={ICON_BY_TYPE[output.type as PushOutputType]}
          onOpen={async () => {
            await openWindow(output.id, output.type as DisplayOutputType);
          }}
          onClose={async () => {
            await closeWindow(output.id);
          }}
          onFocus={async () => {
            await focusWindow(output.id);
          }}
        />
      ))}
    </div>
  );
};

export default WindowControls;
