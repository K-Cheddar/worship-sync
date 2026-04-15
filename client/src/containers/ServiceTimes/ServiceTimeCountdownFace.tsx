import type { AnimationEvent, CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ServiceTime } from "../../types";
import { cn } from "@/utils/cnHelper";
import {
  getServiceTimeOverlayFontSizesVw,
  serviceTimeOverlayContentClassName,
  serviceTimeOverlayContentGapClassName,
  serviceTimeOverlayPanelPaddingClassName,
  serviceTimeOverlayStreamInfoPaddingClassName,
  serviceTimeOverlayViewportFractionalPaddingClassName,
} from "./serviceTimeStreamOverlayStyles";

export type ServiceTimeCountdownFontSpec = "preview" | "streamFullscreen";

type PaddingSpec = "viewportFraction" | "infoPanel" | "streamInfo";

const paddingClassName = (spec: PaddingSpec) => {
  switch (spec) {
    case "infoPanel":
      return serviceTimeOverlayPanelPaddingClassName;
    case "streamInfo":
      return serviceTimeOverlayStreamInfoPaddingClassName;
    case "viewportFraction":
    default:
      return serviceTimeOverlayViewportFractionalPaddingClassName;
  }
};

const getFontSizesVw = (
  fontSpec: ServiceTimeCountdownFontSpec,
  nameSize: number,
  timeSize: number
) => {
  if (fontSpec === "streamFullscreen") {
    return { nameFontSize: nameSize / 10, timeFontSize: timeSize / 10 };
  }
  return getServiceTimeOverlayFontSizesVw(nameSize, timeSize);
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
  /** Edit preview + info controller use `preview`; live `/stream-info` overlay uses `streamFullscreen`. */
  fontSpec: ServiceTimeCountdownFontSpec;
  /** `%` padding inside aspect preview, vw for stream-info, clamped vw for info panel. */
  paddingSpec: PaddingSpec;
  /** Extra vertical gap between name line and timer (off for `/stream-info` to match legacy). */
  includeNameTimeGap?: boolean;
  extraSurfaceStyle?: CSSProperties;
  nameClassName?: string;
  timeClassName?: string;
};

/**
 * Shared “pill” for next-service countdown: stream-info overlay, edit preview, and info controller.
 * Callers own outer layout (fullscreen fixed, aspect-video frame, inline panel).
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
  timeClassName = "leading-none tabular-nums tracking-tight",
}: ServiceTimeCountdownFaceProps) => {
  const nameSize = service.nameFontSize ?? 12;
  const timeSize = service.timeFontSize ?? 35;
  const { nameFontSize, timeFontSize } = getFontSizesVw(
    fontSpec,
    nameSize,
    timeSize
  );
  const shouldShowName = service.shouldShowName !== false;
  const showLivePulse =
    timeDisplay === "livePulseAtZero" && timeText === "0";

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
        ...extraSurfaceStyle,
      }}
    >
      {shouldShowName && (
        <div className={nameClassName} style={{ fontSize: `${nameFontSize}vw` }}>
          {service.name} begins in
        </div>
      )}
      <div
        className={cn(
          timeClassName,
          showLivePulse && "flex min-h-[1em] items-center justify-center",
        )}
        style={{ fontSize: `${timeFontSize}vw` }}
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
