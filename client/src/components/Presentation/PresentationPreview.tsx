import { ReactNode, useEffect, useId, useRef, useState } from "react";
import DisplayWindow from "../DisplayWindow/DisplayWindow";
import Toggle from "../Toggle/Toggle";
import QuickLink, {
  COMPACT_QUICK_LINK_LABEL_CLASS,
  COMPACT_QUICK_LINK_LABEL_FONT_SIZE,
  COMPACT_QUICK_LINK_TILE_CLASS,
} from "../QuickLink/QuickLink";
import {
  Presentation as PresentationType,
  QuickLinkType,
  TimerInfo,
} from "../../types";
import { EyeOff, MonitorX, MonitorUp } from "lucide-react";
import { useDispatch } from "../../hooks";
import { clearOutput } from "../../store/presentationSlice";
import Button from "../Button/Button";
import cn from "classnames";
import { CLEAR_ACTION_ICON_COLOR } from "../../constants";
import PopoverPanel from "../PopOver/PopoverPanel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/Popover";

const QUICK_LINK_OVERFLOW_BUTTON_CLASS =
  "h-full min-h-12 w-full items-center justify-center text-xs";
const PREVIEW_DEEP_SUSPEND_DELAY_MS = 30_000;

type PresentationPreviewProps = {
  name: string;
  /** Display this tile controls; clear and quick links act on it alone. */
  outputId: string;
  info: PresentationType;
  prevInfo: PresentationType;
  isTransmitting: boolean;
  toggleIsTransmitting: () => void;
  quickLinks: QuickLinkType[];
  /** When true, preview uses full row width; quick links are not rendered here. */
  hideQuickLinks?: boolean;
  /** When true, the title bar is removed entirely. */
  hideHeader?: boolean;
  /** When true, header shows title only (clear + transmit live in TransmitHandler). */
  minimalHeader?: boolean;
  showBorder?: boolean;
  isMobile?: boolean;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
  timers: TimerInfo[];
  showClockTimer?: boolean;
  /** Stream only: when true, item content is faded out (overlay only). */
  streamItemContentBlocked?: boolean;
  /** Show confirmed operator-only manual Hide Content state on stream previews. */
  showContentHiddenIndicator?: boolean;
  /** The last known hidden state is being retained without a fresh connection. */
  contentHiddenUnconfirmed?: boolean;
  contentHiddenUnconfirmedLabel?: "Offline" | "Syncing";
  /** Multiplier for DisplayWindow width (vw). Default 1; use 2 for double-size previews. */
  previewScale?: number;
  /**
   * Fill the parent width with a true 16:9 stage (like ItemSlides / SlideEditor).
   * Prefer this over a large previewScale when the preview must use the full column.
   */
  fillWidth?: boolean;
  /** Center a fixed-size preview within its full-width stage and cap it to that stage. */
  centerPreview?: boolean;
  /** Replaces the live DisplayWindow preview (keeps the card header/controls). Used
   * by the monitor preview to show the discussion board while it's on the monitor. */
  previewOverride?: ReactNode;
  /**
   * Content pinned inside this display's card (e.g. mirror controls), so it is
   * visually tied to the screen it affects rather than floating below the tile.
   */
  footer?: ReactNode;
  /**
   * When false, keep DisplayWindow and its file-video elements mounted, pause
   * them at their current position, and suppress animation/local capture while
   * a parent panel stays CSS-hidden.
   */
  isVisible?: boolean;
  /** Immediately suspend preview-only media under external resource pressure. */
  suspendPreviewMedia?: boolean;
};

/** Transmit-handler preview card. For fullscreen /projector and /monitor routes see FullscreenPresentation. */
const PresentationPreview = ({
  name,
  outputId,
  prevInfo,
  info,
  isTransmitting,
  toggleIsTransmitting,
  quickLinks,
  hideQuickLinks = false,
  hideHeader = false,
  minimalHeader = false,
  showBorder = true,
  isMobile,
  timerInfo,
  prevTimerInfo,
  timers,
  showClockTimer = false,
  streamItemContentBlocked = false,
  showContentHiddenIndicator = false,
  contentHiddenUnconfirmed = false,
  contentHiddenUnconfirmedLabel = "Offline",
  previewScale = 1,
  fillWidth = false,
  centerPreview = false,
  previewOverride,
  footer,
  isVisible = true,
  suspendPreviewMedia = false,
}: PresentationPreviewProps) => {
  const contentHiddenDescriptionId = useId();
  const dispatch = useDispatch();
  const previewWidthVw = (isMobile ? 32 : 14) * previewScale;
  const headerRef = useRef<HTMLHeadingElement | null>(null);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const clearIconMeasureRef = useRef<HTMLDivElement | null>(null);
  const labeledClearMeasureRef = useRef<HTMLDivElement | null>(null);
  const iconToggleMeasureRef = useRef<HTMLDivElement | null>(null);
  const labeledToggleMeasureRef = useRef<HTMLDivElement | null>(null);
  const [shouldShowClearLabel, setShouldShowClearLabel] = useState(true);
  const [shouldShowTransmitLabel, setShouldShowTransmitLabel] = useState(true);
  const quickLinkRailRef = useRef<HTMLUListElement | null>(null);
  const quickLinkMeasureRef = useRef<HTMLLIElement | null>(null);
  const quickLinkOverflowMeasureRef = useRef<HTMLButtonElement | null>(null);
  const previewColumnRef = useRef<HTMLDivElement | null>(null);
  const [visibleQuickLinkCount, setVisibleQuickLinkCount] = useState(1);
  const [previewColumnHeight, setPreviewColumnHeight] = useState<number | null>(
    null,
  );
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [rendererIsVisible, setRendererIsVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const [isDeepSuspended, setIsDeepSuspended] = useState(false);

  useEffect(() => {
    const updateRendererVisibility = () => {
      setRendererIsVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", updateRendererVisibility);
    updateRendererVisibility();
    return () =>
      document.removeEventListener("visibilitychange", updateRendererVisibility);
  }, []);

  useEffect(() => {
    if (!rendererIsVisible) {
      // A hidden Electron renderer means the controller was minimized or
      // covered at the app level; release preview decoders immediately.
      setIsDeepSuspended(true);
      return;
    }

    if (isVisible) {
      setIsDeepSuspended(false);
      return;
    }

    // CSS-hidden tabs keep their current video element warm for quick returns.
    setIsDeepSuspended(false);
    const timeout = window.setTimeout(
      () => setIsDeepSuspended(true),
      PREVIEW_DEEP_SUSPEND_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [isVisible, rendererIsVisible]);

  const previewDeepSuspended = isDeepSuspended || suspendPreviewMedia;
  const previewIsVisible =
    isVisible && rendererIsVisible && !previewDeepSuspended;

  // This display only. The per-surface clears iterate every slot of a type, so
  // clearing Lobby would blank Main alongside it.
  const handleClear = () => {
    dispatch(clearOutput(outputId));
  };

  const filteredQuickLinks = quickLinks.filter(
    (link) => link.action !== "clear",
  );

  useEffect(() => {
    if (hideQuickLinks || filteredQuickLinks.length === 0) return;

    const updateVisibleQuickLinkCount = () => {
      const rail = quickLinkRailRef.current;
      const tileMeasurement = quickLinkMeasureRef.current;
      const overflowMeasurement = quickLinkOverflowMeasureRef.current;
      if (
        !rail ||
        !tileMeasurement ||
        !overflowMeasurement ||
        previewColumnHeight == null
      ) {
        setVisibleQuickLinkCount((current) => (current === 1 ? current : 1));
        return;
      }
      const railStyle = window.getComputedStyle(rail);
      const quickLinkGap = parseFloat(railStyle.rowGap) || 0;
      const verticalPadding =
        (parseFloat(railStyle.paddingTop) || 0) +
        (parseFloat(railStyle.paddingBottom) || 0);
      const availableHeight = Math.max(0, previewColumnHeight - verticalPadding);
      const tileHeight = tileMeasurement.getBoundingClientRect().height;
      const overflowButtonHeight =
        overflowMeasurement.getBoundingClientRect().height;
      if (tileHeight <= 0 || overflowButtonHeight <= 0) {
        setVisibleQuickLinkCount((current) => (current === 1 ? current : 1));
        return;
      }
      const linkCount = filteredQuickLinks.length;
      const allLinksHeight =
        linkCount * tileHeight +
        Math.max(0, linkCount - 1) * quickLinkGap;
      let nextVisibleCount = linkCount;

      if (allLinksHeight > availableHeight) {
        const availableForLinks =
          availableHeight - overflowButtonHeight - quickLinkGap;
        nextVisibleCount = Math.max(
          1,
          Math.floor(
            (availableForLinks + quickLinkGap) / (tileHeight + quickLinkGap),
          ),
        );
      }

      nextVisibleCount = Math.min(linkCount, nextVisibleCount);
      setVisibleQuickLinkCount((current) =>
        current === nextVisibleCount ? current : nextVisibleCount,
      );
    };

    if (typeof ResizeObserver === "undefined") {
      updateVisibleQuickLinkCount();
      return;
    }

    const observer = new ResizeObserver(updateVisibleQuickLinkCount);
    if (quickLinkMeasureRef.current) {
      observer.observe(quickLinkMeasureRef.current);
    }
    if (quickLinkOverflowMeasureRef.current) {
      observer.observe(quickLinkOverflowMeasureRef.current);
    }
    updateVisibleQuickLinkCount();
    return () => observer.disconnect();
  }, [filteredQuickLinks.length, hideQuickLinks, previewColumnHeight]);

  useEffect(() => {
    if (hideQuickLinks) return;

    const updatePreviewColumnHeight = () => {
      const height = previewColumnRef.current?.clientHeight ?? 0;
      const nextHeight = height > 0 ? height : null;
      setPreviewColumnHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
    };

    if (typeof ResizeObserver === "undefined") {
      updatePreviewColumnHeight();
      return;
    }

    const observer = new ResizeObserver(updatePreviewColumnHeight);
    if (previewColumnRef.current) observer.observe(previewColumnRef.current);
    updatePreviewColumnHeight();
    return () => observer.disconnect();
  }, [hideQuickLinks, name, previewScale]);

  const hasOverflow = filteredQuickLinks.length > visibleQuickLinkCount;
  const visibleQuickLinks = filteredQuickLinks.slice(0, visibleQuickLinkCount);
  const overflowQuickLinks = hasOverflow
    ? filteredQuickLinks.slice(visibleQuickLinks.length)
    : [];

  useEffect(() => {
    if (!isVisible || hideHeader || minimalHeader) return;

    const updateHeaderLabelVisibility = () => {
      const headerWidth = headerRef.current?.clientWidth ?? 0;
      const titleWidth = titleRef.current?.scrollWidth ?? 0;
      const clearIconWidth =
        clearIconMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const labeledClearWidth =
        labeledClearMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const iconToggleWidth =
        iconToggleMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const labeledToggleWidth =
        labeledToggleMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const spacingAllowance = 32;
      const requiredWidthForBoth =
        titleWidth + labeledClearWidth + labeledToggleWidth + spacingAllowance;
      const requiredWidthForClearOnly =
        titleWidth + labeledClearWidth + iconToggleWidth + spacingAllowance;
      const requiredWidthForTransmitOnly =
        titleWidth + clearIconWidth + labeledToggleWidth + spacingAllowance;

      let nextShouldShowClearLabel = false;
      let nextShouldShowTransmitLabel = false;

      if (headerWidth >= requiredWidthForBoth) {
        nextShouldShowClearLabel = true;
        nextShouldShowTransmitLabel = true;
      } else if (headerWidth >= requiredWidthForClearOnly) {
        nextShouldShowClearLabel = true;
      } else if (headerWidth >= requiredWidthForTransmitOnly) {
        nextShouldShowTransmitLabel = true;
      }

      setShouldShowClearLabel((current) =>
        current === nextShouldShowClearLabel
          ? current
          : nextShouldShowClearLabel,
      );
      setShouldShowTransmitLabel((current) =>
        current === nextShouldShowTransmitLabel
          ? current
          : nextShouldShowTransmitLabel,
      );
    };

    if (typeof ResizeObserver === "undefined") {
      updateHeaderLabelVisibility();
      return;
    }

    const observer = new ResizeObserver(() => {
      updateHeaderLabelVisibility();
    });

    if (headerRef.current) {
      observer.observe(headerRef.current);
    }

    updateHeaderLabelVisibility();

    return () => observer.disconnect();
  }, [hideHeader, isVisible, minimalHeader, name]);

  const displayWindowProps = {
    boxes: info.slide?.boxes || [],
    prevBoxes: prevInfo.slide?.boxes || [],
    nextBoxes: info.nextSlide?.boxes ?? [],
    prevNextBoxes: prevInfo.nextSlide?.boxes ?? [],
    bibleInfoBox: info.bibleInfoBox,
    ...(fillWidth || (!hideQuickLinks && !centerPreview)
      ? {}
      : { width: previewWidthVw }),
    ...(centerPreview ? { className: "max-w-full" } : {}),
    showBorder,
    // Without this the preview resolves the built-in output's settings, so a
    // second projector would render the first one's clock, timer, and background.
    outputId,
    currentItemId: info.itemId,
    displayType: info.displayType,
    participantOverlayInfo: info.participantOverlayInfo,
    prevParticipantOverlayInfo: prevInfo.participantOverlayInfo,
    stbOverlayInfo: info.stbOverlayInfo,
    prevStbOverlayInfo: prevInfo.stbOverlayInfo,
    qrCodeOverlayInfo: info.qrCodeOverlayInfo,
    prevQrCodeOverlayInfo: prevInfo.qrCodeOverlayInfo,
    imageOverlayInfo: info.imageOverlayInfo,
    prevImageOverlayInfo: prevInfo.imageOverlayInfo,
    prevBibleDisplayInfo: prevInfo.bibleDisplayInfo,
    bibleDisplayInfo: info.bibleDisplayInfo,
    formattedTextDisplayInfo: info.formattedTextDisplayInfo,
    prevFormattedTextDisplayInfo: prevInfo.formattedTextDisplayInfo,
    boardPostStreamInfo: info.boardPostStreamInfo,
    prevBoardPostStreamInfo: prevInfo.boardPostStreamInfo,
    timerInfo,
    prevTimerInfo,
    time: info.time,
    prevTime: prevInfo.time,
    shouldAnimate: previewIsVisible,
    // Keep video mounted and paused during the short CSS-hidden grace period.
    // Long-hidden previews unmount it so Chromium can release decoder work.
    shouldPlayVideo: !previewDeepSuspended,
    suspendVideoPlayback: !previewIsVisible,
    videoPreloadRole: "preview",
    showClockTimer,
    // Only the transmit-handler monitor preview uses the full monitor chrome.
    monitorLayoutMode:
      info.displayType === "monitor" ? "full-monitor" : "content-only",
    transitionDirection: info.transitionDirection,
    streamItemContentBlocked:
      info.displayType === "stream" ? streamItemContentBlocked : undefined,
    localVideoInput: info.localVideoInput,
    prevLocalVideoInput: prevInfo.localVideoInput,
    videoPlayback: info.videoPlayback,
    // Same-machine booth tiles must show live local video, not still previews,
    // so operators can trust what the audience sees.
    canCaptureLocalVideo: previewIsVisible,
    directLocalVideoCapture: previewIsVisible,
    playLocalVideoAudio: false,
  } as const;

  return (
    <div className="flex flex-col gap-2">
      <section className="relative overflow-hidden rounded-sm border border-white/12 bg-black/30">
        <div
          className={cn(
            "flex items-start gap-2",
            hideQuickLinks ? "flex-col w-full" : "flex-row",
          )}
        >
          <div
            ref={previewColumnRef}
            data-measure="presentation-preview-column"
            className={cn(
              "@container/preview flex flex-col self-start",
              (hideQuickLinks || fillWidth) && "w-full min-w-0",
              fillWidth && "items-stretch",
              hideQuickLinks && !fillWidth && "items-center",
              // Match DisplayWindow width so the header never exceeds the preview (w-fit used the
              // header’s intrinsic width and could overflow past the aspect-video box below).
              !hideQuickLinks && !fillWidth && "min-w-0 flex-1",
            )}
            style={
              fillWidth
                ? { width: "100%" }
                : !hideQuickLinks
                  ? { maxWidth: "100%" }
                  : undefined
            }
          >
            {!hideHeader && (
              <h2
                ref={headerRef}
                data-measure="presentation-header"
                className={cn(
                  "border-b border-white/10 bg-black/25 text-center text-xs font-semibold px-2 py-1",
                  minimalHeader
                    ? "flex items-center justify-center"
                    : "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2",
                )}
              >
                <span
                  ref={titleRef}
                  data-measure="presentation-title"
                  className={cn(
                    "truncate min-w-0 text-left",
                    minimalHeader && "w-full text-center",
                  )}
                >
                  {name}
                </span>
                {!minimalHeader && (
                  <>
                    <Button
                      data-measure="presentation-clear-button"
                      svg={MonitorX}
                      color={CLEAR_ACTION_ICON_COLOR}
                      onClick={handleClear}
                      iconSize="md"
                      className="justify-self-center text-xs"
                    >
                      {shouldShowClearLabel ? "Clear" : undefined}
                    </Button>
                    <div className="flex items-center justify-self-end shrink-0">
                      <Toggle
                        label={shouldShowTransmitLabel ? "Live" : undefined}
                        labelClassName="text-xs"
                        icon={MonitorUp}
                        value={isTransmitting}
                        onChange={toggleIsTransmitting}
                        color="#22c55e"
                      />
                    </div>
                  </>
                )}
              </h2>
            )}
            {!hideHeader && !minimalHeader && (
              <>
                <div
                  ref={clearIconMeasureRef}
                  data-measure="presentation-clear-icon-width"
                  className="pointer-events-none absolute invisible whitespace-nowrap"
                  aria-hidden="true"
                >
                  <Button
                    svg={MonitorX}
                    iconSize="md"
                    color={CLEAR_ACTION_ICON_COLOR}
                    className="text-xs"
                  />
                </div>
                <div
                  ref={labeledClearMeasureRef}
                  data-measure="presentation-clear-label-width"
                  className="pointer-events-none absolute invisible whitespace-nowrap"
                  aria-hidden="true"
                >
                  <Button
                    svg={MonitorX}
                    iconSize="md"
                    color={CLEAR_ACTION_ICON_COLOR}
                    className="text-xs"
                  >
                    Clear
                  </Button>
                </div>
                <div
                  ref={iconToggleMeasureRef}
                  data-measure="presentation-toggle-icon-width"
                  className="pointer-events-none absolute invisible whitespace-nowrap"
                  aria-hidden="true"
                >
                  <Toggle
                    icon={MonitorUp}
                    value={isTransmitting}
                    onChange={() => undefined}
                    color="#22c55e"
                  />
                </div>
                <div
                  ref={labeledToggleMeasureRef}
                  data-measure="presentation-toggle-label-width"
                  className="pointer-events-none absolute invisible whitespace-nowrap"
                  aria-hidden="true"
                >
                  <Toggle
                    label="Live"
                    labelClassName="text-xs"
                    icon={MonitorUp}
                    value={isTransmitting}
                    onChange={() => undefined}
                    color="#22c55e"
                  />
                </div>
              </>
            )}
            <div
              className={cn(
                "relative isolate @container/preview",
                centerPreview && "flex w-full min-w-0 justify-center",
                info.displayType === "stream" && "bg-gray-500/35",
              )}
              data-testid="content-hidden-preview-stage"
            >
              {info.displayType === "stream" &&
                streamItemContentBlocked &&
                showContentHiddenIndicator && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Content hidden on ${name}`}
                        aria-describedby={contentHiddenDescriptionId}
                        data-testid="content-hidden-preview-badge"
                        className={cn(
                          "absolute right-1 top-1 z-10 inline-flex items-center rounded p-1.5 text-amber-100 shadow-sm ring-1 transition-colors hover:bg-amber-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200",
                          contentHiddenUnconfirmed
                            ? "border border-dashed border-amber-300/60 bg-amber-950/75 ring-transparent"
                            : "bg-amber-950/95 ring-amber-300/40",
                        )}
                      >
                        <EyeOff aria-hidden="true" className="h-3 w-3 shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      data-testid="content-hidden-preview-popover"
                      side="bottom"
                      align="end"
                      sideOffset={4}
                      className="w-auto border-0 bg-gray-800 px-3 py-2 text-xs font-semibold text-amber-100 shadow-md"
                    >
                      Content hidden
                      <span id={contentHiddenDescriptionId} className="sr-only">
                        {contentHiddenUnconfirmed
                          ? `Last known hidden state for ${name}; the remote stream state is unconfirmed while ${contentHiddenUnconfirmedLabel.toLowerCase()}.`
                          : `Confirmed active Hide Content state for ${name}.`}
                      </span>
                    </PopoverContent>
                  </Popover>
                )}
              {/* Keep the DisplayWindow mounted so its current slide and
                  controls stay current while preview-only media is suspended. */}
              {previewOverride ?? <DisplayWindow {...displayWindowProps} />}
            </div>
          </div>
          {!hideQuickLinks && filteredQuickLinks.length > 0 && (
            <ul
              ref={quickLinkRailRef}
              data-testid={`quick-link-rail-${outputId}`}
              className="relative grid min-h-0 w-[clamp(4.5rem,5vw,14rem)] shrink-0 grid-cols-1 content-start gap-1 overflow-hidden py-1 pr-1"
              style={
                previewColumnHeight != null
                  ? { height: `${previewColumnHeight}px` }
                  : undefined
              }
            >
              <li
                ref={quickLinkMeasureRef}
                aria-hidden="true"
                data-measure="quick-link-tile"
                className={cn(
                  COMPACT_QUICK_LINK_TILE_CLASS,
                  "pointer-events-none invisible absolute left-0 right-1 top-0 gap-1",
                )}
              >
                <div className="aspect-video w-full border border-gray-500" />
                <p
                  className={COMPACT_QUICK_LINK_LABEL_CLASS}
                  style={{ fontSize: COMPACT_QUICK_LINK_LABEL_FONT_SIZE }}
                >
                  Quick Link
                  <br />
                  Quick Link
                </p>
              </li>
              <li
                aria-hidden="true"
                className="pointer-events-none invisible absolute left-0 right-1 top-0"
              >
                <Button
                  ref={quickLinkOverflowMeasureRef}
                  data-measure="quick-link-overflow-button"
                  tabIndex={-1}
                  variant="tertiary"
                  padding="p-1"
                  className={QUICK_LINK_OVERFLOW_BUTTON_CLASS}
                >
                  +N
                </Button>
              </li>
              {visibleQuickLinks.map((link) => (
                <QuickLink
                  timers={timers}
                  displayType={info.displayType}
                  outputId={outputId}
                  isMobile={isMobile}
                  compact
                  {...link}
                  key={link.id}
                />
              ))}
              {overflowQuickLinks.length > 0 && (
                <PopoverPanel
                  TriggeringButton={
                    <Button
                      type="button"
                      variant="tertiary"
                      padding="p-1"
                      className={QUICK_LINK_OVERFLOW_BUTTON_CLASS}
                      aria-label={`Show ${overflowQuickLinks.length} more Quick Links`}
                    >
                      +{overflowQuickLinks.length}
                    </Button>
                  }
                  open={isOverflowOpen}
                  onOpenChange={setIsOverflowOpen}
                  contentClassName="w-[clamp(4.5rem,7vw,14rem)] max-h-[min(70vh,32rem)] max-w-[85vw]"
                  bodyClassName="max-h-[min(60vh,28rem)] overflow-y-auto"
                >
                  <ul className="grid grid-cols-1 gap-1">
                    {overflowQuickLinks.map((link) => (
                      <QuickLink
                        timers={timers}
                        displayType={info.displayType}
                        outputId={outputId}
                        isMobile={isMobile}
                        compact
                        {...link}
                        onAction={() => setIsOverflowOpen(false)}
                        key={link.id}
                      />
                    ))}
                  </ul>
                </PopoverPanel>
              )}
            </ul>
          )}
        </div>
        {footer != null ? (
          <div className="empty:hidden border-t border-white/10 px-2 py-1.5">
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
};

export default PresentationPreview;
