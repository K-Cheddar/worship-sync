import { useEffect, useState } from "react";
import { SLOW_STARTUP_MESSAGE_DELAY_MS } from "../constants";
import type { StartupActivitySubscription } from "../context/controllerInfo";

const subscribeToNoActivity = () => () => {};

/** Shows a secondary note only after real startup activity has been quiet. */
export function useSlowStartupMessage(
  lastMeaningfulActivityAt: number,
  isComplete: boolean,
  subscribeToStartupActivity: StartupActivitySubscription = subscribeToNoActivity,
): boolean {
  const [showSlowStartupMessage, setShowSlowStartupMessage] = useState(false);

  useEffect(() => {
    if (isComplete) {
      setShowSlowStartupMessage(false);
      return undefined;
    }

    let timeoutId: number | undefined;
    let latestActivityAt = lastMeaningfulActivityAt;
    const scheduleSlowMessage = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const delay = Math.max(
        0,
        latestActivityAt + SLOW_STARTUP_MESSAGE_DELAY_MS - Date.now(),
      );
      timeoutId = window.setTimeout(
        () => setShowSlowStartupMessage(true),
        delay,
      );
    };

    setShowSlowStartupMessage(false);
    scheduleSlowMessage();
    const unsubscribe = subscribeToStartupActivity((activityAt) => {
      latestActivityAt = Math.max(latestActivityAt, activityAt);
      setShowSlowStartupMessage(false);
      scheduleSlowMessage();
    });

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [isComplete, lastMeaningfulActivityAt, subscribeToStartupActivity]);

  return showSlowStartupMessage;
}
