import { CircleAlert, Home, Menu as MenuIcon, Presentation } from "lucide-react";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import Menu from "../components/Menu/Menu";
import { useAboutChangelogMenu } from "../hooks/useAboutChangelogMenu";
import { useElectronWindows } from "../hooks/useElectronWindows";
import { buildBoardDisplayRoute, buildBoardDisplayUrl } from "./boardUtils";
import { getDisplayLabel } from "../utils/displayUtils";
import { isElectronDisplayWindowOpen } from "../utils/isElectronDisplayWindowOpen";
import type { MenuItemType } from "../types";
import type { WindowType } from "../types/electron";

export type BoardControllerMenuProps = {
  canOpenBoard: boolean;
  prepareBoardDisplay: () => void;
};

export const BoardControllerMenu = ({
  canOpenBoard,
  prepareBoardDisplay,
}: BoardControllerMenuProps) => {
  const {
    aboutChangelogMenuItems,
    aboutChangelogModals,
    updateReadyVersion,
  } = useAboutChangelogMenu();
  const {
    isElectron,
    displays,
    windowStates,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindowToDisplay,
    setDisplayPreference,
  } = useElectronWindows();

  const boardWindowOpen = isElectronDisplayWindowOpen(
    isElectron,
    windowStates,
    "board",
  );

  const openWindowOnLastUsedDisplay = async (windowType: WindowType) => {
    prepareBoardDisplay();
    try {
      if (isElectron) {
        await openWindow(windowType);
      } else {
        const webRoute =
          windowType === "board" ? buildBoardDisplayRoute() : "/projector";
        const webTarget = windowType === "board" ? "_board" : "_projector";
        const webUrl =
          windowType === "board" ? buildBoardDisplayUrl() : `#${webRoute}`;
        window.open(webUrl, webTarget, "width=1280,height=720");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const openWindowOnDisplay = async (
    windowType: WindowType,
    displayId: number,
  ) => {
    prepareBoardDisplay();
    try {
      if (!isElectron) {
        await openWindowOnLastUsedDisplay(windowType);
        return;
      }

      const moved = await moveWindowToDisplay(windowType, displayId);
      if (moved) {
        await focusWindow(windowType);
        return;
      }

      await setDisplayPreference(windowType, displayId);
      await openWindow(windowType);
    } catch (error) {
      console.error(error);
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
        <div className="flex items-center gap-2">
          <Home className="size-4 text-gray-300" />
          Home
        </div>
      ),
      to: "/",
    },
    canOpenBoard || boardWindowOpen
      ? {
        text: boardWindowOpen ? "Close Board" : "Open Board",
        element: (
          <div className="flex items-center gap-2">
            <Presentation className="size-4 text-gray-300" />
            {boardWindowOpen ? "Close Board" : "Open Board"}
          </div>
        ),
        ...(boardWindowOpen
          ? {
            onClick: async () => {
              await closeWindow("board");
            },
          }
          : isElectron && displays.length > 0
            ? {
              subItems: buildDisplaySubItems("board"),
            }
            : {
              onClick: async () => {
                await openWindowOnLastUsedDisplay("board");
              },
            }),
      }
      : {
        text: "Open Board",
        element: (
          <div className="flex items-center gap-2 opacity-60">
            <Presentation className="size-4 text-gray-300" />
            Open Board
          </div>
        ),
        disabled: true,
      },
    ...aboutChangelogMenuItems,
  ];

  return (
    <>
      <Menu
        menuItems={menuItems}
        align="start"
        TriggeringButton={
          <Button
            variant="tertiary"
            className="w-fit"
            aria-label="Open menu"
            svg={MenuIcon}
            gap="gap-1.5"
          >
            Menu
            {updateReadyVersion ? (
              <Icon svg={CircleAlert} color="#f59e0b" size="sm" />
            ) : null}
          </Button>
        }
      />
      {aboutChangelogModals}
    </>
  );
};
