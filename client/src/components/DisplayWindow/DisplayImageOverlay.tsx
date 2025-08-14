import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultImageOverlayStyles } from "./defaultOverlayStyles";
import "./DisplayWindow.scss";
import { checkMediaType } from "../../utils/generalUtils";

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
    const overlayTimeline = useRef<GSAPTimeline | null>();
    const prevOverlayTimeline = useRef<GSAPTimeline | null>();
    const currentOpacity = useRef(1);

    const isVideo = checkMediaType(imageOverlayInfo.imageUrl) === "video";
    const isPrevVideo =
      checkMediaType(prevImageOverlayInfo.imageUrl) === "video";

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

    return (
      <>
        <div
          ref={imageOverlayRef}
          className="overlay-image-container"
          style={
            {
              "--overlay-image-max-width": `${currentStyles.maxWidth}%`,
              "--overlay-image-max-height": `${currentStyles.maxHeight}%`,
              "--overlay-image-bottom": `${currentStyles.bottom}%`,
              "--overlay-image-left": `${currentStyles.left}%`,
              "--overlay-image-right": `${currentStyles.right}%`,
              "--overlay-image-width":
                typeof currentStyles.width === "number"
                  ? `${currentStyles.width}%`
                  : currentStyles.width,
              "--overlay-image-height":
                typeof currentStyles.height === "number"
                  ? `${currentStyles.height}%`
                  : currentStyles.height,
            } as CSSProperties
          }
        >
          {imageOverlayInfo.imageUrl &&
            (isVideo ? (
              <video
                className="max-w-full max-h-full object-contain"
                src={imageOverlayInfo.imageUrl}
                autoPlay
                loop
                muted
              />
            ) : (
              <img
                className="max-w-full max-h-full object-contain"
                src={imageOverlayInfo.imageUrl}
                alt={imageOverlayInfo.name}
              />
            ))}
        </div>
        <div
          ref={prevImageOverlayRef}
          className="overlay-image-container"
          style={
            {
              "--overlay-image-max-width": `${prevStyles.maxWidth}%`,
              "--overlay-image-max-height": `${prevStyles.maxHeight}%`,
              "--overlay-image-bottom": `${prevStyles.bottom}%`,
              "--overlay-image-left": `${prevStyles.left}%`,
              "--overlay-image-right": `${prevStyles.right}%`,
              "--overlay-image-width":
                typeof prevStyles.width === "number"
                  ? `${prevStyles.width}%`
                  : prevStyles.width,
              "--overlay-image-height":
                typeof prevStyles.height === "number"
                  ? `${prevStyles.height}%`
                  : prevStyles.height,
            } as CSSProperties
          }
        >
          {prevImageOverlayInfo.imageUrl &&
            (isPrevVideo ? (
              <video
                className="max-w-full max-h-full object-contain"
                src={prevImageOverlayInfo.imageUrl}
                loop
                muted
                autoPlay={false}
              />
            ) : (
              <img
                className="max-w-full max-h-full object-contain"
                src={prevImageOverlayInfo.imageUrl}
                alt={prevImageOverlayInfo.name}
              />
            ))}
        </div>
      </>
    );
  }
);

export default DisplayImageOverlay;
