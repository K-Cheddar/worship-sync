import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
// @ts-ignore
import { QRCode } from "react-qr-code";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DisplayWindow.scss";

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
    containerRef,
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
                    "opacity",
                  ) as number)
                  : 1;
              },
            })
            .to(
              innerElements,
              { xPercent: 0, opacity: 1, duration: 2, ease: "power1.out" },
              "-=2.25",
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
                    "opacity",
                  ) as number)
                  : 1;
              },
            })
            .to(
              innerElements,
              { xPercent: 80, duration: 2, opacity: 0, ease: "power1.out" },
              "-=1.25",
            );
        }
      },
      {
        scope: qrCodeOverlayRef,
        dependencies: [qrCodeOverlayInfo, prevQrCodeOverlayInfo],
      },
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
      },
    );

    return (
      <>
        <div
          ref={qrCodeOverlayRef}
          className="overlay-qr-code-info-container"
          style={
            {
              "--overlay-qr-code-info-description-size": `${width / 45}vw`,
              "--overlay-qr-code-info-url-width": `${width / 10}vw`,
              "--overlay-qr-code-info-gap": `${width / 40}vw`,
              "--overlay-qr-code-info-padding":
                qrCodeOverlayInfo.url && qrCodeOverlayInfo.description
                  ? "1% 2.5%"
                  : "0",
              "--overlay-qr-code-info-color": qrCodeOverlayInfo.color,
            } as CSSProperties
          }
        >
          {qrCodeOverlayInfo.url && (
            <div className="overlay-qr-code-info-url">
              <QRCode
                style={{ width: "100%", maxWidth: "100%", height: "auto" }}
                value={qrCodeOverlayInfo.url}
              />
            </div>
          )}
          {qrCodeOverlayInfo.description && (
            <p className="overlay-qr-code-info-description">
              {qrCodeOverlayInfo.description}
            </p>
          )}
        </div>
        <div
          ref={prevQrCodeOverlayRef}
          className="overlay-qr-code-info-container"
          style={
            {
              "--overlay-qr-code-info-description-size": `${width / 45}vw`,
              "--overlay-qr-code-info-url-width": `${width / 10}vw`,
              "--overlay-qr-code-info-gap": `${width / 40}vw`,
              "--overlay-qr-code-info-padding":
                prevQrCodeOverlayInfo.url && prevQrCodeOverlayInfo.description
                  ? "1% 2.5%"
                  : "0",
              "--overlay-qr-code-info-color": prevQrCodeOverlayInfo.color,
            } as CSSProperties
          }
        >
          {prevQrCodeOverlayInfo.url && (
            <div className="overlay-qr-code-info-url">
              <QRCode
                style={{ width: "100%", maxWidth: "100%", height: "auto" }}
                value={prevQrCodeOverlayInfo.url}
              />
            </div>
          )}
          {prevQrCodeOverlayInfo.description && (
            <p className="overlay-qr-code-info-description">
              {prevQrCodeOverlayInfo.description}
            </p>
          )}
        </div>
      </>
    );
  },
);

export default DisplayQRCodeOverlay;
