import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

/** Use available content width so sidebars do not force a cramped desktop table. */
export const useResponsiveTableLayout = <T extends HTMLElement = HTMLElement>() => {
  const containerRef = useRef<T>(null);
  const narrowViewport = useMediaQuery("(max-width: 767px)");
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { containerRef, compact: containerWidth === null ? narrowViewport : containerWidth < 768 };
};
