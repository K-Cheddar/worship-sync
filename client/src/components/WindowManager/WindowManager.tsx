import { useElectronWindows } from "../../hooks/useElectronWindows";
import Button from "../Button/Button";
import RadioButton from "../RadioButton/RadioButton";
import { useState, useEffect } from "react";
import { Focus } from "lucide-react";
import type { Display } from "../../types/electron";

const WindowManager = () => {
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

  if (!isElectron) {
    return null;
  }

  const handleProjectorDisplayChange = async (displayId: string) => {
    setSelectedProjectorDisplay(displayId);
    await moveProjectorToDisplay(parseInt(displayId));
  };

  const handleMonitorDisplayChange = async (displayId: string) => {
    setSelectedMonitorDisplay(displayId);
    await moveMonitorToDisplay(parseInt(displayId));
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
    <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-lg space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Window Management
        </h3>
        <Button
          variant="secondary"
          onClick={() => {
            refreshDisplays();
            refreshWindowStates();
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Projector Window Controls */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg space-y-3">
          <h4 className="font-medium text-slate-900 dark:text-slate-100">
            Projector Window
          </h4>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Status:
            </span>
            <span
              className={`text-sm font-medium ${
                windowStates?.projectorOpen
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {windowStates?.projectorOpen ? "Open" : "Closed"}
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Display:
            </label>
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

          <div className="flex flex-col gap-2">
            {windowStates?.projectorOpen ? (
              <>
                <Button
                  variant="secondary"
                  onClick={closeProjectorWindow}
                  className="w-full"
                >
                  Close
                </Button>
                <Button
                  variant="secondary"
                  svg={Focus}
                  onClick={focusProjectorWindow}
                  className="w-full"
                >
                  Bring to Front
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={openProjectorWindow} className="w-full">
                Open
              </Button>
            )}
          </div>
        </div>

        {/* Monitor Window Controls */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg space-y-3">
          <h4 className="font-medium text-slate-900 dark:text-slate-100">
            Stage Monitor Window
          </h4>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Status:
            </span>
            <span
              className={`text-sm font-medium ${
                windowStates?.monitorOpen
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {windowStates?.monitorOpen ? "Open" : "Closed"}
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Display:
            </label>
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

          <div className="flex flex-col gap-2">
            {windowStates?.monitorOpen ? (
              <>
                <Button
                  variant="secondary"
                  onClick={closeMonitorWindow}
                  className="w-full"
                >
                  Close
                </Button>
                <Button
                  variant="secondary"
                  svg={Focus}
                  onClick={focusMonitorWindow}
                  className="w-full"
                >
                  Bring to Front
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={openMonitorWindow} className="w-full">
                Open
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 dark:text-slate-400">
        Windows will automatically open when the app starts and remember their
        position and display assignment.
      </div>
    </div>
  );
};

export default WindowManager;
