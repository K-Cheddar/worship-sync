import { CSSProperties, forwardRef, useRef, useState } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

type DisplayStbOverlayProps = {
  width: number;
  stbOverlayInfo?: OverlayInfo;
  prevStbOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayStbOverlay = forwardRef<HTMLDivElement, DisplayStbOverlayProps>(
  (
    {
      width,
      stbOverlayInfo = {},
      prevStbOverlayInfo = {},
      shouldAnimate = false,
    },
    containerRef,
  ) => {
    const stbOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevStbOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();
    const prevOverlayTimeline = useRef<GSAPTimeline | null>();
    const [yPercent, setYPercent] = useState(120);
    const [opacity, setOpacity] = useState(0);

    useGSAP(
      () => {
        if (!stbOverlayRef.current || !shouldAnimate) return;

        overlayTimeline.current?.clear();

        overlayTimeline.current = gsap
          .timeline()
          .set(stbOverlayRef.current, { yPercent: 120, opacity: 0 });

        // Only play animate if there is overlay info
        if (stbOverlayInfo.heading || stbOverlayInfo.subHeading) {
          overlayTimeline.current
            .to(stbOverlayRef.current, {
              yPercent: 0,
              opacity: 1,
              duration: 1.5,
              ease: "power1.inOut",
              onUpdate: () => {
                setYPercent(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                      stbOverlayRef.current,
                      "yPercent",
                    ) as number)
                    : 0,
                );
                setOpacity(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                      stbOverlayRef.current,
                      "opacity",
                    ) as number)
                    : 1,
                );
              },
            })
            .to(stbOverlayRef.current, {
              yPercent: 120,
              opacity: 0,
              duration: 1.5,
              ease: "power1.inOut",
              delay: stbOverlayInfo.duration,
              onUpdate: () => {
                setYPercent(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                      stbOverlayRef.current,
                      "yPercent",
                    ) as number)
                    : 0,
                );
                setOpacity(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                      stbOverlayRef.current,
                      "opacity",
                    ) as number)
                    : 1,
                );
              },
            });
        }
      },
      {
        scope: stbOverlayRef,
        dependencies: [stbOverlayInfo, prevStbOverlayInfo],
      },
    );

    useGSAP(
      () => {
        if (
          !prevStbOverlayRef.current ||
          !shouldAnimate ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current
        )
          return;

        prevOverlayTimeline.current?.clear();
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevStbOverlayRef.current, { yPercent, opacity });

        if (prevStbOverlayInfo.heading || prevStbOverlayInfo.subHeading) {
          prevOverlayTimeline.current.to(prevStbOverlayRef.current, {
            yPercent: 120,
            opacity: 0,
            duration: 1.5,
            ease: "power1.inOut",
          });
        }
      },
      {
        scope: prevStbOverlayRef,
        dependencies: [prevStbOverlayInfo, yPercent, opacity],
      },
    );

    return (
      <>
        <div
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
        </div>
        <div
          ref={prevStbOverlayRef}
          className="overlay-stb-info-container"
          style={
            {
              "--overlay-stb-info-border-width": `${width / 150}vw`,
              "--overlay-stb-info-text-size": `${width / 50}vw`,
              "--overlay-stb-info-padding":
                prevStbOverlayInfo.heading || prevStbOverlayInfo.subHeading
                  ? "0.5% 2.5%"
                  : "0",
            } as CSSProperties
          }
        >
          {prevStbOverlayInfo.heading && (
            <p className="overlay-stb-info-heading">
              {prevStbOverlayInfo.heading}
            </p>
          )}
          {prevStbOverlayInfo.subHeading && (
            <p className="overlay-stb-info-subHeading">
              {prevStbOverlayInfo.subHeading}
            </p>
          )}
        </div>
      </>
    );
  },
);

export default DisplayStbOverlay;
