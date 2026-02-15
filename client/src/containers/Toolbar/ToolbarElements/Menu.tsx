import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import {
  Home,
  Info,
  Menu as MenuIcon,
  Monitor,
  Presentation,
  ScrollText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import { MenuItemType } from "../../../types";
import { RedoButton, UndoButton } from "./Undo";
import ChangelogModal from "../../../components/ChangelogModal/ChangelogModal";
import AboutModal from "../../../components/AboutModal/AboutModal";
import { useState, useEffect } from "react";
import { useElectronWindows } from "../../../hooks/useElectronWindows";
import { getDisplayLabel } from "../../../utils/displayUtils";
import type { WindowType } from "../../../types/electron";

const ToolbarMenu = ({
  isPhone,
  isEditMode,
}: {
  isPhone?: boolean;
  isEditMode?: boolean;
}) => {
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const {
    isElectron,
    displays,
    windowStates,
    openWindow,
    focusWindow,
    moveWindowToDisplay,
    setDisplayPreference,
  } = useElectronWindows();

  useEffect(() => {
    // Base font size from index.css (92.5%)
    const baseFontSize = 100;
    const scale = zoomLevel / 100;
    const newFontSize = baseFontSize * scale;

    // Apply zoom by adjusting the root font size
    // This scales all rem-based units (which Tailwind uses)
    document.documentElement.style.fontSize = `${newFontSize}%`;

    // Cleanup function to reset font size when component unmounts
    return () => {
      document.documentElement.style.fontSize = `${baseFontSize}%`;
    };
  }, [zoomLevel]);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 10, 200)); // Max 200%
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 10, 50)); // Min 50%
  };

  const handleReset = () => {
    setZoomLevel(100);
  };

  const openWindowOnLastUsedDisplay = async (windowType: WindowType) => {
    try {
      if (isElectron) {
        await openWindow(windowType);
      } else {
        const webRoute = windowType === "monitor" ? "#/monitor" : "#/projector";
        const webTarget = windowType === "monitor" ? "_monitor" : "_projector";
        window.open(webRoute, webTarget, "width=500,height=360");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openWindowOnDisplay = async (windowType: WindowType, displayId: number) => {
    try {
      if (!isElectron) {
        await openWindowOnLastUsedDisplay(windowType);
        return;
      }

      const isWindowOpen =
        windowType === "projector"
          ? windowStates?.projectorOpen
          : windowStates?.monitorOpen;

      if (isWindowOpen) {
        // Match WindowControl behavior: move open window directly to selected display.
        await moveWindowToDisplay(windowType, displayId);
        // Ensure moved window is brought to front.
        await focusWindow(windowType);
      } else {
        // Persist display selection, then open the window on that display.
        await setDisplayPreference(windowType, displayId);
        await openWindow(windowType);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const buildDisplaySubItems = (windowType: WindowType) => [
    {
      text: "Last Used Display",
      onClick: () => openWindowOnLastUsedDisplay(windowType),
    },
    ...displays.map((display, index) => ({
      text: getDisplayLabel(display, index),
      onClick: () => openWindowOnDisplay(windowType, display.id),
    })),
  ];

  const menuItems: MenuItemType[] = [
    {
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={Home} color="#d1d5dc" />
          Home
        </div>
      ),
      to: "/",
    },
    {
      text: "Open Stage Monitor",
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={Monitor} color="#d1d5dc" />
          Open Stage Monitor
        </div>
      ),
      ...(isElectron && displays.length > 0
        ? {
          subItems: buildDisplaySubItems("monitor"),
        }
        : {
          onClick: async () => {
            await openWindowOnLastUsedDisplay("monitor");
          },
        }),
    },
    {
      text: "Open Projector",
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={Presentation} color="#d1d5dc" />
          Open Projector
        </div>
      ),
      ...(isElectron && displays.length > 0
        ? {
          subItems: buildDisplaySubItems("projector"),
        }
        : {
          onClick: async () => {
            await openWindowOnLastUsedDisplay("projector");
          },
        }),
    },

    {
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={ScrollText} color="#d1d5dc" />
          Changelog
        </div>
      ),
      onClick: () => setIsChangelogOpen(true),
    },
    {
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={Info} color="#d1d5dc" />
          About
        </div>
      ),
      onClick: () => setIsAboutOpen(true),
    },
    {
      element: (
        <div className="flex flex-col gap-2 w-full py-1.5 px-2">
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs font-semibold min-w-12 text-center">
              {zoomLevel}%
            </span>
            <Button
              svg={RotateCcw}
              onClick={handleReset}
              className="justify-center"
              disabled={zoomLevel === 100}
              variant="secondary"
            ></Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <Button
              svg={ZoomOut}
              onClick={handleZoomOut}
              className="flex-1 justify-center"
              disabled={zoomLevel <= 50}
              variant="secondary"
            ></Button>
            <Button
              svg={ZoomIn}
              onClick={handleZoomIn}
              className="flex-1 justify-center"
              disabled={zoomLevel >= 200}
              variant="secondary"
            ></Button>
          </div>
        </div>
      ),
      preventClose: true,
    },
    ...(isPhone && !isEditMode
      ? [
        {
          element: (
            <div className="flex gap-2 w-full py-1.5 px-2">
              <UndoButton
                variant="secondary"
                color="black"
                className="w-full justify-center"
              />
              <RedoButton
                variant="secondary"
                color="black"
                className="w-full justify-center"
              />
            </div>
          ),
          preventClose: true,
        },
      ]
      : []),
    // {
    //   text: isLoggedIn ? "Logout" : "Login",
    //   onClick: async () => {
    //     if (isLoggedIn && logout) {
    //       logout();
    //     } else {
    //       navigate("/login");
    //     }
    //   },
    // },
  ];

  return (
    <>
      <Menu
        menuItems={menuItems}
        align="start"
        TriggeringButton={
          <Button
            variant="tertiary"
            className="w-fit p-1"
            padding="p-1"
            aria-label="Open menu"
            svg={MenuIcon}
          />
        }
      />
      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
      />
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />
    </>
  );
};

export default ToolbarMenu;
