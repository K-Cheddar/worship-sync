export type LocalVideoDiagnosticPath =
  | "DIRECT"
  | "REALTIME_WEBCODECS"
  | "BUFFERED_MSE"
  | "STILL_PREVIEW"
  | "UNAVAILABLE";

export type LocalVideoDecoderLifecycleReason =
  | "INITIAL_CREATE"
  | "SESSION_CHANGED"
  | "CODEC_CONFIG_CHANGED"
  | "DECODER_NOT_CONFIGURED"
  | "QUEUE_OVERFLOW"
  | "DECODER_ERROR"
  | "DECODE_ERROR"
  | "CONFIGURE_FAILURE"
  | "STREAM_STOPPED"
  | "PUBLISHER_LOSS"
  | "SUBSCRIBER_STOP";

export type LocalVideoQualityDemand = {
  subscriberId: string;
  targetWidth: number;
  targetHeight: number;
  cssWidth?: number;
  cssHeight?: number;
  devicePixelRatio?: number;
  outputId?: string;
  windowRole?: string;
  laneRole?: "current" | "previous";
  diagnosticViewId?: string;
};

type DecoderLifecycleEvent = {
  event: "create" | "destroy";
  reason: LocalVideoDecoderLifecycleReason;
  at: string;
  instanceId: string;
  previousInstanceId?: string;
};

type DiagnosticValues = Record<string, number | string | undefined>;

type DiagnosticView = {
  outputId?: string;
  windowRole?: string;
  path: LocalVideoDiagnosticPath;
  previewWarm?: boolean;
  startedAt?: number;
  firstFrameMs?: number;
  canvasSize?: string;
  renderedFrames: number;
  renderedFramesTotal: number;
  decoder: DiagnosticValues;
  decoderInterval: DiagnosticValues;
  decoderInstanceId?: string;
  decoderInstanceStartedAt?: string;
  decoderInstanceResets: number;
  decoderInstanceCount: number;
  lastDecoderResetInstanceId?: string;
  lastDecoderResetAt?: string;
  decoderLifecycle: DecoderLifecycleEvent[];
};

type SourceCounters = {
  callbacks: number;
  callbacksTotal: number;
  presentedFrames: number;
  presentedFramesTotal: number;
  missedFrames: number;
  missedFramesTotal: number;
  width?: number;
  height?: number;
  mediaTime?: number;
};

type SourceDiagnostics = {
  publisher: boolean;
  capture?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  source: SourceCounters;
  sourceInterval: SourceCounters;
  encoder: DiagnosticValues;
  encoderInterval: DiagnosticValues;
  subscribers: number;
  views: Map<string, DiagnosticView>;
  qualityDemands: Map<string, LocalVideoQualityDemand>;
  qualityProfile?: string;
  qualityRequiredWidth?: number;
  qualityRequiredHeight?: number;
  remotePublisher?: RemotePublisherSnapshot;
  updatedAt: number;
};

type RemotePublisherSnapshot = {
  receivedAt: number;
  capture?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  source: SourceCounters;
  sourceInterval: SourceCounters;
  encoder: DiagnosticValues;
  encoderInterval: DiagnosticValues;
  subscribers: number;
  qualityDemands?: LocalVideoQualityDemand[];
  qualityProfile?: string;
  qualityRequiredWidth?: number;
  qualityRequiredHeight?: number;
};

type DiagnosticsMessage = {
  type: "publisher-snapshot";
  senderId: string;
  sourceId: string;
  snapshot: Omit<RemotePublisherSnapshot, "receivedAt">;
};

const STORAGE_KEY = "worshipsync_local_video_debug";
const CHANNEL_NAME = "worshipsync-local-video-diagnostics-v1";
const REPORT_INTERVAL_MS = 1_000;
const SNAPSHOT_TTL_MS = 5_000;
const sources = new Map<string, SourceDiagnostics>();
let reportTimer: number | undefined;
let diagnosticsChannel: BroadcastChannel | undefined;
let environmentReported = false;
const senderId =
  globalThis.crypto?.randomUUID?.() ??
  `diagnostics-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const enabled = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const emptySourceCounters = (): SourceCounters => ({
  callbacks: 0,
  callbacksTotal: 0,
  presentedFrames: 0,
  presentedFramesTotal: 0,
  missedFrames: 0,
  missedFramesTotal: 0,
});

const sourceFor = (sourceId: string): SourceDiagnostics => {
  let source = sources.get(sourceId);
  if (!source) {
    source = {
      publisher: false,
      source: emptySourceCounters(),
      sourceInterval: emptySourceCounters(),
      encoder: {},
      encoderInterval: {},
      subscribers: 0,
      views: new Map(),
      qualityDemands: new Map(),
      updatedAt: Date.now(),
    };
    sources.set(sourceId, source);
  }
  source.updatedAt = Date.now();
  return source;
};

const isDiagnosticsMessage = (value: unknown): value is DiagnosticsMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiagnosticsMessage>;
  return (
    candidate.type === "publisher-snapshot" &&
    typeof candidate.senderId === "string" &&
    candidate.senderId !== senderId &&
    typeof candidate.sourceId === "string" &&
    Boolean(candidate.snapshot)
  );
};

const ensureChannel = () => {
  if (!enabled() || diagnosticsChannel || typeof BroadcastChannel === "undefined") {
    return diagnosticsChannel;
  }
  diagnosticsChannel = new BroadcastChannel(CHANNEL_NAME);
  diagnosticsChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!enabled() || !isDiagnosticsMessage(event.data)) return;
    const message = event.data;
    const source = sourceFor(message.sourceId);
    source.remotePublisher = { ...message.snapshot, receivedAt: Date.now() };
  });
  return diagnosticsChannel;
};

const reportEnvironment = () => {
  if (environmentReported || !enabled()) return;
  environmentReported = true;
  console.info("[LocalVideoPerf] environment", {
    electron: window.process?.versions?.electron,
    chromium: window.process?.versions?.chrome,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    webCodecs:
      typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined",
    mediaStreamTrackProcessor: typeof MediaStreamTrackProcessor !== "undefined",
    videoFrame: typeof VideoFrame !== "undefined",
    requestVideoFrameCallback:
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function",
  });
};

const increment = (
  values: DiagnosticValues,
  interval: DiagnosticValues,
  key: string,
  value: number,
) => {
  values[key] = Number(values[key] ?? 0) + value;
  interval[key] = Number(interval[key] ?? 0) + value;
};

const setMetric = (
  values: DiagnosticValues,
  interval: DiagnosticValues,
  key: string,
  value: number | string,
) => {
  values[key] = value;
  interval[key] = value;
};

const maxMetric = (
  values: DiagnosticValues,
  interval: DiagnosticValues,
  key: string,
  value: number,
) => {
  values[key] = Math.max(Number(values[key] ?? 0), value);
  interval[key] = Math.max(Number(interval[key] ?? 0), value);
};

const copyCounters = (counters: SourceCounters): SourceCounters => ({ ...counters });

const resetIntervalCounters = (source: SourceDiagnostics) => {
  source.sourceInterval = emptySourceCounters();
  source.encoderInterval = {};
  source.views.forEach((view) => {
    view.decoderInterval = {};
    view.renderedFrames = 0;
  });
};

const sourceSnapshotFor = (source: SourceDiagnostics): Omit<RemotePublisherSnapshot, "receivedAt"> => ({
  capture: source.capture,
  constraints: source.constraints,
  source: copyCounters(source.source),
  sourceInterval: copyCounters(source.sourceInterval),
  encoder: { ...source.encoder },
  encoderInterval: { ...source.encoderInterval },
  subscribers: source.subscribers,
  qualityDemands: [...source.qualityDemands.values()],
  qualityProfile: source.qualityProfile,
  qualityRequiredWidth: source.qualityRequiredWidth,
  qualityRequiredHeight: source.qualityRequiredHeight,
});

const report = () => {
  if (!enabled()) return;
  reportEnvironment();
  ensureChannel();
  const now = Date.now();
  const reportSources = [...sources.entries()].flatMap(([sourceId, source]) => {
    const remote = source.remotePublisher;
    if (remote && now - remote.receivedAt > SNAPSHOT_TTL_MS) {
      source.remotePublisher = undefined;
    }
    const publisher = source.remotePublisher ?? {
      capture: source.capture,
      constraints: source.constraints,
      source: source.source,
      sourceInterval: source.sourceInterval,
      encoder: source.encoder,
      encoderInterval: source.encoderInterval,
      subscribers: source.subscribers,
      qualityDemands: [...source.qualityDemands.values()],
      qualityProfile: source.qualityProfile,
      qualityRequiredWidth: source.qualityRequiredWidth,
      qualityRequiredHeight: source.qualityRequiredHeight,
    };
    const consumers = [...source.views.entries()].map(([viewId, view]) => ({
      viewId,
      role: view.windowRole ?? "unknown",
      outputId: view.outputId ?? "",
      path: view.path,
      previewWarm: view.previewWarm ?? false,
      firstFrame: view.firstFrameMs === undefined ? "pending" : `${view.firstFrameMs}ms`,
      canvas: view.canvasSize ?? "",
      receivedChunkFps: Number(view.decoderInterval.chunks ?? 0),
      decodedFrameFps: Number(view.decoderInterval.frames ?? 0),
      paintedFps: view.renderedFrames,
      decoderQueueMax: Number(view.decoderInterval.queueMax ?? 0),
      decodeChunksDroppedForLatencyInterval: Number(
        view.decoderInterval.droppedForLatency ?? 0,
      ),
      decodeChunksDroppedForLatencyTotal: Number(
        view.decoder.droppedForLatency ?? 0,
      ),
      decoderResetsInterval: Number(view.decoderInterval.resets ?? 0),
      decoderResetsTotal: Number(view.decoder.resets ?? 0),
      decoderHardResetsInterval: Number(view.decoderInterval.hardResets ?? 0),
      decoderHardResetsTotal: Number(view.decoder.hardResets ?? 0),
      keyframeWaitInterval: Number(view.decoderInterval.skippedKeyframe ?? 0),
      keyframeWaitTotal: Number(view.decoder.skippedKeyframe ?? 0),
      keyframeWaitEventsInterval: Number(view.decoderInterval.keyframeWaits ?? 0),
      keyframeWaitEventsTotal: Number(view.decoder.keyframeWaits ?? 0),
      keyframeWaitMsInterval: Number(view.decoderInterval.keyframeWaitMs ?? 0),
      keyframeWaitMsTotal: Number(view.decoder.keyframeWaitMs ?? 0),
      decoderInstanceId: view.decoderInstanceId ?? "",
      decoderInstanceStartedAt: view.decoderInstanceStartedAt ?? "",
      decoderInstanceResets: view.decoderInstanceResets,
      decoderInstanceCount: view.decoderInstanceCount,
      lastDecoderResetInstanceId: view.lastDecoderResetInstanceId ?? "",
      lastDecoderResetAt: view.lastDecoderResetAt ?? "",
      decoderLifecycle: view.decoderLifecycle,
    }));
    const captureSettings = publisher.capture?.settings as
      | { width?: number; height?: number; frameRate?: number }
      | undefined;
    const captureMode =
      captureSettings?.width && captureSettings.height
        ? `${captureSettings.width}x${captureSettings.height} @ ${captureSettings.frameRate ?? "?"}fps`
        : "unknown";
    const measuredSourceFps = publisher.sourceInterval.presentedFrames;
    const configuredSourceFps = Number(captureSettings?.frameRate);
    if (
      measuredSourceFps > 0 &&
      Number.isFinite(configuredSourceFps) &&
      measuredSourceFps > configuredSourceFps * 1.2 + 2
    ) {
      console.warn("[LocalVideoPerf] source rate exceeds capture settings", {
        sourceId,
        measuredSourceFps,
        configuredSourceFps,
        callbackFps: publisher.sourceInterval.callbacks,
      });
    }
    const result = {
      sourceId,
      deviceLabel: publisher.capture?.deviceLabel ?? "",
      capture: captureMode,
      requestedProfile: publisher.constraints?.profile ?? "",
      sourceCallbackFps: publisher.sourceInterval.callbacks,
      sourceFps: publisher.sourceInterval.presentedFrames,
      sourceFramesTotal: publisher.source.presentedFramesTotal,
      sourceMissedFramesInterval: publisher.sourceInterval.missedFrames,
      sourceMissedFramesTotal: publisher.source.missedFramesTotal,
      encoderFps: Number(publisher.encoderInterval.submitted ?? 0),
      encoderSubmittedTotal: Number(publisher.encoder.submitted ?? 0),
      encoderDropsInterval: Number(publisher.encoderInterval.dropped ?? 0),
      encoderDropsTotal: Number(publisher.encoder.dropped ?? 0),
      encoderQueueMax: Number(publisher.encoderInterval.queueMax ?? 0),
      encoderQueueHighWaterTotal: Number(publisher.encoder.queueMax ?? 0),
      encodedChunksInterval: Number(publisher.encoderInterval.chunks ?? 0),
      encodedChunksTotal: Number(publisher.encoder.chunks ?? 0),
      qualityProfile: publisher.qualityProfile ?? "",
      qualityRequired: publisher.qualityRequiredWidth
        ? `${publisher.qualityRequiredWidth}x${publisher.qualityRequiredHeight}`
        : "",
      qualityDemands: publisher.qualityDemands ?? [],
      subscribers: publisher.subscribers,
      consumers,
    };
    if (source.publisher) {
      ensureChannel()?.postMessage({
        type: "publisher-snapshot",
        senderId,
        sourceId,
        snapshot: sourceSnapshotFor(source),
      } satisfies DiagnosticsMessage);
    }
    return [result];
  });
  if (reportSources.length > 0) {
    console.info("[LocalVideoPerf] report", JSON.stringify({ generatedAt: new Date().toISOString(), sources: reportSources }));
  }
  sources.forEach(resetIntervalCounters);
};

const ensureReporting = () => {
  if (!enabled() || reportTimer !== undefined) return;
  ensureChannel();
  reportEnvironment();
  reportTimer = window.setInterval(report, REPORT_INTERVAL_MS);
};

export const localVideoDiagnosticsEnabled = enabled;

export const recordLocalVideoCapture = (sourceId: string, capture: Record<string, unknown>) => {
  if (!enabled()) return;
  sourceFor(sourceId).capture = { capturedAt: new Date().toISOString(), ...capture };
  ensureReporting();
};

export const recordLocalVideoConstraints = (sourceId: string, constraints: Record<string, unknown>) => {
  if (!enabled()) return;
  sourceFor(sourceId).constraints = constraints;
  ensureReporting();
};

export const recordLocalVideoSourceFrame = (
  sourceId: string,
  presentedDelta = 1,
  values?: { width: number; height: number; mediaTime: number },
) => {
  if (!enabled()) return;
  const source = sourceFor(sourceId);
  source.publisher = true;
  source.source.presentedFrames += presentedDelta;
  source.source.presentedFramesTotal += presentedDelta;
  source.source.missedFrames += Math.max(0, presentedDelta - 1);
  source.source.missedFramesTotal += Math.max(0, presentedDelta - 1);
  source.sourceInterval.presentedFrames += presentedDelta;
  source.sourceInterval.presentedFramesTotal += presentedDelta;
  source.sourceInterval.missedFrames += Math.max(0, presentedDelta - 1);
  source.sourceInterval.missedFramesTotal += Math.max(0, presentedDelta - 1);
  if (values) {
    Object.assign(source.source, values);
    Object.assign(source.sourceInterval, values);
  }
  ensureReporting();
};

export const recordLocalVideoSourceCallback = (
  sourceId: string,
  values?: { width: number; height: number; mediaTime: number },
) => {
  if (!enabled()) return;
  const source = sourceFor(sourceId);
  source.publisher = true;
  source.source.callbacks += 1;
  source.source.callbacksTotal += 1;
  source.sourceInterval.callbacks += 1;
  source.sourceInterval.callbacksTotal += 1;
  if (values) {
    Object.assign(source.source, values);
    Object.assign(source.sourceInterval, values);
  }
  ensureReporting();
};

export const recordLocalVideoEncoder = (sourceId: string, values: DiagnosticValues) => {
  if (!enabled()) return;
  const source = sourceFor(sourceId);
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) return;
    if (["dropped", "submitted", "chunks", "keyframes", "reconfigures"].includes(key)) {
      increment(source.encoder, source.encoderInterval, key, Number(value));
    } else if (key === "queueMax") {
      maxMetric(source.encoder, source.encoderInterval, key, Number(value));
    } else {
      setMetric(source.encoder, source.encoderInterval, key, value);
    }
  });
  ensureReporting();
};

export const recordLocalVideoDecoder = (
  sourceId: string,
  viewId: string,
  values: DiagnosticValues,
) => {
  if (!enabled()) return;
  const view = sourceFor(sourceId).views.get(viewId);
  if (!view) return;
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) return;
    if (
      [
        "submitted",
        "resets",
        "frames",
        "chunks",
        "skippedKeyframe",
        "keyframeWaits",
        "keyframeWaitMs",
      ].includes(key)
    ) {
      increment(view.decoder, view.decoderInterval, key, Number(value));
      if (key === "resets") {
        view.decoderInstanceResets += Number(value);
        view.lastDecoderResetInstanceId = view.decoderInstanceId;
        view.lastDecoderResetAt = new Date().toISOString();
      }
    } else if (key === "queueMax") {
      maxMetric(view.decoder, view.decoderInterval, key, Number(value));
    } else {
      setMetric(view.decoder, view.decoderInterval, key, value);
    }
  });
  ensureReporting();
};

export const setLocalVideoDecoderInstance = (
  sourceId: string,
  viewId: string,
  instanceId: string,
) => {
  if (!enabled()) return;
  const view = sourceFor(sourceId).views.get(viewId);
  if (!view) return;
  view.decoderInstanceId = instanceId;
  view.decoderInstanceStartedAt = new Date().toISOString();
  view.decoderInstanceResets = 0;
  view.decoderInstanceCount += 1;
  ensureReporting();
};

export const recordLocalVideoDecoderLifecycle = (
  sourceId: string,
  viewId: string,
  event: Omit<DecoderLifecycleEvent, "at">,
) => {
  if (!enabled()) return;
  const view = sourceFor(sourceId).views.get(viewId);
  if (!view) return;
  view.decoderLifecycle.push({ ...event, at: new Date().toISOString() });
  if (view.decoderLifecycle.length > 100) view.decoderLifecycle.shift();
  ensureReporting();
};

export const recordLocalVideoQualityDemand = (
  sourceId: string,
  demand: LocalVideoQualityDemand,
) => {
  if (!enabled()) return;
  sourceFor(sourceId).qualityDemands.set(demand.subscriberId, demand);
  ensureReporting();
};

export const removeLocalVideoQualityDemand = (
  sourceId: string,
  subscriberId: string,
) => {
  if (!enabled()) return;
  sourceFor(sourceId).qualityDemands.delete(subscriberId);
  ensureReporting();
};

export const recordLocalVideoQualityProfile = (
  sourceId: string,
  profile: { id: string; width: number; height: number },
) => {
  if (!enabled()) return;
  const source = sourceFor(sourceId);
  source.qualityProfile = profile.id;
  source.qualityRequiredWidth = profile.width;
  source.qualityRequiredHeight = profile.height;
  ensureReporting();
};

export const setLocalVideoSubscriberCount = (sourceId: string, subscribers: number) => {
  if (!enabled()) return;
  sourceFor(sourceId).subscribers = subscribers;
  ensureReporting();
};

export const startLocalVideoView = (
  sourceId: string,
  viewId: string,
  view: Omit<DiagnosticView, "startedAt" | "firstFrameMs" | "canvasSize" | "renderedFrames" | "renderedFramesTotal" | "decoder" | "decoderInterval" | "decoderInstanceResets" | "decoderInstanceCount" | "decoderLifecycle">,
) => {
  if (!enabled()) return;
  sourceFor(sourceId).views.set(viewId, {
    ...view,
    startedAt: performance.now(),
    renderedFrames: 0,
    renderedFramesTotal: 0,
    decoder: {},
    decoderInterval: {},
    decoderInstanceResets: 0,
    decoderInstanceCount: 0,
    decoderLifecycle: [],
  });
  ensureReporting();
};

export const updateLocalVideoView = (sourceId: string, viewId: string, values: Partial<DiagnosticView>) => {
  if (!enabled()) return;
  const view = sourceFor(sourceId).views.get(viewId);
  if (!view) return;
  Object.assign(view, values);
  ensureReporting();
};

export const markLocalVideoViewFrame = (sourceId: string, viewId: string, canvasSize?: string) => {
  if (!enabled()) return;
  const view = sourceFor(sourceId).views.get(viewId);
  if (!view) return;
  view.renderedFrames += 1;
  view.renderedFramesTotal += 1;
  if (canvasSize) view.canvasSize = canvasSize;
  if (view.firstFrameMs === undefined && view.startedAt !== undefined) {
    view.firstFrameMs = Math.round(performance.now() - view.startedAt);
  }
};

export const stopLocalVideoView = (sourceId: string, viewId: string) => {
  if (!enabled()) return;
  const source = sources.get(sourceId);
  source?.views.delete(viewId);
  if (source && source.views.size === 0 && !source.capture && !source.remotePublisher) {
    sources.delete(sourceId);
  }
};

export const __resetLocalVideoDiagnosticsForTests = () => {
  if (reportTimer !== undefined) window.clearInterval(reportTimer);
  reportTimer = undefined;
  diagnosticsChannel?.close();
  diagnosticsChannel = undefined;
  environmentReported = false;
  sources.clear();
};

export const __getLocalVideoDiagnosticsForTests = () => sources;
