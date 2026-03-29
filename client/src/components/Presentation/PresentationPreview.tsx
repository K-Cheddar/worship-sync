import { useEffect, useRef, useState } from "react";
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
import {
  clearMonitor,
  clearProjector,
  clearStream,
} from "../../store/presentationSlice";
import Button from "../Button/Button";
import cn from "classnames";

type PresentationPreviewProps = {
  name: string;
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
  showMonitorClockTimer?: boolean;
  /** Stream only: when true, item content is faded out (overlay only). */
  streamItemContentBlocked?: boolean;
  /** Multiplier for DisplayWindow width (vw). Default 1; use 2 for double-size previews. */
  previewScale?: number;
};

/** Transmit-handler preview card. For fullscreen /projector and /monitor routes see FullscreenPresentation. */
const PresentationPreview = ({
  name,
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
  showMonitorClockTimer = false,
  streamItemContentBlocked = false,
  previewScale = 1,
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

  const handleClear = () => {
    if (info.displayType === "projector") {
      dispatch(clearProjector());
    } else if (info.displayType === "monitor") {
      dispatch(clearMonitor());
    } else if (info.displayType === "stream") {
      dispatch(clearStream());
    }
  };

  const filteredQuickLinks = quickLinks.filter((link) => link.action !== "clear");

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
    width: previewWidthVw,
    showBorder,
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
    timerInfo,
    prevTimerInfo,
    time: info.time,
    prevTime: prevInfo.time,
    shouldAnimate: true,
    shouldPlayVideo: true,
    showMonitorClockTimer,
    // Only the transmit-handler monitor preview uses the full monitor chrome.
    monitorLayoutMode:
      info.displayType === "monitor" ? "full-monitor" : "content-only",
    transitionDirection: info.transitionDirection,
    streamItemContentBlocked:
      info.displayType === "stream" ? streamItemContentBlocked : undefined,
  } as const;

  return (
    <div className="flex flex-col gap-2">
      <section className="border border-gray-600 rounded-sm overflow-hidden relative bg-gray-800">
        <div
          className={cn(
            "flex gap-2",
            hideQuickLinks ? "flex-col w-full" : "flex-row"
          )}
        >
          <div
            className={cn(
              "flex flex-col",
              hideQuickLinks && "w-full items-center min-w-0"
            )}
          >
            {!hideHeader && (
              <h2
                ref={headerRef}
                data-measure="presentation-header"
                className={cn(
                  "bg-gray-900 text-center font-semibold text-sm px-2 py-1",
                  minimalHeader
                    ? "flex items-center justify-center"
                    : "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
                )}
              >
                <span
                  ref={titleRef}
                  data-measure="presentation-title"
                  className={cn(
                    "truncate min-w-0 text-left",
                    minimalHeader && "w-full text-center"
                  )}
                >
                  {name}
                </span>
                {!minimalHeader && (
                  <>
                    <Button
                      data-measure="presentation-clear-button"
                      svg={MonitorX}
                      onClick={handleClear}
                      iconSize="md"
                      className="justify-self-center"
                    >
                      {shouldShowClearLabel ? "Clear" : undefined}
                    </Button>
                    <div className="flex items-center justify-self-end shrink-0">
                      <Toggle
                        label={shouldShowTransmitLabel ? "Live" : undefined}
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
                  <Button svg={MonitorX} iconSize="md" />
                </div>
                <div
                  ref={labeledClearMeasureRef}
                  data-measure="presentation-clear-label-width"
                  className="pointer-events-none absolute invisible whitespace-nowrap"
                  aria-hidden="true"
                >
                  <Button svg={MonitorX} iconSize="md">
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
                    icon={MonitorUp}
                    value={isTransmitting}
                    onChange={() => undefined}
                    color="#22c55e"
                  />
                </div>
              </>
            )}
            <DisplayWindow {...displayWindowProps} />
          </div>
          {!hideQuickLinks && filteredQuickLinks.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 py-2 w-full pr-2">
              {filteredQuickLinks.map((link) => (
                <QuickLink
                  timers={timers}
                  displayType={info.displayType}
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
