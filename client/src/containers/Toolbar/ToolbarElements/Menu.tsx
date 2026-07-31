import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CircleAlert,
  Home,
  Menu as MenuIcon,
  MessagesSquare,
  Monitor,
  SquarePen,
  Presentation,
} from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import { interfaceZoomMenuItem } from "../../../components/InterfaceZoomMenuControl/InterfaceZoomMenuControl";
import { MenuItemType } from "../../../types";
import { useContext } from "react";
import { useAboutChangelogMenu } from "../../../hooks/useAboutChangelogMenu";
import { useElectronWindows } from "../../../hooks/useElectronWindows";
import { useIdentifyOnHover } from "../../../hooks/useIdentifyOnHover";
import { useInterfaceZoom } from "../../../hooks/useInterfaceZoom";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { getDisplayLabel } from "../../../utils/displayUtils";
import {
  buildBoardDisplayUrl,
  setStoredBoardDisplayAliasId,
} from "../../../boards/boardUtils";
import { useResolvedBoardDisplayAlias } from "../../../boards/useResolvedBoardDisplayAlias";
import type { WindowType } from "../../../types/electron";
import { isElectronDisplayWindowOpen } from "../../../utils/isElectronDisplayWindowOpen";

const ToolbarMenu = ({
  variant = "default",
}: {
  variant?: "default" | "overlay";
}) => {
  const { access, loginState, exitGuestMode } = useContext(GlobalInfoContext) || {};
  const isGuest = loginState === "guest";
  const {
    aboutChangelogMenuItems,
    aboutChangelogModals,
    updateReadyVersion,
  } = useAboutChangelogMenu();
  // Keep zoom applied while the controller menu is mounted (shared across domains).
  useInterfaceZoom();
  const navigate = useNavigate();
  const {
    isElectron,
    displays,
    windowStates,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindowToDisplay,
    setDisplayPreference,
    identifyDisplay,
    identifyDisplayForWindow,
    hideIdentifyDisplay,
    cancelIdentifyDisplay,
  } = useElectronWindows();
  const {
    getHandlers: getIdentifyHoverHandlers,
    cancel: cancelIdentifyHover,
  } = useIdentifyOnHover({
    hide: hideIdentifyDisplay,
    cancel: cancelIdentifyDisplay,
  });

  const monitorMenuOpen = isElectronDisplayWindowOpen(
    isElectron,
    windowStates,
    "monitor",
  );
  const projectorMenuOpen = isElectronDisplayWindowOpen(
    isElectron,
    windowStates,
    "projector",
  );
  const boardMenuOpen = isElectronDisplayWindowOpen(
    isElectron,
    windowStates,
    "board",
  );

  // Whether the operator can open presentation surfaces at all (mirrors the gate
  // on the monitor/projector/board menu items below). Used to avoid fetching
  // board data for viewers/guests who can't open a board anyway.
  const canManageDisplays =
    variant !== "overlay" &&
    access !== "view" &&
    access !== "music" &&
    !isGuest;

  // The board display renders one discussion board, identified by an alias id in
  // localStorage. That id used to be seeded only by visiting the Board Controller
  // page; the resolver fetches the church's boards and picks a default (remembered
  // board if it still exists, else the first) so the menu item can enable without a
  // prior open. Resolution is pure — the write happens only when the operator
  // explicitly opens the board (see openWindowOnLastUsedDisplay / openWindowOnDisplay),
  // so resolving on mount can never silently re-point an open board display.
  const resolvedBoardAliasId = useResolvedBoardDisplayAlias({
    enabled: canManageDisplays,
  });

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

  // Persist the resolved board so the display window reads the right one. Done
  // here — at the moment of an explicit open — rather than during resolution, so
  // merely rendering the menu never re-points an already-open board display.
  const seedBoardDisplayAlias = (windowType: WindowType) => {
    if (windowType === "board" && resolvedBoardAliasId) {
      setStoredBoardDisplayAliasId(resolvedBoardAliasId);
    }
  };

  const openWindowOnLastUsedDisplay = async (windowType: WindowType) => {
    seedBoardDisplayAlias(windowType);
    try {
      if (isElectron) {
        await openWindow(windowType);
      } else if (windowType === "board") {
        window.open(buildBoardDisplayUrl(), "_board", "width=1280,height=720");
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
    seedBoardDisplayAlias(windowType);
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
      ...getIdentifyHoverHandlers((generation) => {
        void identifyDisplayForWindow?.(windowType, generation);
      }),
    },
    ...displays.map((display, index) => ({
      text: getDisplayLabel(display, index),
      onClick: () => openWindowOnDisplay(windowType, display.id),
      ...getIdentifyHoverHandlers((generation) => {
        void identifyDisplay?.(display.id, generation);
      }),
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
          {isGuest ? "Return to start" : "Home"}
        </div>
      ),
      ...(isGuest
        ? {
          onClick: () => {
            void exitGuestMode?.();
          },
        }
        : { to: "/" }),
    },
    ...(access !== "music" && !isGuest
      ? [
        {
          element: (
            <div className="flex items-center gap-2 max-md:min-h-12">
              <Icon svg={SquarePen} color="#d1d5dc" />
              Credits Editor
            </div>
          ),
          to: "/credits-editor",
        },
      ]
      : []),
    ...(variant === "overlay" || access === "view" || access === "music" || isGuest
      ? []
      : [
        {
          text: monitorMenuOpen ? "Close Stage Monitor" : "Open Stage Monitor",
          element: (
            <div className="flex items-center gap-2 max-md:min-h-12">
              <Icon svg={Monitor} color="#d1d5dc" />
              {monitorMenuOpen ? "Close Stage Monitor" : "Open Stage Monitor"}
            </div>
          ),
          ...(monitorMenuOpen
            ? {
              onClick: async () => {
                await closeWindow("monitor");
              },
            }
            : isElectron && displays.length > 0
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
          text: projectorMenuOpen ? "Close Projector" : "Open Projector",
          element: (
            <div className="flex items-center gap-2 max-md:min-h-12">
              <Icon svg={Presentation} color="#d1d5dc" />
              {projectorMenuOpen ? "Close Projector" : "Open Projector"}
            </div>
          ),
          ...(projectorMenuOpen
            ? {
              onClick: async () => {
                await closeWindow("projector");
              },
            }
            : isElectron && displays.length > 0
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
          text: boardMenuOpen ? "Close Discussion Board" : "Open Discussion Board",
          element: (
            <div
              className={`flex items-center gap-2 max-md:min-h-12${!boardMenuOpen && !resolvedBoardAliasId ? " opacity-60" : ""
                }`}
            >
              <Icon svg={MessagesSquare} color="#d1d5dc" />
              {boardMenuOpen ? "Close Discussion Board" : "Open Discussion Board"}
            </div>
          ),
          ...(boardMenuOpen
            ? {
              onClick: async () => {
                await closeWindow("board");
              },
            }
            : !resolvedBoardAliasId
              ? {
                disabled: true,
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
        },
      ]),

    ...aboutChangelogMenuItems,
    interfaceZoomMenuItem,
  ];

  return (
    <>
      <Menu
        menuItems={menuItems}
        align="start"
        onOpenChange={(open) => {
          if (!open) cancelIdentifyHover();
        }}
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

export default ToolbarMenu;
