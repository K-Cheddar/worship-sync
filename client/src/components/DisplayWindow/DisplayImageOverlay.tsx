import { forwardRef, useEffect, useRef, useState } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultImageOverlayStyles } from "./defaultOverlayStyles";
import SharedOverlay from "./SharedOverlay";
import { checkMediaType } from "../../utils/generalUtils";

const EMPTY_OVERLAY_INFO: OverlayInfo = {} as OverlayInfo;

type DisplayImageOverlayProps = {
  width: number;
  imageOverlayInfo?: OverlayInfo;
  prevImageOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
  shouldFillContainer?: boolean;
};

const DisplayImageOverlay = forwardRef<
  HTMLDivElement,
  DisplayImageOverlayProps
>(
  (
    {
      width,
      imageOverlayInfo = EMPTY_OVERLAY_INFO,
      prevImageOverlayInfo = EMPTY_OVERLAY_INFO,
      shouldAnimate = false,
      shouldFillContainer = false,
    },
    containerRef
  ) => {
    const imageOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevImageOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>(null);
    const prevOverlayTimeline = useRef<GSAPTimeline | null>(null);
    const currentOpacity = useRef(1);
    const prevImageOverlayUrl = (prevImageOverlayInfo as Partial<OverlayInfo>)
      ?.imageUrl;
    const isPrevOverlayVideo = Boolean(
      prevImageOverlayUrl && checkMediaType(prevImageOverlayUrl) === "video"
    );

    // Track the URL that has been preloaded so GSAP only starts the full
    // animation once the image has its natural dimensions (prevents the
    // fit-content container from popping open mid-fade on first load).
    const [loadedImageUrl, setLoadedImageUrl] = useState<string | undefined>();

    useEffect(() => {
      const url = imageOverlayInfo.imageUrl;
      if (!url) {
        setLoadedImageUrl(undefined);
        return;
      }

      // Instant path for already-cached images.
      const probe = new Image();
      probe.src = url;
      if (probe.complete && probe.naturalWidth > 0) {
        setLoadedImageUrl(url);
        return;
      }

      setLoadedImageUrl(undefined);
      probe.onload = () => setLoadedImageUrl(url);
      probe.onerror = () => setLoadedImageUrl(url);
      return () => {
        probe.onload = null;
        probe.onerror = null;
      };
    }, [imageOverlayInfo.imageUrl]);

    useGSAP(
      () => {
        if (!imageOverlayRef.current || !shouldAnimate) return;

        overlayTimeline.current?.clear();
        overlayTimeline.current = gsap
          .timeline()
          .set(imageOverlayRef.current, { opacity: 0 });

        // Only animate once the image has loaded so the fit-content container
        // already has its natural size when the fade-in begins.
        if (imageOverlayInfo.imageUrl && loadedImageUrl === imageOverlayInfo.imageUrl) {
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
        dependencies: [imageOverlayInfo, loadedImageUrl],
      }
    );

    useGSAP(
      () => {
        if (!prevImageOverlayRef.current || !shouldAnimate) return;

        prevOverlayTimeline.current?.clear();
        const hasCurrentImageData = Boolean(imageOverlayInfo.imageUrl);
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevImageOverlayRef.current, {
            // Prevent a brief flash when interrupting an active video overlay.
            opacity:
              hasCurrentImageData && isPrevOverlayVideo
                ? 0
                : hasCurrentImageData
                  ? currentOpacity.current
                  : 1,
          });

        if (prevImageOverlayInfo.imageUrl) {
          prevOverlayTimeline.current.to(prevImageOverlayRef.current, {
            opacity: 0,
            duration: 1.5,
            ease: "power1.out",
          });
        }
      },
      {
        scope: prevImageOverlayRef,
        dependencies: [imageOverlayInfo, prevImageOverlayInfo],
      }
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
          shouldFillContainer={shouldFillContainer}
        />
        {!shouldFillContainer && prevNeedsPadding && (
          <SharedOverlay
            ref={prevImageOverlayRef}
            width={width}
            styles={prevStyles}
            overlayInfo={prevImageOverlayInfo}
            needsPadding={prevNeedsPadding}
            isPrev={true}
            overlayType="image"
          />
        )}
      </>
    );
  }
);

export default DisplayImageOverlay;
