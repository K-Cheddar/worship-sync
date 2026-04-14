import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Home,
  Info,
  Menu as MenuIcon,
  Monitor,
  SquarePen,
  Presentation,
  ScrollText,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import { MenuItemType } from "../../../types";
import { RedoButton, UndoButton } from "./Undo";
import ChangelogModal from "../../../components/ChangelogModal/ChangelogModal";
import AboutModal from "../../../components/AboutModal/AboutModal";
import { useState, useEffect, useContext } from "react";
import { useElectronWindows } from "../../../hooks/useElectronWindows";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { getDisplayLabel } from "../../../utils/displayUtils";
import type { WindowType } from "../../../types/electron";
import { Slider } from "../../../components/ui/Slider";

const ToolbarMenu = ({
  isPhone,
  isEditMode,
  variant = "default",
}: {
  isPhone?: boolean;
  isEditMode?: boolean;
  variant?: "default" | "overlay";
}) => {
  const { access } = useContext(GlobalInfoContext) || {};
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const zoomStep = 10;
  const zoomMin = 50;
  const zoomMax = 200;
  const navigate = useNavigate();
  const {
    isElectron,
    displays,
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

  const setZoomWithinBounds = (nextZoom: number) => {
    setZoomLevel(Math.min(zoomMax, Math.max(zoomMin, nextZoom)));
  };

  const handleReset = () => {
    setZoomLevel(100);
  };

  const handleBack = () => {
    const historyIndex =
      typeof window.history.state?.idx === "number"
        ? window.history.state.idx
        : undefined;

    if ((historyIndex ?? 0) > 0 || window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
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

      // Try to move existing window to the selected display first (does not rely on
      // possibly stale windowStates). If window is not open, moveWindowToDisplay returns false.
      const moved = await moveWindowToDisplay(windowType, displayId);
      if (moved) {
        await focusWindow(windowType);
        return;
      }
      await setDisplayPreference(windowType, displayId);
      await openWindow(windowType);
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
          <Icon svg={ArrowLeft} color="#d1d5dc" />
          Back
        </div>
      ),
      onClick: handleBack,
    },
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
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={SquarePen} color="#d1d5dc" />
          Credits Editor
        </div>
      ),
      to: "/credits-editor",
    },
    ...(variant === "overlay"
      ? []
      : access === "view"
        ? []
        : [
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
        ]),

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
        <div className="flex flex-col gap-2 w-full py-1.5 px-2 min-w-52">
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
          <div className="flex w-full items-center justify-center gap-1 px-0.5">
            <Button
              variant="tertiary"
              className="min-h-0 h-7 w-7 justify-center p-0"
              svg={ZoomOut}
              color="#ffffff"
              title="Zoom out"
              aria-label="Zoom out interface"
              disabled={zoomLevel <= zoomMin}
              onClick={() => setZoomWithinBounds(zoomLevel - zoomStep)}
            />
            <div className="w-36 shrink-0">
              <Slider
                value={[zoomLevel]}
                onValueChange={(v: number[]) =>
                  setZoomWithinBounds(v[0] ?? 100)
                }
                min={zoomMin}
                max={zoomMax}
                step={zoomStep}
                className="w-full"
                aria-label="Interface zoom"
              />
            </div>
            <Button
              variant="tertiary"
              className="min-h-0 h-7 w-7 justify-center p-0"
              svg={ZoomIn}
              color="#ffffff"
              title="Zoom in"
              aria-label="Zoom in interface"
              disabled={zoomLevel >= zoomMax}
              onClick={() => setZoomWithinBounds(zoomLevel + zoomStep)}
            />
          </div>
        </div>
      ),
      className:
        "p-0 hover:bg-transparent focus:bg-transparent hover:text-inherit focus:text-inherit",
      preventClose: true,
    },
    ...(isPhone && !isEditMode && access !== "view"
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
    //   text: isLoggedIn ? "Sign out" : "Sign in",
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
