import { CSSProperties, forwardRef, useRef } from "react";
import { OverlayInfo } from "../../types";
// @ts-ignore
import { QRCode } from "react-qr-code";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { defaultQrCodeOverlayStyles } from "./defaultOverlayStyles";
import "./DisplayWindow.scss";
import { getFontSize } from "./utils";

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

    const needsPadding = qrCodeOverlayInfo.url && qrCodeOverlayInfo.description;

    const prevNeedsPadding =
      prevQrCodeOverlayInfo.url && prevQrCodeOverlayInfo.description;

    return (
      <>
        <div
          ref={qrCodeOverlayRef}
          className="overlay-qr-code-info-container"
          style={
            {
              "--overlay-qr-code-info-description-size": `${width / 45}vw`,
              "--overlay-qr-child1-width":
                typeof currentStyles.child1Width === "number"
                  ? `${currentStyles.child1Width}%`
                  : currentStyles.child1Width,
              "--overlay-qr-child1-height":
                typeof currentStyles.child1Height === "number"
                  ? `${currentStyles.child1Height}%`
                  : currentStyles.child1Height,
              "--overlay-qr-code-info-padding-top": needsPadding
                ? `${currentStyles.paddingTop}%`
                : "0",
              "--overlay-qr-code-info-padding-bottom": needsPadding
                ? `${currentStyles.paddingBottom}%`
                : "0",
              "--overlay-qr-code-info-padding-left": needsPadding
                ? `${currentStyles.paddingLeft}%`
                : "0",
              "--overlay-qr-code-info-padding-right": needsPadding
                ? `${currentStyles.paddingRight}%`
                : "0",
              "--overlay-qr-bg-color": currentStyles.backgroundColor,
              "--overlay-qr-border-color": currentStyles.borderColor,
              "--overlay-qr-border-type": currentStyles.borderType,
              "--overlay-qr-border-radius": currentStyles.borderRadius,
              "--overlay-qr-max-width": `${currentStyles.maxWidth}%`,
              "--overlay-qr-max-height": `${currentStyles.maxHeight}%`,
              "--overlay-qr-height":
                typeof currentStyles.height === "number"
                  ? `${currentStyles.height}%`
                  : currentStyles.height,
              "--overlay-qr-bottom": `${currentStyles.bottom}%`,
              "--overlay-qr-left": `${currentStyles.left}%`,
              "--overlay-qr-right": `${currentStyles.right}%`,
              "--overlay-qr-font-size": `${getFontSize({
                width,
                fontSize: currentStyles.fontSize,
              })}`,
              "--overlay-qr-font-color": currentStyles.fontColor,
              "--overlay-qr-font-weight": currentStyles.fontWeight,
              "--overlay-qr-font-style": currentStyles.fontStyle,
              "--overlay-qr-text-align": currentStyles.textAlign,
              "--overlay-qr-display": currentStyles.display,
              "--overlay-qr-flex-direction": currentStyles.flexDirection,
              "--overlay-qr-justify-content": currentStyles.justifyContent,
              "--overlay-qr-align-items": currentStyles.alignItems,
              "--overlay-qr-gap": `${currentStyles.gap}%`,
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
              "--overlay-qr-child1-width":
                typeof prevStyles.child1Width === "number"
                  ? `${prevStyles.child1Width}%`
                  : prevStyles.child1Width,
              "--overlay-qr-child1-height":
                typeof prevStyles.child1Height === "number"
                  ? `${prevStyles.child1Height}%`
                  : prevStyles.child1Height,
              "--overlay-qr-code-info-padding-top": prevNeedsPadding
                ? `${prevStyles.paddingTop}%`
                : "0",
              "--overlay-qr-code-info-padding-bottom": prevNeedsPadding
                ? `${prevStyles.paddingBottom}%`
                : "0",
              "--overlay-qr-code-info-padding-left": prevNeedsPadding
                ? `${prevStyles.paddingLeft}%`
                : "0",
              "--overlay-qr-code-info-padding-right": prevNeedsPadding
                ? `${prevStyles.paddingRight}%`
                : "0",
              "--overlay-qr-bg-color": prevStyles.backgroundColor,
              "--overlay-qr-border-color": prevStyles.borderColor,
              "--overlay-qr-border-type": prevStyles.borderType,
              "--overlay-qr-border-radius": prevStyles.borderRadius,
              "--overlay-qr-max-width": `${prevStyles.maxWidth}%`,
              "--overlay-qr-max-height": `${prevStyles.maxHeight}%`,
              "--overlay-qr-height":
                typeof prevStyles.height === "number"
                  ? `${prevStyles.height}%`
                  : prevStyles.height,
              "--overlay-qr-bottom": `${prevStyles.bottom}%`,
              "--overlay-qr-left": `${prevStyles.left}%`,
              "--overlay-qr-right": `${prevStyles.right}%`,
              "--overlay-qr-font-size": `${getFontSize({
                width,
                fontSize: prevStyles.fontSize,
              })}`,
              "--overlay-qr-font-color": prevStyles.fontColor,
              "--overlay-qr-font-weight": prevStyles.fontWeight,
              "--overlay-qr-font-style": prevStyles.fontStyle,
              "--overlay-qr-text-align": prevStyles.textAlign,
              "--overlay-qr-display": prevStyles.display,
              "--overlay-qr-flex-direction": prevStyles.flexDirection,
              "--overlay-qr-justify-content": prevStyles.justifyContent,
              "--overlay-qr-align-items": prevStyles.alignItems,
              "--overlay-qr-gap": `${prevStyles.gap}%`,
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
  }
);

export default DisplayQRCodeOverlay;
