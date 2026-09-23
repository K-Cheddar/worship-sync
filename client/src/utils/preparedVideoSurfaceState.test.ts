import {
  advancePreparedVideoSurface,
  beginPreparedVideoSurface,
  disposePreparedVideoSurface,
  getPreparedVideoSurfaceErrorMessage,
  initialPreparedVideoSurfaceState,
} from "./preparedVideoSurfaceState";

describe("preparedVideoSurfaceState", () => {
  it("moves cold → loading → preparing → ready → playing", () => {
    const loading = beginPreparedVideoSurface(initialPreparedVideoSurfaceState);
    const preparing = advancePreparedVideoSurface(loading, loading.generation, "preparing");
    const ready = advancePreparedVideoSurface(preparing, loading.generation, "ready");
    expect(advancePreparedVideoSurface(ready, loading.generation, "playing").phase).toBe("playing");
  });

  it("ignores stale completion after a new prepare or disposal", () => {
    const first = beginPreparedVideoSurface(initialPreparedVideoSurfaceState);
    const second = beginPreparedVideoSurface(first);
    expect(advancePreparedVideoSurface(second, first.generation, "ready")).toBe(second);
    const disposed = disposePreparedVideoSurface(second);
    expect(advancePreparedVideoSurface(disposed, second.generation, "ready")).toBe(disposed);
  });

  it("creates a new generation when reset/reprepare begins", () => {
    const ready = advancePreparedVideoSurface(
      beginPreparedVideoSurface(initialPreparedVideoSurfaceState),
      1,
      "ready",
    );
    expect(beginPreparedVideoSurface(ready).generation).toBe(2);
  });

  it("marks reset as an in-flight boundary before returning to ready", () => {
    const ready = advancePreparedVideoSurface(
      beginPreparedVideoSurface(initialPreparedVideoSurfaceState),
      1,
      "ready",
    );
    const resetting = advancePreparedVideoSurface(ready, 1, "resetting");

    expect(resetting).toMatchObject({ phase: "resetting", generation: 1 });
    expect(
      advancePreparedVideoSurface(resetting, 1, "ready"),
    ).toMatchObject({ phase: "ready", generation: 1 });
  });

  it("keeps a diagnostic reason on an errored surface", () => {
    const loading = beginPreparedVideoSurface(initialPreparedVideoSurfaceState);
    const error = advancePreparedVideoSurface(
      loading,
      loading.generation,
      "error",
      "metadata load failed",
    );

    expect(error).toMatchObject({ phase: "error", error: "metadata load failed" });
  });

  it("categorizes preparation failures by the stage that failed", () => {
    expect(getPreparedVideoSurfaceErrorMessage("metadata", new Error("video element error"))).toBe(
      "metadata load failed: video element error",
    );
    expect(getPreparedVideoSurfaceErrorMessage("playback", new Error("NotSupportedError"))).toBe(
      "seek/playback preparation failed: NotSupportedError",
    );
    expect(getPreparedVideoSurfaceErrorMessage("presented-frame", new Error("presented-frame timeout"))).toBe(
      "presented-frame timeout",
    );
  });
});
