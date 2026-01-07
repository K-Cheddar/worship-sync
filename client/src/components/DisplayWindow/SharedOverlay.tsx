import React, { CSSProperties, forwardRef } from "react";
import {
  OverlayInfo,
  OverlayChild,
  OverlayFormatting,
  OverlayType,
} from "../../types";
// @ts-ignore
import { QRCode } from "react-qr-code";
import { getFontSize, getBorderWidth, getMargin } from "./utils";
import { checkMediaType, getImageFromVideoUrl } from "../../utils/generalUtils";
import HLSPlayer from "./HLSVideoPlayer";
import cn from "classnames";

interface SharedOverlayProps {
  width: number;
  styles: OverlayFormatting;
  overlayInfo: OverlayInfo | {};
  needsPadding: boolean;
  isPrev?: boolean;
  overlayType: OverlayType;
}

const SharedOverlay = forwardRef<HTMLDivElement, SharedOverlayProps>(
  (
    { width, styles, overlayInfo, needsPadding, isPrev = false, overlayType },
    ref
  ) => {
    // Shared styling utilities
    const getSharedStyles = (
      child: OverlayChild,
      defaultTextAlign: "left" | "right" | "center" = "left",
      useGlobalStyles: boolean = false
    ): CSSProperties => {
      const source = useGlobalStyles ? styles : child;
      return {
        // Font properties
        fontSize: getFontSize({
          width,
          fontSize: source.fontSize || 1.5,
        }),
        color: source.fontColor || "#ffffff",
        fontWeight: source.fontWeight || 400,
        fontStyle: source.fontStyle || "normal",
        textAlign: source.textAlign || defaultTextAlign,

        // Dimension properties
        width: useGlobalStyles
          ? typeof source.width === "number"
            ? `${source.width}%`
            : source.width
          : typeof child.width === "number"
            ? `${child.width}%`
            : child.width || "fit-content",
        height: useGlobalStyles
          ? typeof source.height === "number"
            ? `${source.height}%`
            : source.height
          : typeof child.height === "number"
            ? `${child.height}%`
            : child.height,
        maxWidth: source.maxWidth ? `${source.maxWidth}%` : undefined,
        maxHeight: source.maxHeight ? `${source.maxHeight}%` : undefined,
        minWidth: source.minWidth ? `${source.minWidth}%` : undefined,
        minHeight: source.minHeight ? `${source.minHeight}%` : undefined,

        // Background and border properties
        backgroundColor: source.backgroundColor,
        borderStyle: source.borderType || "solid",
        borderLeftWidth: getBorderWidth({
          width,
          borderWidth: source.borderLeftWidth,
        }),
        borderLeftColor: source.borderLeftColor || source.borderColor,
        borderRightWidth: getBorderWidth({
          width,
          borderWidth: source.borderRightWidth,
        }),
        borderRightColor: source.borderRightColor || source.borderColor,
        borderTopWidth: getBorderWidth({
          width,
          borderWidth: source.borderTopWidth,
        }),
        borderTopColor: source.borderTopColor || source.borderColor,
        borderBottomWidth: getBorderWidth({
          width,
          borderWidth: source.borderBottomWidth,
        }),
        borderBottomColor: source.borderBottomColor || source.borderColor,
        borderRadius: source.borderRadius,
        borderTopLeftRadius: source.borderRadiusTopLeft || source.borderRadius,
        borderTopRightRadius:
          source.borderRadiusTopRight || source.borderRadius,
        borderBottomLeftRadius:
          source.borderRadiusBottomLeft || source.borderRadius,
        borderBottomRightRadius:
          source.borderRadiusBottomRight || source.borderRadius,

        // Spacing properties
        paddingTop: source.paddingTop ? `${source.paddingTop}%` : undefined,
        paddingBottom: source.paddingBottom
          ? `${source.paddingBottom}%`
          : undefined,
        paddingLeft: source.paddingLeft ? `${source.paddingLeft}%` : undefined,
        paddingRight: source.paddingRight
          ? `${source.paddingRight}%`
          : undefined,
        marginTop: getMargin(source.marginTop),
        marginBottom: getMargin(source.marginBottom),
        marginLeft: getMargin(source.marginLeft),
        marginRight: getMargin(source.marginRight),

        // Position properties
        top: typeof source.top === "number" ? `${source.top}%` : undefined,
        bottom:
          typeof source.bottom === "number" ? `${source.bottom}%` : undefined,
        left: typeof source.left === "number" ? `${source.left}%` : undefined,
        right:
          typeof source.right === "number" ? `${source.right}%` : undefined,

        // Layout properties
        display: source.display || (useGlobalStyles ? "flex" : "block"),
        flexDirection:
          source.flexDirection || (useGlobalStyles ? "column" : undefined),
        justifyContent: source.justifyContent,
        alignItems: source.alignItems,
        flexWrap: source.flexWrap,
        gap: source.gap ? `${source.gap}%` : undefined,

        // Special properties for global styles
        ...(useGlobalStyles && { whiteSpace: isPrev ? "normal" : "pre-line" }),
      };
    };

    // Helper function to render child elements based on overlay type
    const renderChildren = () => {
      const children = styles.children || [];

      // Special case for QR code and image overlays that need custom rendering
      if (overlayType === "qr-code") {
        return renderQrCodeChildren(children);
      }

      if (overlayType === "image") {
        return renderImageChildren(children);
      }

      // Generic rendering for participant and stb overlays
      return renderGenericChildren(children);
    };

    const renderGenericChildren = (children: OverlayChild[]) => {
      // Define data mapping for each overlay type
      const dataMapping = {
        participant: [
          { key: "name", className: "name" },
          { key: "title", className: "title" },
          { key: "event", className: "event" },
        ],
        "stick-to-bottom": [
          { key: "heading", className: "heading" },
          { key: "subHeading", className: "subHeading" },
        ],
      };

      const currentMapping =
        dataMapping[overlayType as keyof typeof dataMapping] || [];
      const defaultTextAlign =
        overlayType === "stick-to-bottom" ? "center" : "left";

      return children.map((child: OverlayChild, index: number) => {
        const dataKey = currentMapping[index]?.key;
        const classNameSuffix = currentMapping[index]?.className;
        const dataValue =
          dataKey && dataKey in overlayInfo
            ? overlayInfo[dataKey as keyof typeof overlayInfo]
            : null;

        if (!dataValue) return null;

        const className = isPrev
          ? `prev-overlay-${overlayType}-info-${classNameSuffix}`
          : `overlay-${overlayType}-info-${classNameSuffix}`;

        return (
          <p
            key={index}
            className={className}
            style={getSharedStyles(child, defaultTextAlign)}
          >
            {dataValue}
          </p>
        );
      });
    };

    const renderQrCodeChildren = (children: OverlayChild[]) => {
      return children.map((child: OverlayChild, index: number) => {
        if (
          child.label === "QR Code" &&
          "url" in overlayInfo &&
          overlayInfo.url
        ) {
          return (
            <div
              key={index}
              className="overlay-qr-code-info-url"
              style={getSharedStyles(child)}
            >
              <QRCode
                style={{ width: "100%", height: "auto" }}
                value={overlayInfo.url}
              />
            </div>
          );
        } else if (
          child.label === "Description" &&
          "description" in overlayInfo &&
          overlayInfo.description
        ) {
          return (
            <p
              key={index}
              className="overlay-qr-code-info-description whitespace-pre-line"
              style={getSharedStyles(child, "left")}
            >
              {overlayInfo.description}
            </p>
          );
        }
        return null;
      });
    };

    const renderImageChildren = (children: OverlayChild[]) => {
      if (!("imageUrl" in overlayInfo) || !overlayInfo.imageUrl) return null;

      const isVideo = checkMediaType(overlayInfo.imageUrl) === "video";
      const isPrevVideo =
        isPrev && checkMediaType(overlayInfo.imageUrl) === "video";

      return (
        <div className="overlay-image-content">
          {isVideo ? (
            <HLSPlayer
              src={overlayInfo.imageUrl}
              className="max-w-full max-h-full w-full h-full object-contain"
            />
          ) : (
            <img
              className="max-w-full max-h-full object-contain"
              src={
                isPrevVideo
                  ? getImageFromVideoUrl(overlayInfo.imageUrl)
                  : overlayInfo.imageUrl
              }
              alt={overlayInfo.name || "Overlay image"}
            />
          )}
        </div>
      );
    };

    // Get the appropriate container class based on overlay type
    const getContainerClass = () => {
      switch (overlayType) {
        case "participant":
          return "absolute overflow-hidden";
        case "stick-to-bottom":
          return "absolute whitespace-nowrap";
        case "qr-code":
          return "absolute mx-auto overflow-hidden";
        case "image":
          return "absolute w-fit mx-auto left-0 right-0 overflow-hidden";
        default:
          return "absolute";
      }
    };

    return (
      <div
        ref={ref}
        className={cn(getContainerClass())}
        style={{
          position: "absolute",
          ...getSharedStyles(styles as OverlayChild, "left", true),
          // Override specific properties for container
          paddingTop: needsPadding ? `${styles.paddingTop || 0}%` : 0,
          paddingBottom: needsPadding ? `${styles.paddingBottom || 0}%` : 0,
          paddingLeft: needsPadding ? `${styles.paddingLeft || 0}%` : 0,
          paddingRight: needsPadding ? `${styles.paddingRight || 0}%` : 0,
          display: styles.display || "flex",
          flexDirection: styles.flexDirection || "column",
          ...(isPrev && { overflow: "hidden" }),
        }}
      >
        {renderChildren()}
      </div>
    );
  }
);

export default SharedOverlay;
