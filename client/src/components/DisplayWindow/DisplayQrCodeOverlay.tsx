import { forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultQrCodeOverlayStyles } from "./defaultOverlayStyles";
import SharedOverlay from "./SharedOverlay";

type DisplayQRCodeOverlayProps = {
  width: number;
  qrCodeOverlayInfo?: OverlayInfo;
  prevQrCodeOverlayInfo?: OverlayInfo;
  shouldAnimate?: boolean;
};

const DisplayQRCodeOverlay = forwardRef<
  HTMLDivElement,
  DisplayQRCodeOverlayProps
>(
  (
    {
      width,
      qrCodeOverlayInfo = {},
      prevQrCodeOverlayInfo = {},
      shouldAnimate = false,
    },
    containerRef
  ) => {
    const qrCodeOverlayRef = useRef<HTMLDivElement | null>(null);
    const prevQrCodeOverlayRef = useRef<HTMLDivElement | null>(null);
    const overlayTimeline = useRef<GSAPTimeline | null>();
    const prevOverlayTimeline = useRef<GSAPTimeline | null>();
    const opacity = useRef(0);

    useGSAP(
      () => {
        if (
          !qrCodeOverlayRef.current ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current ||
          !shouldAnimate
        )
          return;

        overlayTimeline.current?.clear();

        const innerElements = [".overlay-qr-code-info-description"];

        overlayTimeline.current = gsap
          .timeline()
          .set(qrCodeOverlayRef.current, { opacity: 0 });

        // Only animate if there is overlay info
        if (qrCodeOverlayInfo.url || qrCodeOverlayInfo.description) {
          overlayTimeline.current
            .set(innerElements, { xPercent: 80, opacity: 0 })
            .to(qrCodeOverlayRef.current, {
              opacity: 1,
              duration: 2.5,
              ease: "power1.out",
              onUpdate: () => {
                opacity.current = qrCodeOverlayRef.current
                  ? (gsap.getProperty(
                      qrCodeOverlayRef.current,
                      "opacity"
                    ) as number)
                  : 1;
              },
            })
            .to(
              innerElements,
              { xPercent: 0, opacity: 1, duration: 2, ease: "power1.out" },
              "-=2.25"
            )
            .to(qrCodeOverlayRef.current, {
              opacity: 0,
              duration: 2.5,
              ease: "power1.out",
              delay: qrCodeOverlayInfo.duration,
              onUpdate: () => {
                opacity.current = qrCodeOverlayRef.current
                  ? (gsap.getProperty(
                      qrCodeOverlayRef.current,
                      "opacity"
                    ) as number)
                  : 1;
              },
            })
            .to(
              innerElements,
              { xPercent: 80, duration: 2, opacity: 0, ease: "power1.out" },
              "-=1.25"
            );
        }
      },
      {
        scope: qrCodeOverlayRef,
        dependencies: [qrCodeOverlayInfo, prevQrCodeOverlayInfo],
      }
    );

    useGSAP(
      () => {
        if (
          !prevQrCodeOverlayRef.current ||
          !shouldAnimate ||
          !(containerRef as React.MutableRefObject<HTMLDivElement>)?.current
        )
          return;

        prevOverlayTimeline.current?.clear();
        prevOverlayTimeline.current = gsap
          .timeline()
          .set(prevQrCodeOverlayRef.current, { opacity: opacity.current });

        if (prevQrCodeOverlayInfo.url || prevQrCodeOverlayInfo.description) {
          prevOverlayTimeline.current.to(prevQrCodeOverlayRef.current, {
            opacity: 0,
            duration: 1.5,
            ease: "power1.out",
          });
        }
      },
      {
        scope: prevQrCodeOverlayRef,
        dependencies: [prevQrCodeOverlayInfo, opacity],
      }
    );

    // Merge default styles with custom formatting
    const currentStyles = {
      ...defaultQrCodeOverlayStyles,
      ...qrCodeOverlayInfo.formatting,
    };

    const prevStyles = {
      ...defaultQrCodeOverlayStyles,
      ...prevQrCodeOverlayInfo.formatting,
    };

    const needsPadding = !!(
      qrCodeOverlayInfo.url || qrCodeOverlayInfo.description
    );
    const prevNeedsPadding = !!(
      prevQrCodeOverlayInfo.url || prevQrCodeOverlayInfo.description
    );

    return (
      <>
        <SharedOverlay
          ref={qrCodeOverlayRef}
          width={width}
          styles={currentStyles}
          overlayInfo={qrCodeOverlayInfo}
          needsPadding={needsPadding}
          overlayType="qr-code"
        />
        <SharedOverlay
          ref={prevQrCodeOverlayRef}
          width={width}
          styles={prevStyles}
          overlayInfo={prevQrCodeOverlayInfo}
          needsPadding={prevNeedsPadding}
          isPrev={true}
          overlayType="qr-code"
        />
      </>
    );
  }
);

export default DisplayQRCodeOverlay;
