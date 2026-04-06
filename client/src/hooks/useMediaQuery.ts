import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query. When `matchMedia` is unavailable (e.g. some tests),
 * returns `true` so desktop layout is used by default.
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return true;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const listener = () => setMatches(mq.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [query]);

  return matches;
};
