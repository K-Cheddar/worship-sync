export type PreparedVideoSurfacePhase =
  | "idle"
  | "loading"
  | "preparing"
  | "ready"
  | "playing"
  | "resetting"
  | "disposed"
  | "error";

export type PreparedVideoSurfaceState = {
  phase: PreparedVideoSurfacePhase;
  generation: number;
  error?: string;
};

export type PreparedVideoSurfacePreparationStage =
  | "metadata"
  | "playback"
  | "presented-frame";

export const getPreparedVideoSurfaceErrorMessage = (
  stage: PreparedVideoSurfacePreparationStage,
  error: unknown,
): string => {
  const message = error instanceof Error ? error.message : String(error);
  let reason = "video decode error";
  if (message === "presented-frame timeout") {
    reason = message;
  } else if (stage === "metadata") {
    reason = "metadata load failed";
  } else if (stage === "playback") {
    reason = "seek/playback preparation failed";
  }
  return message && message !== reason ? `${reason}: ${message}` : reason;
};

export const initialPreparedVideoSurfaceState: PreparedVideoSurfaceState = {
  phase: "idle",
  generation: 0,
};

export const beginPreparedVideoSurface = (
  state: PreparedVideoSurfaceState,
): PreparedVideoSurfaceState => ({ phase: "loading", generation: state.generation + 1 });

export const advancePreparedVideoSurface = (
  state: PreparedVideoSurfaceState,
  generation: number,
  phase: "preparing" | "ready" | "playing" | "resetting" | "error",
  error?: string,
): PreparedVideoSurfaceState =>
  state.generation !== generation || state.phase === "disposed"
    ? state
    : { phase, generation, ...(error ? { error } : {}) };

export const disposePreparedVideoSurface = (
  state: PreparedVideoSurfaceState,
): PreparedVideoSurfaceState => ({ phase: "disposed", generation: state.generation + 1 });
