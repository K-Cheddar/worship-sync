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
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import { MenuItemType } from "../../../types";
import { useState, useEffect, useContext, useRef } from "react";
import { useAboutChangelogMenu } from "../../../hooks/useAboutChangelogMenu";
import { useElectronWindows } from "../../../hooks/useElectronWindows";
import { useIdentifyOnHover } from "../../../hooks/useIdentifyOnHover";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { getDisplayLabel } from "../../../utils/displayUtils";
import {
  buildBoardDisplayUrl,
  setStoredBoardDisplayAliasId,
} from "../../../boards/boardUtils";
import { useStoredBoardDisplayAlias } from "../../../boards/useStoredBoardDisplayAlias";
import { getBoardAliases } from "../../../boards/api";
import { MAX_INITIAL_SESSION_RETRIES } from "../../../constants";
import type { WindowType } from "../../../types/electron";
import { Slider } from "../../../components/ui/Slider";
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
  const [zoomLevel, setZoomLevel] = useState(100);
  const zoomStep = 10;
  const zoomMin = 50;
  const zoomMax = 200;
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
  // localStorage (kept in step across tabs/windows by useStoredBoardDisplayAlias).
  // That id used to be seeded only by visiting the Board Controller page. To let
  // the operator open the board straight from here, we fetch the church's boards
  // and resolve a default for enabling the menu item: the remembered board if it
  // still exists, otherwise the first one. Resolution is pure — it never writes
  // storage. The write happens only when the operator explicitly opens the board
  // (see openWindowOnLastUsedDisplay / openWindowOnDisplay), so resolving on
  // mount can never silently re-point an open board display.
  const storedBoardAliasId = useStoredBoardDisplayAlias();
  const [boardAliases, setBoardAliases] = useState<
    { aliasId: string }[] | null
  >(null);
  const boardAliasesLoadedRef = useRef(false);

  // Until the church's boards have loaded, trust the stored id (it was validated
  // when written). Once loaded, keep it only if it still exists, else fall back
  // to the first board. Empty means there is nothing to show → item disabled.
  const resolvedBoardAliasId =
    boardAliases === null
      ? storedBoardAliasId
      : storedBoardAliasId &&
          boardAliases.some((alias) => alias.aliasId === storedBoardAliasId)
        ? storedBoardAliasId
        : (boardAliases[0]?.aliasId ?? "");

  useEffect(() => {
    if (!canManageDisplays) return;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const { aliases } = await getBoardAliases();
        if (cancelled) return;
        attempt = 0;
        boardAliasesLoadedRef.current = true;
        setBoardAliases(aliases);
      } catch (error) {
        if (cancelled) return;
        // Transient failures (flaky booth network) shouldn't permanently wedge
        // the resolver; retry with backoff. A known-good stored alias stays
        // usable meanwhile because resolution falls back to it until we load.
        console.error("Could not load discussion boards:", error);
        if (attempt >= MAX_INITIAL_SESSION_RETRIES) return;
        const delay = Math.min(30000, 5000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(() => void load(), delay);
      }
    };

    const handleFocus = () => {
      // If we never managed to learn the church's boards, try again when the
      // operator returns to the window (covers exhausted retries).
      if (boardAliasesLoadedRef.current) return;
      attempt = 0;
      if (retryTimer) clearTimeout(retryTimer);
      void load();
    };

    void load();
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [canManageDisplays]);

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
