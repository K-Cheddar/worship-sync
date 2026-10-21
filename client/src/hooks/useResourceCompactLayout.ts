import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

/** Observe the actual list owner: navigation chrome can narrow a tablet viewport. */
export const useResourceCompactLayout = () => {
  const containerRef = useRef<HTMLElement>(null);
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
