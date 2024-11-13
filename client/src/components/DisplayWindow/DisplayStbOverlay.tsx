import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStbOverlayProps = {
  width: number;
  stbOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
  isStream: boolean;
};

const DisplayStbOverlay = forwardRef<HTMLUListElement, DisplayStbOverlayProps>(
  (
    { width, stbOverlayInfo = {}, shouldAnimate = false, isStream },
    containerRef
  ) => {
    const stbOverlayRef = useRef<HTMLLIElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !stbOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLUListElement>)
            ?.current ||
          !shouldAnimate ||
          !isStream
        )
          return;

        overlayTimeline.current?.clear();

        const innerElements = [
          ".overlay-stb-info-name",
          ".overlay-stb-info-event",
        ];
        const targets = [stbOverlayRef.current, ...innerElements];

        overlayTimeline.current = gsap
          .timeline()
          .set(stbOverlayRef.current, { yPercent: 150 });

        // Only play animate if there is overlay info
        if (stbOverlayInfo.name || stbOverlayInfo.event) {
          overlayTimeline.current
            .to(stbOverlayRef.current, {
              yPercent: 0,
              duration: 1,
              ease: "power1.inOut",
            })
            .to(stbOverlayRef.current, {
              yPercent: 150,
              duration: 1,
              ease: "power1.inOut",
              delay: stbOverlayInfo.duration,
            });
        }
      },
      { scope: stbOverlayRef, dependencies: [stbOverlayInfo] }
    );

    if (!stbOverlayInfo.name && !stbOverlayInfo.event) return null;

    return isStream ? (
      <>
        <li
          ref={stbOverlayRef}
          className="overlay-stb-info-container"
          style={
            {
              "--overlay-stb-info-border-width": `${width / 150}vw`,
              "--overlay-stb-info-text-size": `${width / 50}vw`,
            } as CSSProperties
          }
        >
          {stbOverlayInfo.name && (
            <p className="overlay-stb-info-name">{stbOverlayInfo.name}</p>
          )}
          {stbOverlayInfo.event && (
            <p className="overlay-stb-info-event">{stbOverlayInfo.event}</p>
          )}
        </li>
      </>
    ) : null;
  }
);

export default DisplayStbOverlay;
