import { useEffect, useRef } from "react";

const useDebouncedEffect = (
  effect: () => void,
  deps: any[],
  delay: number = 500,
  runImmediately: boolean = false
) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasRunImmediately = useRef(false);

  useEffect(() => {
    const shouldRunImmediately =
      runImmediately && !hasRunImmediately.current && !timeoutRef.current;

    if (shouldRunImmediately) {
      effect();
      hasRunImmediately.current = true;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      // Prevent firing twice on immediate → debounce transition
      if (!shouldRunImmediately) {
        effect();
      }
      timeoutRef.current = null;
      hasRunImmediately.current = false; // reset only after trailing fires
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay, runImmediately]);
};

export default useDebouncedEffect;
