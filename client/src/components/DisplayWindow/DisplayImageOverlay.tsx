import { forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultImageOverlayStyles } from "./defaultOverlayStyles";
import SharedOverlay from "./SharedOverlay";

type DisplayImageOverlayProps = {
  width: number;
  imageOverlayInfo?: OverlayInfo;
  prevImageOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayImageOverlay = forwardRef<
  HTMLDivElement,
  DisplayImageOverlayProps
>(
  (
    {
      width,
      imageOverlayInfo = {},
      prevImageOverlayInfo = {},
      shouldAnimate = false,
    },
    containerRef
  ) => {
    const imageOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevImageOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>(null);
    const prevOverlayTimeline = useRef<GSAPTimeline | null>(null);
    const currentOpacity = useRef(1);

    useGSAP(
      () => {
        if (
          !imageOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current ||
          !shouldAnimate
        )
          return;

        overlayTimeline.current?.clear();
        overlayTimeline.current = gsap
          .timeline()
          .set(imageOverlayRef.current, { opacity: 0 });

        // Only animate if there is an image set
        if (imageOverlayInfo.imageUrl) {
          overlayTimeline.current
            .to(imageOverlayRef.current, {
              opacity: 1,
              duration: 2.5,
              ease: "power1.out",
              onUpdate: () => {
                currentOpacity.current = imageOverlayRef.current
                  ? (gsap.getProperty(
                      imageOverlayRef.current,
                      "opacity"
                    ) as number)
                  : 1;
              },
            })
            .to(imageOverlayRef.current, {
              opacity: 0,
              duration: 2.5,
              ease: "power1.out",
              delay: imageOverlayInfo.duration,
              onUpdate: () => {
                currentOpacity.current = imageOverlayRef.current
                  ? (gsap.getProperty(
                      imageOverlayRef.current,
                      "opacity"
                    ) as number)
                  : 1;
              },
            });
        }
      },
      {
        scope: imageOverlayRef,
        dependencies: [imageOverlayInfo, prevImageOverlayInfo],
      }
    );

    useGSAP(
      () => {
        if (
          !prevImageOverlayRef.current ||
          !shouldAnimate ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current
        )
          return;

        prevOverlayTimeline.current?.clear();
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevImageOverlayRef.current, {
            opacity: currentOpacity.current,
          });

        if (prevImageOverlayInfo.imageUrl) {
          prevOverlayTimeline.current.to(prevImageOverlayRef.current, {
            opacity: 0,
            duration: 1.5,
            ease: "power1.out",
          });
        }
      },
      { scope: prevImageOverlayRef, dependencies: [prevImageOverlayInfo] }
    );

    // Merge default styles with custom formatting
    const currentStyles = {
      ...defaultImageOverlayStyles,
      ...imageOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultImageOverlayStyles,
      ...prevImageOverlayInfo.formatting,
    };

    const needsPadding = !!imageOverlayInfo.imageUrl;
    const prevNeedsPadding = !!prevImageOverlayInfo.imageUrl;

    return (
      <>
        <SharedOverlay
          ref={imageOverlayRef}
          width={width}
          styles={currentStyles}
          overlayInfo={imageOverlayInfo}
          needsPadding={needsPadding}
          overlayType="image"
        />
        <SharedOverlay
          ref={prevImageOverlayRef}
          width={width}
          styles={prevStyles}
          overlayInfo={prevImageOverlayInfo}
          needsPadding={prevNeedsPadding}
          isPrev={true}
          overlayType="image"
        />
      </>
    );
  }
);

export default DisplayImageOverlay;
