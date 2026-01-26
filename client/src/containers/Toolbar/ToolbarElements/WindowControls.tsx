import { useElectronWindows } from "../../../hooks/useElectronWindows";
import WindowControl from "../../../components/WindowControl/WindowControl";
import { useEffect } from "react";
import { Monitor, Presentation } from "lucide-react";
import cn from "classnames";

interface WindowControlsProps {
  className?: string;
}

const WindowControls = ({ className }: WindowControlsProps) => {
  const {
    isElectron,
    refreshDisplays,
    refreshWindowStates,
    openWindow,
    closeWindow,
    focusWindow,
  } = useElectronWindows();

  useEffect(() => {
    if (isElectron) {
      refreshDisplays();
      refreshWindowStates();
    }
  }, [isElectron, refreshDisplays, refreshWindowStates]);

  if (!isElectron) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <WindowControl
        windowType="projector"
        title="Projector Window"
        icon={Presentation}
        onOpen={async () => {
          await openWindow("projector");
        }}
        onClose={async () => {
          await closeWindow("projector");
        }}
        onFocus={async () => {
          await focusWindow("projector");
        }}
      />
      <WindowControl
        windowType="monitor"
        title="Stage Monitor Window"
        icon={Monitor}
        onOpen={async () => {
          await openWindow("monitor");
        }}
        onClose={async () => {
          await closeWindow("monitor");
        }}
        onFocus={async () => {
          await focusWindow("monitor");
        }}
      />
    </div>
  );
};

export default WindowControls;
