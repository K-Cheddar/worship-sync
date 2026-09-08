import { ReactNode, useEffect, useRef, useState } from "react";
import DisplayWindow from "../DisplayWindow/DisplayWindow";
import Toggle from "../Toggle/Toggle";
import QuickLink from "../QuickLink/QuickLink";
import {
  Presentation as PresentationType,
  QuickLinkType,
  TimerInfo,
} from "../../types";
import { MonitorX, MonitorUp } from "lucide-react";
import { useDispatch } from "../../hooks";
import { clearOutput } from "../../store/presentationSlice";
import Button from "../Button/Button";
import cn from "classnames";
import { CLEAR_ACTION_ICON_COLOR } from "../../constants";

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
  /** Multiplier for DisplayWindow width (vw). Default 1; use 2 for double-size previews. */
  previewScale?: number;
  /**
   * Fill the parent width with a true 16:9 stage (like ItemSlides / SlideEditor).
   * Prefer this over a large previewScale when the preview must use the full column.
   */
  fillWidth?: boolean;
  /** Replaces the live DisplayWindow preview (keeps the card header/controls). Used
   * by the monitor preview to show the discussion board while it's on the monitor. */
  previewOverride?: ReactNode;
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
  previewScale = 1,
  fillWidth = false,
  previewOverride,
}: PresentationPreviewProps) => {
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

  // This display only. The per-surface clears iterate every slot of a type, so
  // clearing Lobby would blank Main alongside it.
  const handleClear = () => {
    dispatch(clearOutput(outputId));
  };

  const filteredQuickLinks = quickLinks.filter(
    (link) => link.action !== "clear",
  );

  useEffect(() => {
    if (hideHeader || minimalHeader) return;

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

      if (headerWidth >= requiredWidthForBoth) {
        setShouldShowClearLabel(true);
        setShouldShowTransmitLabel(true);
        return;
      }

      if (headerWidth >= requiredWidthForClearOnly) {
        setShouldShowClearLabel(true);
        setShouldShowTransmitLabel(false);
        return;
      }

      if (headerWidth >= requiredWidthForTransmitOnly) {
        setShouldShowClearLabel(false);
        setShouldShowTransmitLabel(true);
        return;
      }

      setShouldShowClearLabel(false);
      setShouldShowTransmitLabel(false);
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
  }, [hideHeader, minimalHeader, name]);

  const displayWindowProps = {
    boxes: info.slide?.boxes || [],
    prevBoxes: prevInfo.slide?.boxes || [],
    nextBoxes: info.nextSlide?.boxes ?? [],
    prevNextBoxes: prevInfo.nextSlide?.boxes ?? [],
    bibleInfoBox: info.bibleInfoBox,
    ...(fillWidth ? {} : { width: previewWidthVw }),
    showBorder,
    // Without this the preview resolves the built-in output's settings, so a
    // second projector would render the first one's clock, timer, and background.
    outputId,
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
    shouldAnimate: true,
    shouldPlayVideo: true,
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
  } as const;

  return (
    <div className="flex flex-col gap-2">
      <section className="relative overflow-hidden rounded-sm border border-white/12 bg-black/30">
        <div
          className={cn(
            "flex gap-2",
            hideQuickLinks ? "flex-col w-full" : "flex-row",
          )}
        >
          <div
            className={cn(
              "flex flex-col",
              (hideQuickLinks || fillWidth) && "w-full min-w-0",
              fillWidth && "items-stretch",
              hideQuickLinks && !fillWidth && "items-center",
              // Match DisplayWindow width so the header never exceeds the preview (w-fit used the
              // header’s intrinsic width and could overflow past the aspect-video box below).
              !hideQuickLinks && !fillWidth && "shrink-0 min-w-0",
            )}
            style={
              fillWidth
                ? { width: "100%" }
                : !hideQuickLinks
                  ? { width: `${previewWidthVw}vw`, maxWidth: "100%" }
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
              className={cn(info.displayType === "stream" && "bg-gray-500/35")}
            >
              {previewOverride ?? <DisplayWindow {...displayWindowProps} />}
            </div>
          </div>
          {!hideQuickLinks && filteredQuickLinks.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 py-2 w-full pr-2">
              {filteredQuickLinks.map((link) => (
                <QuickLink
                  timers={timers}
                  displayType={info.displayType}
                  outputId={outputId}
                  isMobile={isMobile}
                  {...link}
                  key={link.id}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default PresentationPreview;
