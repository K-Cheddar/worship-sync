import { useEffect, useMemo, useState } from "react";
import { formatTime } from "../components/DisplayWindow/TimerDisplay";

const COUNTDOWN_TICK_MS = 16;

const getRemainingSeconds = (targetIso: string) =>
  Math.max(0, Math.floor((new Date(targetIso).getTime() - Date.now()) / 1000));

/**
 * Derived local countdown text for next-service surfaces.
 * This is intentionally not stored in the global timers slice because it is
 * only used by service-time UIs and is not a real timer item.
 */
export const useNextServiceCountdownText = (
  targetIso: string | null,
): string | null => {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!targetIso) {
      setRemainingSeconds(null);
      return;
    }

    const update = () => {
      setRemainingSeconds(getRemainingSeconds(targetIso));
    };

    update();
    const intervalId = window.setInterval(update, COUNTDOWN_TICK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [targetIso]);

  return useMemo(() => {
    if (remainingSeconds == null) return null;
    return formatTime(remainingSeconds, false) as string;
  }, [remainingSeconds]);
};

export default useNextServiceCountdownText;
