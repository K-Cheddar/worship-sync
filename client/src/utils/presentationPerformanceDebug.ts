type PresentationPerformanceEvent =
  | "continuous-slide-click"
  | "presentation-send-start"
  | "redux-dispatch-observed"
  | "presentation-listener-scheduled"
  | "presentation-listener-cancelled"
  | "presentation-listener-delay-complete"
  | "cross-item-ui-update-start"
  | "prepare-item-complete"
  | "active-item-dispatch-complete"
  | "navigation-start"
  | "navigation-complete"
  | "outline-react-commit"
  | "cross-item-ui-update-complete"
  | "presentation-sync-start"
  | "presentation-local-write-start"
  | "presentation-local-write-complete"
  | "presentation-firebase-write-start"
  | "presentation-firebase-write-complete"
  | "presentation-receiver-callback"
  | "video-requested"
  | "video-source-available"
  | "video-player-mounted"
  | "video-loadedmetadata"
  | "video-loadeddata-first-paint"
  | "projector-action-dispatched"
  | "display-payload-received"
  | "transition-preparing"
  | "transition-interrupted"
  | "background-paint-ready"
  | "transition-start";

/** Opt-in live-path timing: localStorage.setItem("worshipsync:presentation-debug", "1"). */
export const markPresentationPerformance = (
  event: PresentationPerformanceEvent,
  details?: Record<string, unknown>,
) => {
  if (!import.meta.env.DEV) return;
  if (window.localStorage.getItem("worshipsync:presentation-debug") !== "1") {
    return;
  }
  console.info(`[presentation-perf] ${event}`, {
    at: performance.now(),
    ...details,
  });
};

const lastReadinessByKey = new Map<string, boolean>();

/** Readiness is reported by several React/media callbacks; only emit changes. */
export const markPresentationReadiness = (details: {
  outputId: string;
  windowRole: string;
  laneId: string;
  mediaKey: string;
  ready: boolean;
}) => {
  const key = [
    details.outputId,
    details.windowRole,
    details.laneId,
    details.mediaKey,
  ].join("|");
  if (lastReadinessByKey.get(key) === details.ready) return;
  lastReadinessByKey.set(key, details.ready);
  markPresentationPerformance("background-paint-ready", details);
};
