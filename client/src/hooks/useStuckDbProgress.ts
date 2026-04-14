import { useEffect, useRef, useState } from "react";
import { STUCK_DB_PROGRESS_MS } from "../constants";

/**
 * True when `progress` has stayed unchanged below 100 for STUCK_DB_PROGRESS_MS (wall clock).
 * Cleared when progress changes, when progress reaches 100, or when connection is failed
 * (caller should show the explicit failed UI instead).
 */
export function useStuckDbProgress(
  progress: number,
  isConnectionFailed: boolean,
): boolean {
  const [isStuck, setIsStuck] = useState(false);
  const lastProgressRef = useRef(progress);
  const lastChangeAtRef = useRef(Date.now());

  useEffect(() => {
    if (isConnectionFailed || progress >= 100) {
      lastProgressRef.current = progress;
      lastChangeAtRef.current = Date.now();
      setIsStuck(false);
      return;
    }
    if (progress !== lastProgressRef.current) {
      lastProgressRef.current = progress;
      lastChangeAtRef.current = Date.now();
      setIsStuck(false);
    }
  }, [progress, isConnectionFailed]);

  useEffect(() => {
    if (isConnectionFailed || progress >= 100) {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (Date.now() - lastChangeAtRef.current >= STUCK_DB_PROGRESS_MS) {
        setIsStuck(true);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [progress, isConnectionFailed]);

  return isStuck;
}
