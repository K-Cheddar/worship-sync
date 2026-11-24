import { useRef } from "react";
import { Box } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DEFAULT_FONT_PX } from "../../constants";
import VerseDisplay from "./VerseDisplay";
import { recordPresentationDiagnostic } from "../../utils/presentationDiagnostics";

type MonitorDisplayBoxProps = {
  box: Box;
  prevBox?: Box;
  isPrev?: boolean;
  shouldAnimate?: boolean;
  /** 'next' = slide up, 'prev' = slide down, 'jump' = fade. Defaults to 'next'. */
  transitionDirection?: "next" | "prev" | "jump";
  outputId?: string;
  itemId?: string;
  slideIndex?: number;
};

const MonitorDisplayBox = ({
  box,
  prevBox,
  isPrev,
  shouldAnimate,
  transitionDirection = "next",
  outputId,
  itemId,
  slideIndex,
}: MonitorDisplayBoxProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline | null>(null);
  const diagnosticContextRef = useRef({ outputId, itemId, slideIndex });
  diagnosticContextRef.current = { outputId, itemId, slideIndex };

  const fontSizeInPx = box.monitorFontSizePx ?? (box.fontSize ?? DEFAULT_FONT_PX);
  const textStyles = {
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };
  const words = (box.words || "").trim().replace(/\n{2,}/g, "\n");

  const renderContent = () => {
    if (words.includes("\u200B")) {
      return <VerseDisplay words={words} className="text-gray-400" />;
    }
    return words;
  };

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      if (boxTimeline.current?.isActive?.()) {
        recordPresentationDiagnostic({
          event: "transition.interrupted",
          ...diagnosticContextRef.current,
          reason: "newer_monitor_band_update",
        });
      }
      boxTimeline.current?.clear();

      const fadeDuration = 0.35;
      const slideDuration = 0.65;

      boxTimeline.current = gsap.timeline({
        onComplete: () =>
          recordPresentationDiagnostic({
            event: "transition.completed",
            ...diagnosticContextRef.current,
            reason: "monitor_band_box_animation_complete",
          }),
      });

      const dir = transitionDirection;

      if (dir === "jump") {
        // Non-adjacent: fade
        if (isPrev) {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { opacity: 1 },
            {
              opacity: 0,
              duration: fadeDuration,
              ease: "power1.inOut",
            }
          );
        } else {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { opacity: 0 },
            {
              opacity: 1,
              duration: fadeDuration,
              ease: "power1.inOut",
            }
          );
        }
        return;
      }

      const textEl = boxRef.current.querySelector(".monitor-display-box-text");

      if (dir === "prev") {
        // Adjacent previous: slide down (outgoing goes down, incoming from above)
        const startY = isPrev ? 0 : -100;
        if (textEl) gsap.set(textEl, { opacity: 1, yPercent: startY });
        if (isPrev) {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { yPercent: 0 },
            {
              yPercent: 100,
              duration: slideDuration,
              ease: "power1.inOut",
            }
          );
        } else {
          boxTimeline.current.fromTo(
            ".monitor-display-box-text",
            { yPercent: -100 },
            {
              yPercent: 0,
              duration: slideDuration,
              ease: "power1.inOut",
            }
          );
        }
        return;
      }

      // next: slide up (outgoing up, incoming from below)
      const startY = isPrev ? 0 : 100;
      if (textEl) gsap.set(textEl, { opacity: 1, yPercent: startY });
      if (isPrev) {
        boxTimeline.current.fromTo(
          ".monitor-display-box-text",
          { yPercent: 0 },
          {
            yPercent: -100,
            duration: slideDuration,
            ease: "power1.inOut",
          }
        );
      } else {
        boxTimeline.current.fromTo(
          ".monitor-display-box-text",
          { yPercent: 100 },
          {
            yPercent: 0,
            duration: slideDuration,
            ease: "power1.inOut",
          }
        );
      }
    },
    {
      scope: boxRef,
      dependencies: [box, isPrev, shouldAnimate, transitionDirection],
    }
  );

  return (
    <div
      key={box.id}
      ref={boxRef}
      className="absolute leading-tight h-full w-full"
      style={{
        pointerEvents: "none",
        fontSize: `${fontSizeInPx}px`,
        color: box.fontColor,
        filter: `brightness(${box.brightness}%)`,
      }}
    >
      <p
        className="monitor-display-box-text h-full w-full bg-transparent absolute overflow-hidden whitespace-pre-line"
        style={textStyles}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default MonitorDisplayBox;
