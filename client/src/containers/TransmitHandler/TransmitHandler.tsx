import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import {
  setTransmitToAll,
  clearStreamOverlaysOnly,
  setStreamItemContentBlocked,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  toggleProjectorTransmitting,
  clearAll,
  clearStream,
} from "../../store/presentationSlice";
import Button from "../../components/Button/Button";
import { ControllerInfoContext } from "../../context/controllerInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import QuickLink from "../../components/QuickLink/QuickLink";
import cn from "classnames";
import { ChevronDown, MonitorUp, MonitorX } from "lucide-react";
import { CLEAR_ACTION_ICON_COLOR } from "../../constants";
import ProjectorPresentationPreview from "./ProjectorPresentationPreview";
import MonitorPresentationPreview from "./MonitorPresentationPreview";
import StreamPresentationPreview from "./StreamPresentationPreview";
import BoardMonitorPreview from "./BoardMonitorPreview";
import { useStoredBoardDisplayAlias } from "../../boards/useStoredBoardDisplayAlias";

/** Stream quick links shown below the preview on overlay controller (max count). */
const OVERLAY_STREAM_QUICK_LINKS_VISIBLE = 10;

export type TransmitScreen = "projector" | "monitor" | "stream";

const DEFAULT_TRANSMIT_SCREENS: TransmitScreen[] = [
  "projector",
  "monitor",
  "stream",
];

type TransmitHandlerProps = {
  visibleScreens?: TransmitScreen[];
  /** DisplayWindow width multiplier (1 = default 14vw / 32vw mobile). */
  previewScale?: number;
  variant?: "default" | "overlayStreamFocus";
  showStreamOverlayOnlyToggle?: boolean;
  showClearStreamOverlaysButton?: boolean;
  /** When set, each screen shows at most this many quick links (e.g. 4 on main controller). */
  maxQuickLinks?: number;
};

const TransmitHandler = ({
  visibleScreens = DEFAULT_TRANSMIT_SCREENS,
  previewScale = 1,
  variant = "default",
  showStreamOverlayOnlyToggle = false,
  showClearStreamOverlaysButton = false,
  maxQuickLinks,
}: TransmitHandlerProps) => {
  const isMonitorTransmitting = useSelector(
    (state) => state.presentation.isMonitorTransmitting
  );
  const isProjectorTransmitting = useSelector(
    (state) => state.presentation.isProjectorTransmitting
  );
  const isStreamTransmitting = useSelector(
    (state) => state.presentation.isStreamTransmitting
  );
  const streamItemContentBlocked = useSelector(
    (state) => state.presentation.streamItemContentBlocked
  );
  const [isTransmitting, setIsTransmitting] = useState(false);

  const timers = useSelector((state) => state.timers.timers);

  const dispatch = useDispatch();

  const isMediaExpanded = useSelector(
    (state) => state.undoable.present.preferences.isMediaExpanded
  );
  const quickLinks = useSelector(
    (state) => state.undoable.present.preferences.quickLinks
  );
  const defaultQuickLinks = useSelector(
    (state) => state.undoable.present.preferences.defaultQuickLinks
  );

  const { isMobile } = useContext(ControllerInfoContext) || {};

  // Discussion board → monitor: only relevant on the main controller, and only
  // when the church actually has a board (the alias is auto-seeded once one
  // exists). Collapsed by default so it stays out of the way until needed.
  const boardAliasId = useStoredBoardDisplayAlias();
  const monitorBoardAliasId = useSelector(
    (state) => state.presentation.monitorBoardAliasId
  );
  const [isBoardSectionOpen, setIsBoardSectionOpen] = useState(false);

  const showProjector = visibleScreens.includes("projector");
  const showMonitor = visibleScreens.includes("monitor");
  const showStream = visibleScreens.includes("stream");
  // A board that's already live on the monitor must always keep its section (and
  // its "off" switch) rendered, even if the preview inputs that normally reveal
  // the section — the seeded board alias or the monitor being visible — have
  // since gone away. Otherwise the control that turns the board off can unmount
  // while the board stays on the monitor, leaving no way to remove it.
  const isBoardLiveOnMonitor = monitorBoardAliasId !== "";
  const showBoardSection =
    variant === "default" &&
    (isBoardLiveOnMonitor || (showMonitor && Boolean(boardAliasId)));
  const showBulkControls =
    showProjector && showMonitor && showStream;
  const showFocusedStreamControls =
    showStream && (showStreamOverlayOnlyToggle || showClearStreamOverlaysButton);

  useEffect(() => {
    if (!showBulkControls) return;
    setIsTransmitting(
      isMonitorTransmitting && isProjectorTransmitting && isStreamTransmitting
    );
  }, [
    showBulkControls,
    isMonitorTransmitting,
    isProjectorTransmitting,
    isStreamTransmitting,
  ]);

  const handleSetTransmitting = useCallback(() => {
    setIsTransmitting((prev) => {
      const next = !prev;
      queueMicrotask(() => dispatch(setTransmitToAll(next)));
      return next;
    });
  }, [dispatch]);

  const handleClearAll = useCallback(() => {
    dispatch(clearAll());
  }, [dispatch]);

  const toggleProjector = useCallback(() => {
    dispatch(toggleProjectorTransmitting());
  }, [dispatch]);

  const toggleMonitor = useCallback(() => {
    dispatch(toggleMonitorTransmitting());
  }, [dispatch]);

  const toggleStream = useCallback(() => {
    dispatch(toggleStreamTransmitting());
  }, [dispatch]);

  const handleClearStreamOverlays = useCallback(() => {
    dispatch(clearStreamOverlaysOnly());
  }, [dispatch]);

  const allQuickLinks = useMemo(
    () => [...defaultQuickLinks, ...quickLinks],
    [defaultQuickLinks, quickLinks]
  );

  const projectorQuickLinks = useMemo(() => {
    const list = allQuickLinks.filter((link) => link.displayType === "projector");
    return maxQuickLinks === undefined ? list : list.slice(0, maxQuickLinks);
  }, [allQuickLinks, maxQuickLinks]);

  const monitorQuickLinks = useMemo(() => {
    const list = allQuickLinks.filter((link) => link.displayType === "monitor");
    return maxQuickLinks === undefined ? list : list.slice(0, maxQuickLinks);
  }, [allQuickLinks, maxQuickLinks]);

  const streamQuickLinks = useMemo(() => {
    const list = allQuickLinks.filter((link) => link.displayType === "stream");
    return maxQuickLinks === undefined ? list : list.slice(0, maxQuickLinks);
  }, [allQuickLinks, maxQuickLinks]);

  const overlayStreamQuickLinksBelowPreview = useMemo(() => {
    const actionable = streamQuickLinks.filter((link) => link.action !== "clear");
    return actionable.slice(0, OVERLAY_STREAM_QUICK_LINKS_VISIBLE);
  }, [streamQuickLinks]);

  return (
    <ErrorBoundary>
      <div
        className={cn(
          "transition-all relative flex flex-col min-h-0",
          isMediaExpanded ? "h-0 z-0 opacity-0 flex-none" : "flex-1 opacity-100"
        )}
        data-is-media-expanded={isMediaExpanded}
      >
        <section
          className={cn(
            "flex flex-col gap-2 w-full mx-auto h-full p-2",
            variant === "overlayStreamFocus" && "gap-3"
          )}
        >
          {showBulkControls && (
            <div className="w-full flex justify-center items-center gap-4">
              <Button
                onClick={handleClearAll}
                className="text-sm"
                padding="py-1 px-2"
                svg={MonitorX}
                color={CLEAR_ACTION_ICON_COLOR}
              >
                Clear All
              </Button>
              <hr className="border-r border-gray-400 max-md:h-12 h-6" />
              <Toggle
                label="Live on All"
                icon={MonitorUp}
                value={isTransmitting}
                onChange={handleSetTransmitting}
                color="#22c55e"
              />
            </div>
          )}
          {showFocusedStreamControls && (
            <div
              className={cn(
                "rounded-md border border-white/12 bg-black/30 px-3 py-3",
                variant === "overlayStreamFocus"
                  ? "flex flex-col gap-4"
                  : "flex items-center gap-3"
              )}
            >
              {variant === "overlayStreamFocus" && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/10 pb-4">
                  <Button
                    onClick={() => dispatch(clearStream())}
                    className="text-sm shrink-0 justify-self-start"
                    padding="py-1 px-2"
                    svg={MonitorX}
                    color={CLEAR_ACTION_ICON_COLOR}
                  >
                    Clear All
                  </Button>
                  <div className="text-sm font-semibold text-white text-center">
                    Stream
                  </div>
                  <Toggle
                    label="Live"
                    icon={MonitorUp}
                    value={isStreamTransmitting}
                    onChange={toggleStream}
                    color="#22c55e"
                    className="shrink-0 justify-self-end"
                  />
                </div>
              )}
              {(showStreamOverlayOnlyToggle || showClearStreamOverlaysButton) && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {showStreamOverlayOnlyToggle && (
                    <Toggle
                      label="Hide Content"
                      value={streamItemContentBlocked}
                      onChange={(value) =>
                        dispatch(setStreamItemContentBlocked(value))
                      }
                      color="#f59e0b"
                    />
                  )}
                  {showClearStreamOverlaysButton && (
                    <Button
                      onClick={handleClearStreamOverlays}
                      className="text-sm shrink-0"
                      variant="tertiary"
                      padding="py-1 px-3"
                    >
                      Clear Overlays
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="scrollbar-variable overflow-y-auto flex-1 min-h-0 flex flex-col gap-2">
            {showProjector && (
              <ProjectorPresentationPreview
                toggleIsTransmitting={toggleProjector}
                quickLinks={projectorQuickLinks}
                isMobile={isMobile}
                previewScale={previewScale}
              />
            )}
            {showMonitor && (
              <MonitorPresentationPreview
                toggleIsTransmitting={toggleMonitor}
                quickLinks={monitorQuickLinks}
                isMobile={isMobile}
                previewScale={previewScale}
              />
            )}
            {showBoardSection && (
              <div className="relative overflow-hidden rounded-sm border border-white/12 bg-black/30">
                <button
                  type="button"
                  onClick={() => setIsBoardSectionOpen((open) => !open)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-2 bg-black/25 px-2 py-1 text-xs font-semibold transition-colors",
                    isBoardSectionOpen && "border-b border-white/10",
                    "hover:bg-black/40 active:bg-black/50",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500/60"
                  )}
                  aria-expanded={isBoardSectionOpen}
                  aria-controls="discussion-board-panel"
                >
                  <span className="truncate min-w-0 text-left">Discussion Board</span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
                      isBoardSectionOpen ? "rotate-180" : "rotate-0"
                    )}
                    aria-hidden
                  />
                </button>
                <div
                  id="discussion-board-panel"
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
                    isBoardSectionOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div
                    className="min-h-0 overflow-hidden"
                    inert={isBoardSectionOpen ? undefined : true}
                  >
                    <div className="px-2 pb-2">
                      <BoardMonitorPreview isOpen={isBoardSectionOpen} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {showStream && (
              <>
                <StreamPresentationPreview
                  toggleIsTransmitting={toggleStream}
                  quickLinks={streamQuickLinks}
                  variant={variant}
                  showFocusedStreamControls={showFocusedStreamControls}
                  isMobile={isMobile}
                  previewScale={previewScale}
                />
                {variant === "overlayStreamFocus" &&
                  overlayStreamQuickLinksBelowPreview.length > 0 && (
                    <ul className="grid w-full shrink-0 grid-cols-4 gap-2 border-t border-white/12 py-1 pt-2">
                      {overlayStreamQuickLinksBelowPreview.map((link) => (
                        <QuickLink
                          key={link.id}
                          timers={timers}
                          displayType="stream"
                          isMobile={isMobile}
                          {...link}
                        />
                      ))}
                    </ul>
                  )}
              </>
            )}
          </div>
        </section>
      </div>
    </ErrorBoundary>
  );
};

export default TransmitHandler;
