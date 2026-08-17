import { reportLocalVideoIssue } from "./localVideoIssues";

const CHANNEL_NAME = "worshipsync-local-video-media-v1";
const CHUNK_INTERVAL_MS = 50;
const HEARTBEAT_MS = 2_000;
const SUBSCRIBER_TTL_MS = 6_000;
const VIDEO_BITS_PER_SECOND = 10_000_000;
const AUDIO_BITS_PER_SECOND = 192_000;
const PUBLISHER_LOSS_GRACE_MS = 15_000;
const MAX_PENDING_CHUNKS = 100;
const BUFFER_RETENTION_SECONDS = 6;
const TARGET_LIVE_LATENCY_SECONDS = 0.04;
const CATCH_UP_LATENCY_SECONDS = 0.07;
const MAX_LIVE_LATENCY_SECONDS = 0.12;
const CATCH_UP_PLAYBACK_RATE = 1.08;

type RelayMessage = {
  type:
    | "subscribe"
    | "unsubscribe"
    | "publisher-ready"
    | "stream-start"
    | "stream-chunk"
    | "stream-stopped"
    | "stream-error";
  sourceId: string;
  subscriberId?: string;
  sessionId?: string;
  sentAt?: number;
  mimeType?: string;
  chunk?: Blob;
  detail?: string;
  audioEnabled?: boolean;
};

type PublisherSession = {
  recorder: MediaRecorder;
  sessionId: string;
  subscribers: Set<string>;
  initializationChunk?: Blob;
};

type SubscriberOptions = {
  onError?: (detail: string) => void;
  onStarted?: () => void;
  onStopped?: () => void;
  includeAudio?: boolean;
};

const createId = (prefix: string) =>
  globalThis.crypto?.randomUUID?.() ??
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isRelayMessage = (value: unknown): value is RelayMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayMessage>;
  return (
    typeof candidate.sourceId === "string" &&
    (candidate.type === "subscribe" ||
      candidate.type === "unsubscribe" ||
      candidate.type === "publisher-ready" ||
      candidate.type === "stream-start" ||
      candidate.type === "stream-chunk" ||
      candidate.type === "stream-stopped" ||
      candidate.type === "stream-error")
  );
};

const selectMimeType = () => {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );
};

/**
 * Encodes one stream regardless of the number of display windows. Each
 * subscriber has an independent MSE buffer and controls sound through its
 * video element, while projector + monitor + stream share the encoder.
 */
export const publishLocalVideoMedia = (
  sourceId: string,
  stream: MediaStream,
) => {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscribers = new Map<string, number>();
  let session: PublisherSession | undefined;
  let active = true;

  const post = (message: RelayMessage) => {
    if (active) channel.postMessage(message);
  };

  const postToSession = (
    session: PublisherSession,
    message: Omit<RelayMessage, "sourceId" | "subscriberId" | "sessionId">,
  ) => {
    session.subscribers.forEach((subscriberId) => {
      post({
        ...message,
        sourceId,
        subscriberId,
        sessionId: session.sessionId,
      });
    });
  };

  const stopSession = (notify = true) => {
    const currentSession = session;
    if (!currentSession) return;
    session = undefined;
    if (currentSession.recorder.state !== "inactive") {
      currentSession.recorder.stop();
    }
    if (notify) {
      postToSession(currentSession, { type: "stream-stopped" });
    }
  };

  const createSession = () => {
    const mimeType = selectMimeType();
    if (!mimeType || typeof MediaRecorder === "undefined") {
      post({
        type: "stream-error",
        sourceId,
        detail:
          "High-quality local video is not supported in this app version.",
      });
      return undefined;
    }
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      const sessionId = createId("media");
      const nextSession: PublisherSession = {
        recorder,
        sessionId,
        subscribers: new Set<string>(),
      };
      session = nextSession;
      recorder.addEventListener("start", () => {
        postToSession(nextSession, {
          type: "stream-start",
          mimeType: recorder.mimeType || mimeType,
        });
      });
      recorder.addEventListener("dataavailable", (event) => {
        if (!active || event.data.size === 0) return;
        nextSession.initializationChunk ??= event.data;
        postToSession(nextSession, {
          type: "stream-chunk",
          chunk: event.data,
        });
      });
      recorder.addEventListener("error", () => {
        postToSession(nextSession, {
          type: "stream-error",
          detail: "The local video relay stopped. Check the input connection.",
        });
        stopSession(false);
      });
      return nextSession;
    } catch {
      post({
        type: "stream-error",
        sourceId,
        detail:
          "The local video relay could not start. Try relinking the input.",
      });
      return undefined;
    }
  };

  const removeSubscriber = (subscriberId: string, notify = true) => {
    if (!subscribers.has(subscriberId)) return;
    subscribers.delete(subscriberId);
    const currentSession = session;
    if (!currentSession) return;
    if (notify) {
      post({
        type: "stream-stopped",
        sourceId,
        subscriberId,
        sessionId: currentSession.sessionId,
      });
    }
    currentSession.subscribers.delete(subscriberId);
    if (currentSession.subscribers.size === 0) {
      stopSession(false);
    }
  };

  const startSubscriber = (subscriberId: string) => {
    if (subscribers.has(subscriberId)) {
      subscribers.set(subscriberId, Date.now());
      return;
    }
    subscribers.set(subscriberId, Date.now());

    let currentSession = session;
    const isNewSession = !currentSession;
    currentSession ??= createSession();
    if (!currentSession) {
      subscribers.delete(subscriberId);
      return;
    }
    currentSession.subscribers.add(subscriberId);
    if (isNewSession) {
      currentSession.recorder.start(CHUNK_INTERVAL_MS);
      return;
    }
    post({
      type: "stream-start",
      sourceId,
      subscriberId,
      sessionId: currentSession.sessionId,
      mimeType: currentSession.recorder.mimeType,
    });
    if (currentSession.initializationChunk) {
      post({
        type: "stream-chunk",
        sourceId,
        subscriberId,
        sessionId: currentSession.sessionId,
        chunk: currentSession.initializationChunk,
      });
    }
  };

  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      !active ||
      !isRelayMessage(message) ||
      message.sourceId !== sourceId ||
      !message.subscriberId
    ) {
      return;
    }
    if (message.type === "subscribe") {
      startSubscriber(message.subscriberId);
    }
    if (message.type === "unsubscribe") removeSubscriber(message.subscriberId);
  });

  const cleanupTimer = window.setInterval(() => {
    const staleBefore = Date.now() - SUBSCRIBER_TTL_MS;
    subscribers.forEach((lastSeenAt, subscriberId) => {
      if (lastSeenAt < staleBefore) {
        removeSubscriber(subscriberId, false);
      }
    });
    // Subscribers use this heartbeat only after they have observed a working
    // publisher. A display restored before the hidden capture host has booted
    // must not turn normal startup latency into a controller warning.
    post({ type: "publisher-ready", sourceId });
  }, HEARTBEAT_MS);
  post({ type: "publisher-ready", sourceId });

  return () => {
    window.clearInterval(cleanupTimer);
    stopSession();
    subscribers.clear();
    active = false;
    channel.close();
  };
};

/** Attach an encoded browser-local A/V relay to an output video element. */
export const subscribeLocalVideoMedia = (
  sourceId: string,
  video: HTMLVideoElement,
  options: SubscriberOptions = {},
) => {
  if (
    typeof BroadcastChannel === "undefined" ||
    typeof MediaSource === "undefined"
  ) {
    const detail =
      "High-quality local video is not supported in this app version.";
    options.onError?.(detail);
    reportLocalVideoIssue(sourceId, detail);
    return () => undefined;
  }
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscriberId = createId("display");
  let active = true;
  let sessionId: string | undefined;
  let mediaSource: MediaSource | undefined;
  let sourceBuffer: SourceBuffer | undefined;
  let objectUrl: string | undefined;
  let appendChain = Promise.resolve();
  const pendingChunks: ArrayBuffer[] = [];
  const reportError = (detail: string) => {
    options.onError?.(detail);
    reportLocalVideoIssue(sourceId, detail);
  };
  let hasObservedPublisher = false;
  let lastPublisherActivityAt = 0;
  let publisherLossReported = false;
  const markPublisherActivity = () => {
    hasObservedPublisher = true;
    lastPublisherActivityAt = Date.now();
    publisherLossReported = false;
  };

  const syncToLiveEdge = () => {
    if (!sourceBuffer || sourceBuffer.buffered.length === 0) return;
    const lastRange = sourceBuffer.buffered.length - 1;
    const rangeStart = sourceBuffer.buffered.start(lastRange);
    const liveEdge = sourceBuffer.buffered.end(lastRange);
    const targetTime = Math.max(
      rangeStart,
      liveEdge - TARGET_LIVE_LATENCY_SECONDS,
    );
    const lag = liveEdge - video.currentTime;
    const outsideBufferedRange =
      !Number.isFinite(video.currentTime) ||
      video.currentTime < rangeStart ||
      video.currentTime > liveEdge;
    if (outsideBufferedRange || lag > MAX_LIVE_LATENCY_SECONDS) {
      video.currentTime = targetTime;
      video.playbackRate = 1;
    } else {
      // MSE playback can settle a frame or two behind the append edge without
      // ever crossing the hard-seek threshold. Briefly run slightly fast so
      // that small drift is removed instead of becoming visible programme
      // delay, then return to normal speed at the live edge.
      video.playbackRate =
        lag > CATCH_UP_LATENCY_SECONDS ? CATCH_UP_PLAYBACK_RATE : 1;
    }
    if (video.paused) void video.play().catch(() => undefined);
  };

  const appendNext = () => {
    if (!active || !sourceBuffer || sourceBuffer.updating) return;
    if (
      sourceBuffer.buffered.length > 0 &&
      video.currentTime > BUFFER_RETENTION_SECONDS * 2 &&
      sourceBuffer.buffered.start(0) <
        video.currentTime - BUFFER_RETENTION_SECONDS
    ) {
      try {
        sourceBuffer.remove(0, video.currentTime - BUFFER_RETENTION_SECONDS);
        return;
      } catch {
        // Appending can continue even if an implementation declines trimming.
      }
    }
    const chunk = pendingChunks.shift();
    if (!chunk) return;
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch {
      reportError("The local video relay lost sync. Send the slide again.");
    }
  };

  const resetMediaSource = () => {
    pendingChunks.length = 0;
    sourceBuffer = undefined;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    video.playbackRate = 1;
    video.removeAttribute("src");
    video.load();
  };

  const startMediaSource = (nextSessionId: string, mimeType: string) => {
    markPublisherActivity();
    resetMediaSource();
    sessionId = nextSessionId;
    if (!MediaSource.isTypeSupported(mimeType)) {
      reportError("This display cannot decode the local video format.");
      return;
    }
    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    video.src = objectUrl;
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (!active || mediaSource?.readyState !== "open") return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          sourceBuffer.mode = "sequence";
          sourceBuffer.addEventListener("updateend", () => {
            syncToLiveEdge();
            appendNext();
          });
          appendNext();
          options.onStarted?.();
        } catch {
          reportError("This display could not start the local video relay.");
        }
      },
      { once: true },
    );
  };

  const announce = () => {
    if (!active) return;
    channel.postMessage({
      type: "subscribe",
      sourceId,
      subscriberId,
      sentAt: Date.now(),
      audioEnabled: options.includeAudio === true,
    } satisfies RelayMessage);
  };

  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      !active ||
      !isRelayMessage(message) ||
      message.sourceId !== sourceId ||
      (message.subscriberId && message.subscriberId !== subscriberId)
    ) {
      return;
    }
    if (message.type === "publisher-ready") {
      markPublisherActivity();
      announce();
    }
    if (
      message.type === "stream-start" &&
      message.sessionId &&
      message.mimeType
    ) {
      startMediaSource(message.sessionId, message.mimeType);
    }
    if (
      message.type === "stream-chunk" &&
      message.sessionId === sessionId &&
      message.chunk
    ) {
      markPublisherActivity();
      appendChain = appendChain.then(async () => {
        const data = await message.chunk!.arrayBuffer();
        if (!active || message.sessionId !== sessionId) return;
        if (pendingChunks.length >= MAX_PENDING_CHUNKS) {
          pendingChunks.splice(0, pendingChunks.length);
          reportError(
            "This display fell behind the local video feed. Send the slide again.",
          );
          return;
        }
        pendingChunks.push(data);
        appendNext();
      });
    }
    if (message.type === "stream-error" && message.detail) {
      markPublisherActivity();
      reportError(message.detail);
    }
    if (message.type === "stream-stopped" && message.sessionId === sessionId) {
      sessionId = undefined;
      options.onStopped?.();
      resetMediaSource();
      announce();
    }
  });

  announce();
  const heartbeat = window.setInterval(announce, HEARTBEAT_MS);
  const publisherHealthCheck = window.setInterval(() => {
    if (
      !active ||
      !hasObservedPublisher ||
      publisherLossReported ||
      Date.now() - lastPublisherActivityAt < PUBLISHER_LOSS_GRACE_MS
    ) {
      return;
    }
    publisherLossReported = true;
    const hadActiveSession = Boolean(sessionId);
    sessionId = undefined;
    if (hadActiveSession) options.onStopped?.();
    resetMediaSource();
    reportError(
      "The local video publisher stopped. Check the input on this controller.",
    );
  }, HEARTBEAT_MS);

  return () => {
    active = false;
    window.clearInterval(heartbeat);
    window.clearInterval(publisherHealthCheck);
    channel.postMessage({
      type: "unsubscribe",
      sourceId,
      subscriberId,
    } satisfies RelayMessage);
    resetMediaSource();
    channel.close();
  };
};
