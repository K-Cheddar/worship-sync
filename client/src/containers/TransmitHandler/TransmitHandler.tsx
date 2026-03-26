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
import Presentation from "../../components/Presentation/Presentation";
import Button from "../../components/Button/Button";
import { ControllerInfoContext } from "../../context/controllerInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import QuickLink from "../../components/QuickLink/QuickLink";
import cn from "classnames";
import { MonitorUp, MonitorX } from "lucide-react";

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
  const {
    isMonitorTransmitting,
    isProjectorTransmitting,
    isStreamTransmitting,
    streamItemContentBlocked,
    prevProjectorInfo,
    prevMonitorInfo,
    prevStreamInfo,
    projectorInfo,
    monitorInfo,
    streamInfo,
  } = useSelector((state) => state.presentation);
  const [isTransmitting, setIsTransmitting] = useState(false);

  const timers = useSelector((state) => state.timers.timers);
  const projectorTimer = timers.find(
    (timer) => timer.id === projectorInfo.timerId
  );
  const monitorTimer = timers.find((timer) => timer.id === monitorInfo.timerId);
  const streamTimer = timers.find((timer) => timer.id === streamInfo.timerId);

  const prevProjectorTimer = timers.find(
    (timer) => timer.id === prevProjectorInfo.timerId
  );
  const prevMonitorTimer = timers.find(
    (timer) => timer.id === prevMonitorInfo.timerId
  );
  const prevStreamTimer = timers.find(
    (timer) => timer.id === prevStreamInfo.timerId
  );

  const dispatch = useDispatch();

  const { isMediaExpanded, quickLinks, defaultQuickLinks } = useSelector(
    (state) => state.undoable.present.preferences
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
                "rounded-md border border-gray-600 bg-gray-800 px-3 py-3",
                variant === "overlayStreamFocus"
                  ? "flex flex-col gap-4"
                  : "flex items-center gap-3"
              )}
            >
              {variant === "overlayStreamFocus" && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-gray-600 pb-4">
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
              <Presentation
                timers={timers}
                name="Projector"
                prevInfo={prevProjectorInfo}
                timerInfo={projectorTimer}
                prevTimerInfo={prevProjectorTimer}
                info={projectorInfo}
                isTransmitting={isProjectorTransmitting}
                toggleIsTransmitting={toggleProjector}
                quickLinks={projectorQuickLinks}
                isMobile={isMobile}
                previewScale={previewScale}
              />
            )}
            {showMonitor && (
              <Presentation
                timers={timers}
                name="Monitor"
                prevInfo={prevMonitorInfo}
                timerInfo={monitorTimer}
                prevTimerInfo={prevMonitorTimer}
                info={monitorInfo}
                isTransmitting={isMonitorTransmitting}
                toggleIsTransmitting={toggleMonitor}
                quickLinks={monitorQuickLinks}
                isMobile={isMobile}
                showMonitorClockTimer
                previewScale={previewScale}
              />
            )}
            {showStream && (
              <>
                <Presentation
                  timers={timers}
                  name="Stream"
                  prevInfo={prevStreamInfo}
                  timerInfo={streamTimer}
                  prevTimerInfo={prevStreamTimer}
                  info={streamInfo}
                  isTransmitting={isStreamTransmitting}
                  toggleIsTransmitting={toggleStream}
                  quickLinks={
                    variant === "overlayStreamFocus" ? [] : streamQuickLinks
                  }
                  hideQuickLinks={variant === "overlayStreamFocus"}
                  hideHeader={variant === "overlayStreamFocus"}
                  minimalHeader={
                    variant === "overlayStreamFocus" && showFocusedStreamControls
                  }
                  isMobile={isMobile}
                  streamItemContentBlocked={streamItemContentBlocked}
                  previewScale={previewScale}
                />
                {variant === "overlayStreamFocus" &&
                  overlayStreamQuickLinksBelowPreview.length > 0 && (
                    <ul className="grid grid-cols-4 gap-2 py-1 w-full shrink-0 border-t border-gray-600 pt-2">
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
