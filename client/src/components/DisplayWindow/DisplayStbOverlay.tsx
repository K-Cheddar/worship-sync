import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStbOverlayProps = {
  width: number;
  stbOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayStbOverlay = forwardRef<HTMLUListElement, DisplayStbOverlayProps>(
  ({ width, stbOverlayInfo = {}, shouldAnimate = false }, containerRef) => {
    const stbOverlayRef = useRef<HTMLLIElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();

    useGSAP(
      () => {
        if (
          !stbOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLUListElement>)
            ?.current ||
          !shouldAnimate
        )
          return;

        overlayTimeline.current?.clear();

        // const innerElements = [
        //   ".overlay-stb-info-heading",
        //   ".overlay-stb-info-subHeading",
        // ];
        // const targets = [stbOverlayRef.current, ...innerElements];

        overlayTimeline.current = gsap
          .timeline()
          .set(stbOverlayRef.current, { yPercent: 150 });

        // Only play animate if there is overlay info
        if (stbOverlayInfo.heading || stbOverlayInfo.subHeading) {
          overlayTimeline.current
            .to(stbOverlayRef.current, {
              yPercent: 0,
              duration: 1.5,
              ease: "power1.inOut",
            })
            .to(stbOverlayRef.current, {
              yPercent: 150,
              duration: 1.5,
              ease: "power1.inOut",
              delay: stbOverlayInfo.duration,
            });
        }
      },
      { scope: stbOverlayRef, dependencies: [stbOverlayInfo] }
    );

    return (
      <li
        ref={stbOverlayRef}
        className="overlay-stb-info-container"
        style={
          {
            "--overlay-stb-info-border-width": `${width / 150}vw`,
            "--overlay-stb-info-text-size": `${width / 50}vw`,
            "--overlay-stb-info-padding":
              stbOverlayInfo.heading || stbOverlayInfo.subHeading
                ? "0.5% 2.5%"
                : "0",
            "--overlay-stb-info-text-shadow-size-p": `${width / 70}px`,
            "--overlay-stb-info-text-shadow-size-n": `-${width / 70}px`,
          } as CSSProperties
        }
      >
        {stbOverlayInfo.heading && (
          <p className="overlay-stb-info-heading">{stbOverlayInfo.heading}</p>
        )}
        {stbOverlayInfo.subHeading && (
          <p className="overlay-stb-info-subHeading">
            {stbOverlayInfo.subHeading}
          </p>
        )}
      </li>
    );
  }
);

export default DisplayStbOverlay;
