import type { AnimationEvent, CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ServiceTime } from "../../types";
import { cn } from "@/utils/cnHelper";
import {
  serviceTimeOverlayContentClassName,
  serviceTimeOverlayContentGapClassName,
  serviceTimeOverlayStreamInfoPaddingClassName,
  serviceTimePreviewFramePaddingStyle,
} from "./serviceTimeStreamOverlayStyles";

export type ServiceTimeCountdownFontSpec =
  | "streamFullscreen"
  /** Same ratios as `streamFullscreen`, but `cqw` so embedded previews scale with their box. */
  | "previewFrame"
  /**
   * Service Times “Next service” inline block: same cqw ratios as `previewFrame`, but
   * `clamp()` floors keep copy legible when the panel is narrow.
   */
  | "nextServicePanel";

type PaddingSpec =
  | "streamInfo"
  /** Matches stream-info padding ratios using `cqw` (requires a `container-type` ancestor). */
  | "previewFrame"
  /** Inline next-service card: padding scales with container but does not collapse on narrow widths. */
  | "nextServicePanel";

const paddingClassName = (spec: PaddingSpec) => {
  switch (spec) {
    case "streamInfo":
      return serviceTimeOverlayStreamInfoPaddingClassName;
    case "previewFrame":
    case "nextServicePanel":
      return "";
  }
};

type FontSizeUnit = "vw" | "cqw" | "cqwClamp";

const getFontSizes = (
  fontSpec: ServiceTimeCountdownFontSpec,
  nameSize: number,
  timeSize: number,
): { nameFontSize: number; timeFontSize: number; unit: FontSizeUnit } => {
  if (fontSpec === "streamFullscreen") {
    return {
      nameFontSize: nameSize / 10,
      timeFontSize: timeSize / 10,
      unit: "vw",
    };
  }
  if (fontSpec === "nextServicePanel") {
    return {
      nameFontSize: nameSize / 10,
      timeFontSize: timeSize / 10,
      unit: "cqwClamp",
    };
  }
  return {
    nameFontSize: nameSize / 10,
    timeFontSize: timeSize / 10,
    unit: "cqw",
  };
};

/** Lower bound of the name line `clamp()` in `nextServicePanel` (rem). */
const NEXT_SERVICE_NAME_CLAMP_MIN_REM = 0.8125;

const clampedNameFontSize = (nameCqw: number) =>
  `clamp(${NEXT_SERVICE_NAME_CLAMP_MIN_REM}rem, ${nameCqw}cqw, 1.375rem)`;

/**
 * Stream-info keeps the same cqw *ratio* as name/time sliders. On narrow panels the name hits
 * its clamp floor first; a flat time floor (previously 1.125rem) made the digits look nearly as
 * large as “… begins in”. Scale the time floor from the name floor × (timeCqw / nameCqw).
 */
const clampedNextServiceTimeFontSize = (nameCqw: number, timeCqw: number) => {
  const minRem =
    NEXT_SERVICE_NAME_CLAMP_MIN_REM *
    (timeCqw / Math.max(nameCqw, 0.01));
  return `clamp(${minRem}rem, ${timeCqw}cqw, 4rem)`;
};

export type ServiceTimeCountdownTimeDisplay =
  | "default"
  /** When `timeText` is `0` (countdown just ended), fade to animated white ellipses instead of the digit. */
  | "livePulseAtZero";

export type ServiceTimeCountdownFaceProps = {
  service: Pick<ServiceTime, "name" | "color" | "background"> &
  Partial<Pick<ServiceTime, "nameFontSize" | "timeFontSize" | "shouldShowName">>;
  timeText: string;
  timeDisplay?: ServiceTimeCountdownTimeDisplay;
  /** `/stream-info`: `streamFullscreen` (vw). Previews: `previewFrame`. Next-service row: `nextServicePanel`. */
  fontSpec: ServiceTimeCountdownFontSpec;
  /** `streamInfo`: vw padding. `previewFrame` / `nextServicePanel`: container-relative padding. */
  paddingSpec: PaddingSpec;
  /** Extra vertical gap between name line and timer (off for `/stream-info` to match legacy). */
  includeNameTimeGap?: boolean;
  extraSurfaceStyle?: CSSProperties;
  nameClassName?: string;
  timeClassName?: string;
};

/** `/stream-info` fullscreen overlay (viewport-based units). */
export const serviceTimeStreamInfoFaceLayoutProps: Pick<
  ServiceTimeCountdownFaceProps,
  | "fontSpec"
  | "paddingSpec"
  | "includeNameTimeGap"
  | "nameClassName"
  | "timeClassName"
> = {
  fontSpec: "streamFullscreen",
  paddingSpec: "streamInfo",
  includeNameTimeGap: false,
  nameClassName: "leading-none whitespace-nowrap",
  timeClassName: "leading-none tabular-nums",
};

/** Service Times aspect preview: same layout as stream, scaled to the preview container. */
export const serviceTimeEditPreviewFaceLayoutProps: Pick<
  ServiceTimeCountdownFaceProps,
  | "fontSpec"
  | "paddingSpec"
  | "includeNameTimeGap"
  | "nameClassName"
  | "timeClassName"
> = {
  fontSpec: "previewFrame",
  paddingSpec: "previewFrame",
  includeNameTimeGap: false,
  nameClassName: "leading-none whitespace-nowrap",
  timeClassName: "leading-none tabular-nums",
};

/** Next service live pill in Service Times list (narrow panel–safe type scale). */
export const serviceTimeNextServicePanelFaceLayoutProps: Pick<
  ServiceTimeCountdownFaceProps,
  | "fontSpec"
  | "paddingSpec"
  | "includeNameTimeGap"
  | "nameClassName"
  | "timeClassName"
> = {
  fontSpec: "nextServicePanel",
  paddingSpec: "nextServicePanel",
  includeNameTimeGap: false,
  nameClassName: "leading-none whitespace-nowrap",
  timeClassName: "leading-none tabular-nums",
};

/**
 * Shared “pill” for next-service countdown: `/stream-info`, Service Times edit preview, and
 * “Next service” live block. Callers own outer layout (fullscreen fixed, aspect frame, panel).
 */
const ServiceTimeCountdownFace = ({
  service,
  timeText,
  timeDisplay = "default",
  fontSpec,
  paddingSpec,
  includeNameTimeGap = true,
  extraSurfaceStyle,
  nameClassName = "leading-none",
  timeClassName = "leading-none tabular-nums tracking-tight transition-width",
}: ServiceTimeCountdownFaceProps) => {
  const nameSize = service.nameFontSize ?? 12;
  const timeSize = service.timeFontSize ?? 35;
  const { nameFontSize, timeFontSize, unit: fontUnit } = getFontSizes(
    fontSpec,
    nameSize,
    timeSize,
  );

  const containerPaddingStyle: CSSProperties | undefined = (() => {
    if (paddingSpec === "previewFrame") {
      return { ...serviceTimePreviewFramePaddingStyle };
    }
    if (paddingSpec === "nextServicePanel") {
      return {
        padding: "clamp(8px, 0.55cqw, 12px) clamp(10px, 1cqw, 20px)",
      };
    }
    return undefined;
  })();
  const shouldShowName = service.shouldShowName !== false;
  const showLivePulse =
    timeDisplay === "livePulseAtZero" && timeText === "0";
  /** Stream-info + Next service: centered time, min width ≈ four tabular digits (5ch — `ch` runs slightly narrow vs tabular glyphs). */
  const streamStyleTimeRow =
    paddingSpec === "streamInfo" || paddingSpec === "nextServicePanel";

  const [zeroToLivePhase, setZeroToLivePhase] = useState<
    "idle" | "fading_zero" | "showing_live"
  >("idle");
  const prevTimeTextRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const eligible =
      timeDisplay === "livePulseAtZero" && timeText === "0";
    const wasZero = prevTimeTextRef.current === "0";
    prevTimeTextRef.current = timeText;

    if (!eligible) {
      setZeroToLivePhase("idle");
      return;
    }

    if (!wasZero) {
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setZeroToLivePhase(reduceMotion ? "showing_live" : "fading_zero");
    }
  }, [timeText, timeDisplay]);

  const handleDigitFadeOutEnd = (e: AnimationEvent<HTMLSpanElement>) => {
    if (!e.animationName.includes("fade-out-zero")) return;
    setZeroToLivePhase("showing_live");
  };

  return (
    <div
      className={`${serviceTimeOverlayContentClassName}${includeNameTimeGap ? ` ${serviceTimeOverlayContentGapClassName}` : ""
        } ${paddingClassName(paddingSpec)}`}
      style={{
        color: service.color || undefined,
        backgroundColor: service.background || undefined,
        ...containerPaddingStyle,
        ...extraSurfaceStyle,
      }}
    >
      {shouldShowName && (
        <div
          className={nameClassName}
          style={{
            fontSize:
              fontUnit === "cqwClamp"
                ? clampedNameFontSize(nameFontSize)
                : `${nameFontSize}${fontUnit}`,
          }}
        >
          {service.name} begins in
        </div>
      )}
      <div
        className={cn(
          timeClassName,
          showLivePulse && "flex min-h-[1em] items-center justify-center",
          streamStyleTimeRow &&
          "min-w-[5ch] shrink-0 self-center text-center",
          streamStyleTimeRow && !showLivePulse && "w-max max-w-full",
        )}
        style={{
          fontSize:
            fontUnit === "cqwClamp"
              ? clampedNextServiceTimeFontSize(nameFontSize, timeFontSize)
              : `${timeFontSize}${fontUnit}`,
        }}
      >
        {showLivePulse && zeroToLivePhase !== "showing_live" ? (
          <span
            className={cn(
              "tabular-nums",
              zeroToLivePhase === "fading_zero" &&
              "animate-service-time-fade-out-zero motion-reduce:animate-none motion-reduce:opacity-0",
            )}
            onAnimationEnd={handleDigitFadeOutEnd}
          >
            0
          </span>
        ) : showLivePulse && zeroToLivePhase === "showing_live" ? (
          <span
            className="inline-flex min-h-[1em] shrink-0 animate-service-time-fade-in-live items-center justify-center gap-[0.14em] motion-reduce:animate-none motion-reduce:opacity-100"
            aria-label="Service is starting"
          >
            <span
              className="inline-block h-[0.22em] w-[0.52em] shrink-0 rounded-full bg-white shadow-[0_0_0.08em_rgba(255,255,255,0.35)] animate-service-time-ellipsis-1 motion-reduce:animate-none motion-reduce:opacity-90"
              aria-hidden
            />
            <span
              className="inline-block h-[0.22em] w-[0.52em] shrink-0 rounded-full bg-white shadow-[0_0_0.08em_rgba(255,255,255,0.35)] animate-service-time-ellipsis-2 motion-reduce:animate-none motion-reduce:opacity-90"
              aria-hidden
            />
            <span
              className="inline-block h-[0.22em] w-[0.52em] shrink-0 rounded-full bg-white shadow-[0_0_0.08em_rgba(255,255,255,0.35)] animate-service-time-ellipsis-3 motion-reduce:animate-none motion-reduce:opacity-90"
              aria-hidden
            />
          </span>
        ) : (
          timeText
        )}
      </div>
    </div>
  );
};

export default ServiceTimeCountdownFace;
