import { useElectronWindows } from "../../hooks/useElectronWindows";
import Button from "../Button/Button";
import RadioButton from "../RadioButton/RadioButton";
import { useState, useEffect } from "react";
import { Focus, LucideIcon } from "lucide-react";
import cn from "classnames";
import type { Display, WindowType } from "../../types/electron";

interface WindowControlProps {
  windowType: WindowType;
  title: string;
  icon: LucideIcon;
  onOpen: () => Promise<boolean | void>;
  onClose: () => Promise<boolean | void>;
  onFocus: () => Promise<boolean | void>;
  className?: string;
}

const WindowControl = ({
  windowType,
  title,
  icon: Icon,
  onOpen,
  onClose,
  onFocus,
  className,
}: WindowControlProps) => {
  const {
    displays,
    windowStates,
    refreshWindowStates,
    moveWindowToDisplay,
    setDisplayPreference,
  } = useElectronWindows();

  const [selectedDisplay, setSelectedDisplay] = useState<string>("");

  const isOpen = windowType === "projector" 
    ? windowStates?.projectorOpen 
    : windowStates?.monitorOpen;

  const windowState = windowType === "projector"
    ? windowStates?.projector
    : windowStates?.monitor;

  useEffect(() => {
    if (windowState && displays.length > 0 && windowState.displayId) {
      setSelectedDisplay(windowState.displayId.toString());
    }
  }, [windowState, displays]);

  const handleDisplayChange = async (displayId: string) => {
    setSelectedDisplay(displayId);
    const displayIdNum = parseInt(displayId);
    
    if (isOpen) {
      // Window is open, move it to the selected display
      await moveWindowToDisplay(windowType, displayIdNum);
    } else {
      // Window is closed, save the preference for when it opens
      await setDisplayPreference(windowType, displayIdNum);
    }
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
    <div className={cn("flex flex-col gap-3 bg-gray-800 rounded-lg p-4", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-5 text-white" />
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300">Status:</span>
        <span
          className={cn(
            "text-sm font-medium",
            isOpen ? "text-green-400" : "text-red-400"
          )}
        >
          {isOpen ? "Open" : "Closed"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-300">Display:</label>
        <div className="flex flex-col gap-2 ml-2">
          {displays.map((display, index) => (
            <RadioButton
              key={display.id}
              label={getDisplayName(display, index)}
              value={selectedDisplay === display.id.toString()}
              onChange={() => handleDisplayChange(display.id.toString())}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        {isOpen ? (
          <>
            <Button
              variant="secondary"
              onClick={async () => {
                await onClose();
                await refreshWindowStates();
              }}
              className="w-full"
            >
              Close
            </Button>
            <Button
              variant="tertiary"
              svg={Focus}
              onClick={onFocus}
              className="w-full"
            >
              Bring to Front
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={async () => {
              await onOpen();
              await refreshWindowStates();
            }}
            className="w-full"
          >
            Open
          </Button>
        )}
      </div>
    </div>
  );
};

export default WindowControl;
