import { useState, useCallback } from "react";

/**
 * Custom hook that calculates window width percentage based on element height
 * Maintains 16:9 aspect ratio with a configurable maximum width percentage
 *
 * @param maxWidthPercent - Maximum width as percentage of window width (default: 70)
 * @returns {Object} Object containing:
 *   - windowWidth: The calculated width percentage (number)
 *   - windowRef: Ref callback to attach to the element to observe
 */
export const useWindowWidth = (maxWidthPercent: number = 70) => {
  const [windowWidth, setWindowWidth] = useState(50);

  const windowRef = useCallback(
    (node: HTMLElement | null) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const height = entries[0].borderBoxSize[0].blockSize;
          const targetWidth = (height * 16) / 9;
          const maxWidth = window.innerWidth * (maxWidthPercent / 100);
          const windowWidth = window.innerWidth;
          const widthPercent = Math.round(
            (Math.min(targetWidth, maxWidth) / windowWidth) * 100
          );
          setWindowWidth(widthPercent);
        });
        resizeObserver.observe(node);
      }
    },
    [maxWidthPercent]
  );

  return {
    windowWidth,
    windowRef,
  };
};
