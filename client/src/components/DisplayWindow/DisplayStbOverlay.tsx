import { forwardRef, useRef, useState } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultStbOverlayStyles } from "./defaultOverlayStyles";
import SharedOverlay from "./SharedOverlay";

const EMPTY_OVERLAY_INFO: OverlayInfo = {} as OverlayInfo;

type DisplayStbOverlayProps = {
  width: number;
  stbOverlayInfo?: OverlayInfo;
  prevStbOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
  shouldFillContainer?: boolean;
};

const DisplayStbOverlay = forwardRef<HTMLDivElement, DisplayStbOverlayProps>(
  (
    {
      width,
      stbOverlayInfo = EMPTY_OVERLAY_INFO,
      prevStbOverlayInfo = EMPTY_OVERLAY_INFO,
      shouldAnimate = false,
      shouldFillContainer = false,
    },
    containerRef
  ) => {
    const stbOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevStbOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>(null);
    const prevOverlayTimeline = useRef<GSAPTimeline | null>(null);
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
                        "yPercent"
                      ) as number)
                    : 0
                );
                setOpacity(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                        stbOverlayRef.current,
                        "opacity"
                      ) as number)
                    : 1
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
                        "yPercent"
                      ) as number)
                    : 0
                );
                setOpacity(
                  stbOverlayRef.current
                    ? (gsap.getProperty(
                        stbOverlayRef.current,
                        "opacity"
                      ) as number)
                    : 1
                );
              },
            });
        }
      },
      {
        scope: stbOverlayRef,
        dependencies: [stbOverlayInfo],
      }
    );

    useGSAP(
      () => {
        // Handle both callback refs and object refs
        const containerElement = typeof containerRef === 'function' 
          ? null
          : (containerRef as React.MutableRefObject<HTMLDivElement>)?.current;
        
        if (
          !prevStbOverlayRef.current ||
          !shouldAnimate ||
          (typeof containerRef !== 'function' && !containerElement)
        )
          return;

        prevOverlayTimeline.current?.clear();
        const hasCurrentStbData =
          Boolean(stbOverlayInfo.heading) || Boolean(stbOverlayInfo.subHeading);
        const prevOverlayStartState = hasCurrentStbData
          ? { yPercent, opacity }
          : { yPercent: 0, opacity: 1 };
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevStbOverlayRef.current, prevOverlayStartState);

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
        dependencies: [opacity, prevStbOverlayInfo, stbOverlayInfo, yPercent],
      }
    );

    // Merge default styles with custom formatting
    const currentStyles = {
      ...defaultStbOverlayStyles,
      ...stbOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultStbOverlayStyles,
      ...prevStbOverlayInfo.formatting,
    };

    // Get STB data for children
    const stbData = [stbOverlayInfo.heading, stbOverlayInfo.subHeading].filter(
      (item): item is string => Boolean(item)
    );

    const prevStbData = [
      prevStbOverlayInfo.heading,
      prevStbOverlayInfo.subHeading,
    ].filter((item): item is string => Boolean(item));

    const needsPadding = stbData.length > 0;
    const prevNeedsPadding = prevStbData.length > 0;

    return (
      <>
        <SharedOverlay
          ref={stbOverlayRef}
          width={width}
          styles={currentStyles}
          overlayInfo={stbOverlayInfo}
          needsPadding={needsPadding}
          overlayType="stick-to-bottom"
          shouldFillContainer={shouldFillContainer}
        />
        {!shouldFillContainer && (
          <SharedOverlay
            ref={prevStbOverlayRef}
            width={width}
            styles={prevStyles}
            overlayInfo={prevStbOverlayInfo}
            needsPadding={prevNeedsPadding}
            isPrev={true}
            overlayType="stick-to-bottom"
          />
        )}
      </>
    );
  }
);

export default DisplayStbOverlay;
