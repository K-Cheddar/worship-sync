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
import { MonitorUp, MonitorX } from "lucide-react";
import ProjectorPresentationPreview from "./ProjectorPresentationPreview";
import MonitorPresentationPreview from "./MonitorPresentationPreview";
import StreamPresentationPreview from "./StreamPresentationPreview";

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

  const showProjector = visibleScreens.includes("projector");
  const showMonitor = visibleScreens.includes("monitor");
  const showStream = visibleScreens.includes("stream");
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
