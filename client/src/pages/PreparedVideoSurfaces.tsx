import { useCallback, useEffect, useRef, useState } from "react";
import { isInstantVideoSource } from "../utils/isInstantVideoSource";
import {
  getPreparedVideoSourceLabel,
  PREPARED_VIDEO_EMPTY_STATE_MESSAGE,
  resolvePreparedVideoSources,
  selectPreparedVideoSources,
  type PreparedVideoSource,
} from "../utils/preparedVideoSurfaceEligibility";
import {
  advancePreparedVideoSurface,
  beginPreparedVideoSurface,
  disposePreparedVideoSurface,
  getPreparedVideoSurfaceErrorMessage,
  initialPreparedVideoSurfaceState,
  type PreparedVideoSurfacePreparationStage,
  type PreparedVideoSurfaceState,
} from "../utils/preparedVideoSurfaceState";
import type {
  PreparedVideoMetricValue,
  PreparedVideoMetrics,
  PreparedVideoSourceInfo,
} from "../types/electron";

type HiddenStrategy = "opacity" | "offscreen";
type SurfaceControl = { play: () => void; reset: () => void; dispose: () => void };
type CancellableWait = { promise: Promise<void>; cancel: (reason?: Error) => void };
type SurfaceMetric = {
  mediaKey: string;
  source: string;
  phase: PreparedVideoSurfaceState["phase"];
  metadataMs?: number;
  firstFrameMs?: number;
  playToPresentedFrameMs?: number;
  error?: string;
};
type PreparationStage = PreparedVideoSurfacePreparationStage;

export const waitForEvent = (
  video: HTMLVideoElement,
  event: "loadedmetadata" | "seeked",
): CancellableWait => {
  let cancelWait: (reason?: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(new Error(`${event} timeout`)), 5_000);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const done = () => finish();
    const failed = () => finish(new Error("video element error"));
    cancelWait = (reason = new Error(`${event} wait cancelled`)) => finish(reason);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
  return { promise, cancel: (reason) => cancelWait(reason) };
};

/** Same quality bar as HLSVideoPlayer: a presented frame, not loadeddata alone. */
export const waitForPresentedFrame = (video: HTMLVideoElement): CancellableWait => {
  const frameVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  let frameRequest: number | undefined;
  let animationFrames: number[] = [];
  let cancelWait: (reason?: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (frameRequest != null) frameVideo.cancelVideoFrameCallback?.(frameRequest);
      frameRequest = undefined;
      animationFrames.forEach((id) => window.cancelAnimationFrame(id));
      animationFrames = [];
      window.clearTimeout(timeoutId);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const timeoutId = window.setTimeout(
      () => finish(new Error("presented-frame timeout")),
      5_000,
    );
    cancelWait = (reason = new Error("presented-frame wait cancelled")) => finish(reason);
    if (frameVideo.requestVideoFrameCallback) {
      frameRequest = frameVideo.requestVideoFrameCallback(() => finish());
      return;
    }
    let presentedFallbackStarted = false;
    const requestNext = () => {
      const id = window.requestAnimationFrame(() => {
        animationFrames = animationFrames.filter((frameId) => frameId !== id);
        if (settled) return;
        if (!presentedFallbackStarted) {
          presentedFallbackStarted = true;
          requestNext();
        } else {
          finish();
        }
      });
      animationFrames.push(id);
    };
    requestNext();
  });
  return { promise, cancel: (reason) => cancelWait(reason) };
};

export const PreparedSurface = ({
  mediaKey,
  source,
  strategy,
  onControl,
  onMetric,
}: {
  mediaKey: string;
  source: string;
  strategy: HiddenStrategy;
  onControl: (control: SurfaceControl | null) => void;
  onMetric: (metric: SurfaceMetric) => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stateRef = useRef(initialPreparedVideoSurfaceState);
  const pendingWaitRef = useRef<CancellableWait | null>(null);
  const onControlRef = useRef(onControl);
  const onMetricRef = useRef(onMetric);
  onControlRef.current = onControl;
  onMetricRef.current = onMetric;
  const [state, setState] = useState(initialPreparedVideoSurfaceState);
  const update = useCallback((next: PreparedVideoSurfaceState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const publish = useCallback((extra: Partial<SurfaceMetric> = {}) => {
    onMetricRef.current({ mediaKey, source, phase: stateRef.current.phase, ...extra });
  }, [mediaKey, source]);
  const cancelPendingWait = useCallback(() => {
    pendingWaitRef.current?.cancel();
    pendingWaitRef.current = null;
  }, []);
  const awaitOwnedWait = useCallback(async (wait: CancellableWait) => {
    pendingWaitRef.current = wait;
    try {
      await wait.promise;
    } finally {
      if (pendingWaitRef.current === wait) pendingWaitRef.current = null;
    }
  }, []);

  const prepare = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    cancelPendingWait();
    const loading = beginPreparedVideoSurface(stateRef.current);
    update(loading);
    publish();
    const startedAt = performance.now();
    let stage: PreparationStage = "metadata";
    try {
      video.pause();
      video.currentTime = 0;
      video.src = source;
      video.load();
      await awaitOwnedWait(waitForEvent(video, "loadedmetadata"));
      if (stateRef.current.generation !== loading.generation) return;
      update(advancePreparedVideoSurface(loading, loading.generation, "preparing"));
      publish();
      const metadataMs = performance.now() - startedAt;
      if (video.currentTime !== 0) {
        video.currentTime = 0;
        await awaitOwnedWait(waitForEvent(video, "seeked"));
        if (stateRef.current.generation !== loading.generation) return;
      }
      stage = "playback";
      await video.play();
      if (stateRef.current.generation !== loading.generation) return;
      stage = "presented-frame";
      await awaitOwnedWait(waitForPresentedFrame(video));
      if (stateRef.current.generation !== loading.generation) return;
      video.pause();
      update(advancePreparedVideoSurface(stateRef.current, loading.generation, "ready"));
      publish({ metadataMs, firstFrameMs: performance.now() - startedAt });
    } catch (error) {
      if (stateRef.current.generation !== loading.generation) return;
      video.pause();
      const errorMessage = getPreparedVideoSurfaceErrorMessage(stage, error);
      update(advancePreparedVideoSurface(stateRef.current, loading.generation, "error", errorMessage));
      publish({ error: errorMessage });
    }
  }, [awaitOwnedWait, cancelPendingWait, publish, source, update]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video || stateRef.current.phase !== "ready") return;
    const generation = stateRef.current.generation;
    const startedAt = performance.now();
    update(advancePreparedVideoSurface(stateRef.current, generation, "playing"));
    publish();
    try {
      await video.play();
      if (stateRef.current.generation !== generation) return;
      await awaitOwnedWait(waitForPresentedFrame(video));
      if (stateRef.current.generation === generation) {
        publish({ playToPresentedFrameMs: performance.now() - startedAt });
      }
    } catch (error) {
      if (stateRef.current.generation !== generation) return;
      video.pause();
      const errorMessage = getPreparedVideoSurfaceErrorMessage("playback", error);
      update(advancePreparedVideoSurface(stateRef.current, generation, "error", errorMessage));
      publish({ error: errorMessage });
    }
  }, [awaitOwnedWait, publish, update]);

  const dispose = useCallback(() => {
    const video = videoRef.current;
    update(disposePreparedVideoSurface(stateRef.current));
    cancelPendingWait();
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    publish();
  }, [cancelPendingWait, publish, update]);

  useEffect(() => {
    if (!isInstantVideoSource(source)) return;
    void prepare();
    onControlRef.current({ play: () => void play(), reset: () => void prepare(), dispose });
    return () => { onControlRef.current(null); dispose(); };
  }, [dispose, play, prepare, source]);

  const hiddenStyle: React.CSSProperties = strategy === "opacity"
    ? { position: "fixed", width: 2, height: 2, opacity: 0, pointerEvents: "none" }
    : { position: "fixed", width: 2, height: 2, left: -10000, top: -10000, pointerEvents: "none" };
  return <video ref={videoRef} muted playsInline preload="auto" style={hiddenStyle} data-testid={`prepared-surface-${mediaKey}`} data-prepared-state={state.phase} />;
};

const unavailableMetrics = (reason: string): PreparedVideoMetrics => ({
  status: "ipc_unavailable",
  memory: {
    private: { status: "unsupported", reason },
    workingSet: { status: "unsupported", reason },
  },
  cpu: { status: "unsupported", reason },
  reason,
});

const formatMetricValue = (
  value: PreparedVideoMetricValue | undefined,
  unit: "MB" | "%",
): string => {
  if (value?.status === "available" && typeof value.value === "number") {
    if (unit === "MB") {
      return `${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value.value / 1024)} MB`;
    }
    return `${value.value.toFixed(1)}%`;
  }
  return value?.reason || "not measured yet";
};

const PreparedVideoSurfaces = () => {
  const [isDevElectron, setIsDevElectron] = useState<boolean>();
  const [eligible, setEligible] = useState<Array<PreparedVideoSource & { mediaKey: string }>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<HiddenStrategy>("opacity");
  const [metrics, setMetrics] = useState<Record<string, SurfaceMetric>>({});
  const [processMetric, setProcessMetric] = useState<PreparedVideoMetrics>();
  const controls = useRef(new Map<string, SurfaceControl>());

  const refreshSources = useCallback(async () => {
    if (!window.electronAPI || !(await window.electronAPI.isDev())) return;
    const metadataEntries: PreparedVideoSourceInfo[] = window.electronAPI.getPreparedVideoSources
      ? await window.electronAPI.getPreparedVideoSources()
      : Object.entries(await window.electronAPI.getMediaCacheMap()).map(([sourceUrl, source]) => ({ source, sourceUrl }));
    const sources = resolvePreparedVideoSources(metadataEntries)
      .filter((source) => isInstantVideoSource(source.source))
      .map((source) => ({ ...source, mediaKey: source.source.replace(/[^a-z0-9]/gi, "-") }));
    setEligible(sources);
    setSelected((current) => current.filter((source) => sources.some((item) => item.source === source)));
    setPrepared((current) => current.filter((source) => sources.some((item) => item.source === source)));
  }, []);

  const refreshMetrics = useCallback(async () => {
    const getMetrics = window.electronAPI?.getPreparedVideoMetrics;
    if (!getMetrics) {
      setProcessMetric(unavailableMetrics("metrics IPC unavailable"));
      return;
    }
    try {
      setProcessMetric(await getMetrics());
    } catch (error) {
      setProcessMetric(unavailableMetrics(`metrics IPC unavailable: ${(error as Error).message}`));
    }
  }, []);

  useEffect(() => {
    void window.electronAPI?.isDev().then(setIsDevElectron);
    void refreshSources();
    void refreshMetrics();
    return window.electronAPI?.subscribePreparedVideoMetrics?.(setProcessMetric);
  }, [refreshMetrics, refreshSources]);

  if (!window.electronAPI || isDevElectron === false) return <main className="p-8">Prepared-surface diagnostics are available only in Electron development mode.</main>;
  const chooseCount = (count: number) => setSelected(selectPreparedVideoSources(eligible, count).map((item) => item.source));
  const selectedSurfaces = eligible.filter((item) => prepared.includes(item.source));
  const selectedCount = selected.length;
  const preparingCount = selectedSurfaces.filter((item) => ["loading", "preparing"].includes(metrics[item.source]?.phase || "loading")).length;
  const readyCount = selectedSurfaces.filter((item) => ["ready", "playing"].includes(metrics[item.source]?.phase || "")).length;
  const errorCount = selectedSurfaces.filter((item) => metrics[item.source]?.phase === "error").length;

  return <main className="mx-auto max-w-5xl space-y-5 p-8 text-white">
    <h1 className="text-2xl font-semibold">Prepared video surface experiment</h1>
    <p className="text-sm text-gray-300">Dev-only. Uses cached finite video sources only; no live display path is involved.</p>
    <div className="flex flex-wrap gap-2">
      {[1, 5, 10, 20, 30].map((count) => <button key={count} className="rounded bg-slate-700 px-3 py-1" onClick={() => chooseCount(count)}>Select {count}</button>)}
      <button className="rounded bg-blue-700 px-3 py-1" onClick={() => setPrepared(selected)}>Prepare selected</button>
      <button className="rounded bg-slate-700 px-3 py-1" onClick={() => setPrepared([])}>Dispose all</button>
      <button className="rounded bg-slate-700 px-3 py-1" onClick={() => void refreshSources()}>Refresh cache</button>
    </div>
    <label className="block text-sm">Hidden strategy <select className="ml-2 text-black" value={strategy} onChange={(event) => setStrategy(event.target.value as HiddenStrategy)}><option value="opacity">opacity 0, composited</option><option value="offscreen">offscreen</option></select></label>
    <p className="text-sm">selected: {selectedCount} · preparing: {preparingCount} · ready: {readyCount} · error: {errorCount}</p>
    <p className="text-sm">renderer private RAM: {formatMetricValue(processMetric?.memory.private, "MB")} · working set: {formatMetricValue(processMetric?.memory.workingSet, "MB")} · CPU: {formatMetricValue(processMetric?.cpu, "%")} · metric status: {processMetric?.status || "not measured yet"}</p>
    <div className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-sm">
      {eligible.map((item) => <label key={item.source} className="block"><input type="checkbox" checked={selected.includes(item.source)} onChange={() => setSelected((current) => current.includes(item.source) ? current.filter((source) => source !== item.source) : [...current, item.source])} /> {item.sourceType} ({getPreparedVideoSourceLabel(item)}) — {item.source}</label>)}
      {!eligible.length && PREPARED_VIDEO_EMPTY_STATE_MESSAGE}
    </div>
    <table className="w-full text-left text-sm"><thead><tr><th>Surface</th><th>State</th><th>Metadata</th><th>First frame</th><th>Ready-to-play</th><th>Actions</th></tr></thead><tbody>{selectedSurfaces.map((item) => {
      const metric = metrics[item.source]; const control = controls.current.get(item.source);
      return <tr key={`${strategy}-${item.source}`}><td>{item.source}</td><td>{metric?.phase ?? "loading"}{metric?.error ? ` — ${metric.error}` : ""}</td><td>{metric?.metadataMs?.toFixed(0) ?? "—"} ms</td><td>{metric?.firstFrameMs?.toFixed(0) ?? "—"} ms</td><td>{metric?.playToPresentedFrameMs?.toFixed(0) ?? "—"} ms</td><td><button onClick={() => control?.play()}>Play</button> <button onClick={() => control?.reset()}>Reset</button> <button onClick={() => setPrepared((current) => current.filter((source) => source !== item.source))}>Dispose</button></td></tr>;
    })}</tbody></table>
    {selectedSurfaces.map((item) => <PreparedSurface key={`${strategy}-${item.source}`} mediaKey={item.mediaKey} source={item.source} strategy={strategy} onControl={(control) => { if (control) controls.current.set(item.source, control); else controls.current.delete(item.source); }} onMetric={(metric) => setMetrics((current) => ({ ...current, [item.source]: metric }))} />)}
  </main>;
};

export default PreparedVideoSurfaces;
