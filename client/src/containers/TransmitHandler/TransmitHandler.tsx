import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import { shallowEqual } from "react-redux";
import {
  setTransmitToAll,
  clearStreamOverlaysOnly,
  setStreamItemContentBlocked,
  toggleOutputTransmitting,
  clearAll,
  clearStream,
  selectOutputSlot,
  selectOutputSlots,
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
import { useResolvedBoardDisplayAlias } from "../../boards/useResolvedBoardDisplayAlias";
import {
  isPushOutputType,
  supportsBoardTakeover,
} from "../../utils/displayOutputs";
import { getQuickLinksForOutput } from "../../utils/quickLinksForOutput";
import { QuickLinkType } from "../../types";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { useActiveControllerProfile } from "../../context/activeController";
import { getControllerOutputs } from "../../utils/controllerProfiles";
import MirroredByBadge from "../../components/MirrorDisplay/MirroredByBadge";

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
  /**
   * Fill the parent width with true 16:9 stages (like ItemSlides). Prefer this
   * over a large previewScale when previews should use the full column.
   */
  fillWidth?: boolean;
  /** Arrange projector / monitor / stream previews in 1 or 2 columns. */
  columns?: 1 | 2;
  /** Renders live output previews without any transmit, clear, or quick-link controls. */
  readOnly?: boolean;
  variant?: "default" | "overlayStreamFocus";
  showStreamOverlayOnlyToggle?: boolean;
  showClearStreamOverlaysButton?: boolean;
  /** When set, each screen shows at most this many quick links (e.g. 4 on main controller). */
  maxQuickLinks?: number;
};

const TransmitHandler = ({
  visibleScreens = DEFAULT_TRANSMIT_SCREENS,
  previewScale = 1,
  fillWidth = false,
  columns = 1,
  readOnly = false,
  variant = "default",
  showStreamOverlayOnlyToggle = false,
  showClearStreamOverlaysButton = false,
  maxQuickLinks,
}: TransmitHandlerProps) => {
  // Outputs this surface shows: the displays the active controller owns, then
  // narrowed to the render profiles the caller asked for. `visibleScreens` stays
  // a type filter, so the overlay controller keeps showing "the stream ones"
  // without naming them.
  //
  // The ownership narrowing is a no-op for the unscoped built-ins, and it is
  // what keeps an auxiliary controller from showing — or arming — a display
  // that belongs to someone else.
  const displayOutputs = useSelector(selectDisplayOutputs);
  const controllerProfile = useActiveControllerProfile();
  const visibleOutputs = useMemo(
    () =>
      getControllerOutputs(controllerProfile, displayOutputs).filter(
        (output) =>
          isPushOutputType(output.type) &&
          visibleScreens.includes(output.type as TransmitScreen),
      ),
    [controllerProfile, displayOutputs, visibleScreens],
  );

  // The overlay controller's focused header acts on the first stream output it
  // shows; per-stream control lives on each tile below it.
  const primaryStreamOutput = visibleOutputs.find(
    (output) => output.type === "stream",
  );
  const primaryStreamOutputId = primaryStreamOutput?.id ?? "stream";

  // The header acts on the primary stream, so it has to report that stream —
  // "any stream is live" would show Live on while the control below it turns
  // the primary on instead of off.
  const isStreamTransmitting = useSelector(
    (state) =>
      selectOutputSlot(state, primaryStreamOutputId, "stream").isTransmitting,
  );
  const streamItemContentBlocked = useSelector(
    (state) =>
      selectOutputSlot(state, primaryStreamOutputId, "stream")
        .itemContentBlocked,
  );
  const [isTransmitting, setIsTransmitting] = useState(false);

  const timers = useSelector((state) => state.timers.timers);

  const dispatch = useDispatch();

  const isMediaExpanded = useSelector(
    (state) => state.undoable.present.preferences.isMediaExpanded,
  );
  const quickLinks = useSelector(
    (state) => state.undoable.present.preferences.quickLinks,
  );
  const defaultQuickLinks = useSelector(
    (state) => state.undoable.present.preferences.defaultQuickLinks,
  );

  const { isMobile } = useContext(ControllerInfoContext) || {};

  // Any full-frame display can host the board now, so find whichever one has it.
  const boardHostOutputId = useSelector((state) => {
    for (const slot of Object.values(selectOutputSlots(state))) {
      if (supportsBoardTakeover(slot.type) && slot.boardAliasId) return slot.id;
    }
    return "";
  });
  const [isBoardSectionOpen, setIsBoardSectionOpen] = useState(false);

  const liveByOutputId = useSelector((state) => {
    const map: Record<string, boolean> = {};
    for (const slot of Object.values(selectOutputSlots(state))) {
      map[slot.id] = slot.isTransmitting;
    }
    return map;
  }, shallowEqual);

  // Stable per-output callbacks; recreating these each render would defeat the
  // memo on the preview tiles during live use.
  const toggleByOutputId = useMemo(() => {
    const map: Record<string, () => void> = {};
    for (const output of visibleOutputs) {
      map[output.id] = () => dispatch(toggleOutputTransmitting(output.id));
    }
    return map;
  }, [visibleOutputs, dispatch]);

  // Derived from the displays actually on screen, not from the caller's type
  // filter. A controller that drives no monitor was still being offered the
  // discussion board and the bulk controls, because it "asked for" all three
  // types by default while owning only a projector.
  const hasOutputOfType = (type: TransmitScreen) =>
    visibleOutputs.some((output) => output.type === type);
  const showProjector = hasOutputOfType("projector");
  const showMonitor = hasOutputOfType("monitor");
  const showStream = hasOutputOfType("stream");

  // Discussion board → monitor: only relevant on the main controller. Resolve the
  // church's board from the server (not just this device's stored alias) so the
  // tile shows even on a device that has never opened the board. Collapsed by
  // default so it stays out of the way until needed.
  const boardAliasId = useResolvedBoardDisplayAlias({
    enabled: !readOnly && variant === "default" && showMonitor,
  });
  // A board that's already live on the monitor must always keep its section (and
  // its "off" switch) rendered, even if the inputs that normally reveal it — a
  // resolvable board alias or the monitor being visible — have since gone away.
  // Otherwise the control that turns the board off can unmount while the board
  // stays on the monitor, leaving no way to remove it.
  const isBoardLiveOnMonitor = boardHostOutputId !== "";
  const showBoardSection =
    !readOnly &&
    variant === "default" &&
    (isBoardLiveOnMonitor || (showMonitor && Boolean(boardAliasId)));
  /**
   * The tile the discussion board belongs under.
   *
   * It follows whichever display is hosting the board, falling back to the
   * built-in monitor. Null when that display is not on screen, and the section
   * falls to the end so its off switch stays reachable.
   */
  const boardAnchorOutputId = useMemo(() => {
    if (!showBoardSection) return null;
    // Follow the display actually hosting the board; otherwise sit under the
    // built-in monitor, which is where it goes by default.
    const host = visibleOutputs.find(
      (output) => output.id === boardHostOutputId,
    );
    return (
      host?.id ??
      visibleOutputs.find((output) => output.id === "monitor")?.id ??
      null
    );
  }, [boardHostOutputId, showBoardSection, visibleOutputs]);

  const boardSection = showBoardSection ? (
    <div className="relative shrink-0 overflow-hidden rounded-sm border border-white/12 bg-black/30">
      <button
        type="button"
        onClick={() => setIsBoardSectionOpen((open) => !open)}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2 bg-black/25 px-2 py-1 text-xs font-semibold transition-colors",
          isBoardSectionOpen && "border-b border-white/10",
          "hover:bg-black/40 active:bg-black/50",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500/60",
        )}
        aria-expanded={isBoardSectionOpen}
        aria-controls="discussion-board-panel"
      >
        <span className="truncate min-w-0 text-left">Discussion Board</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
            isBoardSectionOpen ? "rotate-180" : "rotate-0",
          )}
          aria-hidden
        />
      </button>
      <div
        id="discussion-board-panel"
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          isBoardSectionOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div
          className="min-h-0 overflow-hidden"
          inert={isBoardSectionOpen ? undefined : true}
        >
          <div className="pb-2 pr-2">
            <BoardMonitorPreview
              aliasId={boardAliasId}
              isOpen={isBoardSectionOpen}
              isMobile={isMobile}
              previewScale={previewScale}
              fillWidth={fillWidth}
            />
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const showBulkControls =
    !readOnly && showProjector && showMonitor && showStream;
  const showFocusedStreamControls =
    !readOnly &&
    showStream &&
    (showStreamOverlayOnlyToggle || showClearStreamOverlaysButton);

  useEffect(() => {
    if (!showBulkControls) return;
    setIsTransmitting(
      visibleOutputs.length > 0 &&
        visibleOutputs.every((output) => liveByOutputId[output.id]),
    );
  }, [showBulkControls, liveByOutputId, visibleOutputs]);

  const handleSetTransmitting = useCallback(() => {
    setIsTransmitting((prev) => {
      const next = !prev;
      queueMicrotask(() =>
        dispatch(
          setTransmitToAll({
            value: next,
            outputIds: visibleOutputs.map((output) => output.id),
          }),
        ),
      );
      return next;
    });
  }, [dispatch, visibleOutputs]);

  // Clear every enabled push output, not just the ones this controller shows —
  // Clear All is a panic button and should blank the room, not only the tiles in
  // view. Disabled displays are left alone: a clear is a write, and a display the
  // operator turned off should not be written to.
  const clearableOutputIds = useMemo(
    () =>
      displayOutputs
        .filter((output) => output.enabled && isPushOutputType(output.type))
        .map((output) => output.id),
    [displayOutputs],
  );

  const handleClearAll = useCallback(() => {
    dispatch(clearAll({ outputIds: clearableOutputIds }));
  }, [dispatch, clearableOutputIds]);

  const handleTogglePrimaryStream = useCallback(() => {
    if (!primaryStreamOutput) return;
    dispatch(toggleOutputTransmitting(primaryStreamOutput.id));
  }, [dispatch, primaryStreamOutput]);

  const handleClearStreamOverlays = useCallback(() => {
    dispatch(
      clearStreamOverlaysOnly(
        primaryStreamOutput
          ? { outputIds: [primaryStreamOutput.id] }
          : undefined,
      ),
    );
  }, [dispatch, primaryStreamOutput]);

  const allQuickLinks = useMemo(
    () => [...defaultQuickLinks, ...quickLinks],
    [defaultQuickLinks, quickLinks],
  );

  // Quick links belong to a display, not a display type, so two projectors can
  // carry different shortcuts. Resolved once per render rather than per tile.
  const quickLinksByOutputId = useMemo(() => {
    const map: Record<string, QuickLinkType[]> = {};
    for (const output of visibleOutputs) {
      map[output.id] = getQuickLinksForOutput(
        allQuickLinks,
        output,
        maxQuickLinks,
      );
    }
    return map;
  }, [allQuickLinks, maxQuickLinks, visibleOutputs]);

  const overlayStreamQuickLinksBelowPreview = useMemo(() => {
    if (!primaryStreamOutput) return [];
    const actionable = (
      quickLinksByOutputId[primaryStreamOutput.id] ?? []
    ).filter((link) => link.action !== "clear");
    return actionable.slice(0, OVERLAY_STREAM_QUICK_LINKS_VISIBLE);
  }, [primaryStreamOutput, quickLinksByOutputId]);

  return (
    <ErrorBoundary>
      <div
        className={cn(
          "transition-all relative flex flex-col min-h-0",
          !readOnly && isMediaExpanded
            ? "h-0 z-0 opacity-0 flex-none"
            : "flex-1 opacity-100",
        )}
        data-is-media-expanded={isMediaExpanded}
      >
        <section
          className={cn(
            "flex flex-col gap-2 w-full mx-auto h-full p-2",
            variant === "overlayStreamFocus" && "gap-3",
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
                  : "flex items-center gap-3",
              )}
            >
              {variant === "overlayStreamFocus" && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/10 pb-4">
                  <Button
                    // Scoped like Hide Content and Clear Overlays beside it.
                    // Untargeted, this blanked every stream in the church.
                    onClick={() =>
                      dispatch(
                        clearStream(
                          primaryStreamOutput
                            ? { outputIds: [primaryStreamOutput.id] }
                            : undefined,
                        ),
                      )
                    }
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
                    onChange={handleTogglePrimaryStream}
                    color="#22c55e"
                    className="shrink-0 justify-self-end"
                  />
                </div>
              )}
              {(showStreamOverlayOnlyToggle ||
                showClearStreamOverlaysButton) && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {showStreamOverlayOnlyToggle && (
                    <Toggle
                      label="Hide Content"
                      value={streamItemContentBlocked}
                      onChange={(value) =>
                        dispatch(
                          setStreamItemContentBlocked({
                            value,
                            outputIds: primaryStreamOutput
                              ? [primaryStreamOutput.id]
                              : undefined,
                          }),
                        )
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
          <div
            className={cn(
              "scrollbar-variable overflow-y-auto flex-1 min-h-0 gap-2",
              columns === 2
                ? "grid grid-cols-2 content-start"
                : "flex flex-col",
            )}
          >
            {/* One ordered pass over every push output. Splitting streams into
                a second pass pinned them last, so reordering a stream relative to
                a projector changed the registry and nothing on screen. */}
            {visibleOutputs.map((output) => {
              // The board sits directly under the display hosting it, so it
              // travels with that tile when the operator reorders displays.
              const board =
                output.id === boardAnchorOutputId ? boardSection : null;

              if (output.type === "projector") {
                return (
                  <Fragment key={output.id}>
                    <ProjectorPresentationPreview
                      outputId={output.id}
                      name={output.name}
                      toggleIsTransmitting={toggleByOutputId[output.id]}
                      quickLinks={quickLinksByOutputId[output.id] ?? []}
                      isMobile={isMobile}
                      previewScale={previewScale}
                      fillWidth={fillWidth}
                      readOnly={readOnly}
                    />
                    <MirroredByBadge outputId={output.id} />
                    {board}
                  </Fragment>
                );
              }

              if (output.type === "monitor") {
                return (
                  <Fragment key={output.id}>
                    <MonitorPresentationPreview
                      outputId={output.id}
                      name={output.name}
                      toggleIsTransmitting={toggleByOutputId[output.id]}
                      quickLinks={quickLinksByOutputId[output.id] ?? []}
                      isMobile={isMobile}
                      previewScale={previewScale}
                      fillWidth={fillWidth}
                      readOnly={readOnly}
                    />
                    {board}
                  </Fragment>
                );
              }

              return (
                <Fragment key={output.id}>
                  <StreamPresentationPreview
                    outputId={output.id}
                    name={output.name}
                    toggleIsTransmitting={toggleByOutputId[output.id]}
                    quickLinks={quickLinksByOutputId[output.id] ?? []}
                    variant={variant}
                    showFocusedStreamControls={showFocusedStreamControls}
                    isMobile={isMobile}
                    previewScale={previewScale}
                    fillWidth={fillWidth}
                    readOnly={readOnly}
                  />
                  {/* Belongs to the primary stream only — it would otherwise
                      repeat under every stream tile. */}
                  {variant === "overlayStreamFocus" &&
                    output.id === primaryStreamOutput?.id &&
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
                </Fragment>
              );
            })}
            {showBoardSection && !boardAnchorOutputId && boardSection}
          </div>
        </section>
      </div>
    </ErrorBoundary>
  );
};

export default TransmitHandler;
