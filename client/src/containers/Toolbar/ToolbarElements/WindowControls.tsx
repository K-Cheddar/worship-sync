import { useElectronWindows } from "../../../hooks/useElectronWindows";
import Button from "../../../components/Button/Button";
import RadioButton from "../../../components/RadioButton/RadioButton";
import { useState, useEffect } from "react";
import { Monitor, Presentation, Focus } from "lucide-react";
import cn from "classnames";
import type { Display } from "../../../types/electron";

interface WindowControlsProps {
  className?: string;
}

const WindowControls = ({ className }: WindowControlsProps) => {
  const {
    isElectron,
    displays,
    windowStates,
    refreshDisplays,
    refreshWindowStates,
    openProjectorWindow,
    openMonitorWindow,
    closeProjectorWindow,
    closeMonitorWindow,
    moveProjectorToDisplay,
    moveMonitorToDisplay,
    focusProjectorWindow,
    focusMonitorWindow,
  } = useElectronWindows();

  const [selectedProjectorDisplay, setSelectedProjectorDisplay] = useState<string>("");
  const [selectedMonitorDisplay, setSelectedMonitorDisplay] = useState<string>("");

  useEffect(() => {
    if (windowStates && displays.length > 0) {
      if (windowStates.projector.displayId) {
        setSelectedProjectorDisplay(windowStates.projector.displayId.toString());
      }
      if (windowStates.monitor.displayId) {
        setSelectedMonitorDisplay(windowStates.monitor.displayId.toString());
      }
    }
  }, [windowStates, displays]);

  useEffect(() => {
    if (isElectron) {
      refreshDisplays();
      refreshWindowStates();
    }
  }, [isElectron, refreshDisplays, refreshWindowStates]);

  if (!isElectron) {
    return null;
  }

  const handleProjectorDisplayChange = async (displayId: string) => {
    setSelectedProjectorDisplay(displayId);
    await moveProjectorToDisplay(parseInt(displayId));
    await refreshWindowStates();
  };

  const handleMonitorDisplayChange = async (displayId: string) => {
    setSelectedMonitorDisplay(displayId);
    await moveMonitorToDisplay(parseInt(displayId));
    await refreshWindowStates();
  };

  const getDisplayName = (display: Display, index: number) => {
    const resolution = `${display.bounds.width}×${display.bounds.height}`;
    const type = display.internal ? "Built-in" : "External";
    const displayNumber = index + 1;
    
    if (display.label) {
      return `${display.label} (${resolution})`;
    }
    
    return `Display ${displayNumber} - ${type} (${resolution})`;
  };

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {/* Projector Controls */}
      <div className="flex flex-col gap-3 bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Presentation className="size-5 text-white" />
          <h3 className="text-lg font-semibold text-white">Projector Window</h3>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-300">Status:</span>
          <span
            className={cn(
              "text-sm font-medium",
              windowStates?.projectorOpen ? "text-green-400" : "text-red-400"
            )}
          >
            {windowStates?.projectorOpen ? "Open" : "Closed"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Display:</label>
          <div className="flex flex-col gap-2 ml-2">
            {displays.map((display, index) => (
              <RadioButton
                key={display.id}
                label={getDisplayName(display, index)}
                value={selectedProjectorDisplay === display.id.toString()}
                onChange={() => handleProjectorDisplayChange(display.id.toString())}
                disabled={!windowStates?.projectorOpen}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          {windowStates?.projectorOpen ? (
            <>
              <Button
                variant="secondary"
                onClick={async () => {
                  await closeProjectorWindow();
                  await refreshWindowStates();
                }}
                className="w-full"
              >
                Close
              </Button>
              <Button
                variant="tertiary"
                svg={Focus}
                onClick={focusProjectorWindow}
                className="w-full"
              >
                Bring to Front
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={async () => {
                await openProjectorWindow();
                await refreshWindowStates();
              }}
              className="w-full"
            >
              Open
            </Button>
          )}
        </div>
      </div>

      {/* Monitor Controls */}
      <div className="flex flex-col gap-3 bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Monitor className="size-5 text-white" />
          <h3 className="text-lg font-semibold text-white">Stage Monitor Window</h3>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-300">Status:</span>
          <span
            className={cn(
              "text-sm font-medium",
              windowStates?.monitorOpen ? "text-green-400" : "text-red-400"
            )}
          >
            {windowStates?.monitorOpen ? "Open" : "Closed"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Display:</label>
          <div className="flex flex-col gap-2 ml-2">
            {displays.map((display, index) => (
              <RadioButton
                key={display.id}
                label={getDisplayName(display, index)}
                value={selectedMonitorDisplay === display.id.toString()}
                onChange={() => handleMonitorDisplayChange(display.id.toString())}
                disabled={!windowStates?.monitorOpen}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          {windowStates?.monitorOpen ? (
            <>
              <Button
                variant="secondary"
                onClick={async () => {
                  await closeMonitorWindow();
                  await refreshWindowStates();
                }}
                className="w-full"
              >
                Close
              </Button>
              <Button
                variant="tertiary"
                svg={Focus}
                onClick={focusMonitorWindow}
                className="w-full"
              >
                Bring to Front
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={async () => {
                await openMonitorWindow();
                await refreshWindowStates();
              }}
              className="w-full"
            >
              Open
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WindowControls;
