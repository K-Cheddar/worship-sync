import { useLayoutEffect, useState, type RefObject } from "react";
import { REFERENCE_HEIGHT, REFERENCE_WIDTH } from "../../constants";
import { calculateReferenceScaleFactor } from "../../components/DisplayWindow/referenceCanvas";

type StaticThumbnailGeometryOptions = {
  containerWidth: number;
  containerHeight?: number;
  columns: number;
  columnGap?: number;
  horizontalPadding?: number;
  horizontalBorder?: number;
};

/** Calculates the reference-space scale from one grid's shared geometry. */
export const calculateStaticThumbnailScaleFactor = ({
  containerWidth,
  containerHeight,
  columns,
  columnGap = 0,
  horizontalPadding = 0,
  horizontalBorder = 0,
}: StaticThumbnailGeometryOptions) => {
  const safeColumns = Math.max(1, columns);
  const trackWidth =
    (containerWidth -
      horizontalPadding -
      columnGap * Math.max(0, safeColumns - 1)) /
    safeColumns;
  const thumbnailWidth = trackWidth - horizontalBorder;
  const thumbnailHeight =
    containerHeight != null && containerHeight > 0
      ? containerHeight
      : (thumbnailWidth * REFERENCE_HEIGHT) / REFERENCE_WIDTH;

  return calculateReferenceScaleFactor(thumbnailWidth, thumbnailHeight);
};

const parsePixels = (value: string) => {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
};

const getGridElement = (container: HTMLElement) =>
  container.matches("ul")
    ? container
    : container.querySelector<HTMLElement>("ul");

const measureStaticThumbnailScaleFactor = (
  container: HTMLElement,
  columns: number,
) => {
  const containerStyle = window.getComputedStyle(container);
  const grid = getGridElement(container);
  if (!grid) return 0;

  const gridStyle = window.getComputedStyle(grid);
  const horizontalPadding =
    parsePixels(containerStyle.paddingLeft) +
    parsePixels(containerStyle.paddingRight);
  const columnGap = parsePixels(gridStyle.columnGap);
  const representativeThumbnail =
    container.querySelector<HTMLElement>(
      '[data-testid="static-slide-thumbnail"]',
    );
  const representativeTile = representativeThumbnail?.parentElement;
  const tileStyle = representativeTile
    ? window.getComputedStyle(representativeTile)
    : undefined;
  const horizontalBorder = tileStyle
    ? parsePixels(tileStyle.borderLeftWidth) +
      parsePixels(tileStyle.borderRightWidth)
    : 0;

  return calculateStaticThumbnailScaleFactor({
    containerWidth: container.clientWidth,
    columns,
    columnGap,
    horizontalPadding,
    horizontalBorder,
  });
};

/**
 * One geometry observer per item grid/scroller. Individual thumbnails remain
 * purely presentational and never measure themselves.
 */
export const useStaticThumbnailScaleFactor = (
  containerRef: RefObject<HTMLElement | null>,
  columns: number,
  layoutKey: string,
) => {
  const [scaleFactor, setScaleFactor] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let retryFrame: number | null = null;
    let hasRetried = false;
    const update = () => {
      const nextScaleFactor = measureStaticThumbnailScaleFactor(
        container,
        columns,
      );
      if (nextScaleFactor > 0) {
        setScaleFactor((current) =>
          Math.abs(current - nextScaleFactor) < 0.000001
            ? current
            : nextScaleFactor,
        );
        return;
      }

      if (!hasRetried && retryFrame == null) {
        hasRetried = true;
        retryFrame = window.requestAnimationFrame(() => {
          retryFrame = null;
          update();
        });
      }
    };

    update();
    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (retryFrame != null) window.cancelAnimationFrame(retryFrame);
      };
    }

    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (retryFrame != null) window.cancelAnimationFrame(retryFrame);
    };
  }, [columns, containerRef, layoutKey]);

  return scaleFactor;
};
