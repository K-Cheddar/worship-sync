import { reportLocalVideoIssue } from "./localVideoIssues";
import { getLocalVideoRealtimeBitrate } from "./localVideoQuality";

const CHANNEL_NAME = "worshipsync-local-video-realtime-v1";
const HEARTBEAT_MS = 2_000;
const SUBSCRIBER_TTL_MS = 6_000;
const PUBLISHER_LOSS_GRACE_MS = 15_000;
const FIRST_FRAME_FALLBACK_MS = 8_000;
const MAX_VIDEO_FRAMERATE = 60;
const MAX_ENCODE_QUEUE = 2;
const MAX_DECODE_QUEUE = 2;
const KEY_FRAME_INTERVAL_MS = 1_000;
const AUDIO_BUFFER_SIZE = 1_024;
const AUDIO_START_LEAD_SECONDS = 0.025;
const MAX_AUDIO_LEAD_SECONDS = 0.12;

type SerializedVideoChunk = {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration?: number;
  data: ArrayBuffer;
};

type RealtimeRelayMessage = {
  type:
    | "subscribe"
    | "unsubscribe"
    | "publisher-ready"
    | "stream-start"
    | "video-chunk"
    | "audio-frame"
    | "request-key-frame"
    | "stream-stopped"
    | "stream-error";
  sourceId: string;
  subscriberId?: string;
  sessionId?: string;
  sentAt?: number;
  includeAudio?: boolean;
  videoConfig?: VideoDecoderConfig;
  videoChunk?: SerializedVideoChunk;
  sampleRate?: number;
  audioChannels?: ArrayBuffer[];
  detail?: string;
  fallback?: boolean;
};

type RealtimeSubscriberOptions = {
  includeAudio?: boolean;
  volume?: number;
  onError?: (detail: string) => void;
  onFallback?: () => void;
  onStarted?: () => void;
  onStopped?: () => void;
};

export type LocalVideoRealtimeSubscription = {
  stop: () => void;
  setVolume: (volume: number) => void;
  setAudioEnabled: (enabled: boolean) => void;
};

type SubscriberState = {
  lastSeenAt: number;
  includeAudio: boolean;
};

const createId = (prefix: string) =>
  globalThis.crypto?.randomUUID?.() ??
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isRelayMessage = (value: unknown): value is RealtimeRelayMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RealtimeRelayMessage>;
  return (
    typeof candidate.sourceId === "string" &&
    (candidate.type === "subscribe" ||
      candidate.type === "unsubscribe" ||
      candidate.type === "publisher-ready" ||
      candidate.type === "stream-start" ||
      candidate.type === "video-chunk" ||
      candidate.type === "audio-frame" ||
      candidate.type === "request-key-frame" ||
      candidate.type === "stream-stopped" ||
      candidate.type === "stream-error")
  );
};

const normalizeVolume = (volume: number) =>
  Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));

const getDecoderConfigKey = (config: VideoDecoderConfig) =>
  [
    config.codec,
    config.codedWidth,
    config.codedHeight,
    config.displayAspectWidth,
    config.displayAspectHeight,
  ].join(":");

/** Electron-only, zero-network realtime primitives used by the shared relay. */
export const supportsLocalVideoRealtimeRelay = () =>
  Boolean(
    window.__ELECTRON__ &&
    typeof BroadcastChannel !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function",
  );

/**
 * Encode one low-latency VP8 stream and broadcast it to every Electron output.
 * Audio is sent as short PCM blocks so it avoids MSE buffering while retaining
 * per-screen mute and volume control.
 */
export const publishLocalVideoRealtime = (
  sourceId: string,
  video: HTMLVideoElement,
  stream: MediaStream,
) => {
  if (!supportsLocalVideoRealtimeRelay()) return () => undefined;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const sessionId = createId("realtime");
  const subscribers = new Map<string, SubscriberState>();
  let active = true;
  let encoder: VideoEncoder | undefined;
  let decoderConfig: VideoDecoderConfig | undefined;
  let frameCallbackId: number | undefined;
  let forceKeyFrame = true;
  let lastKeyFrameAt = 0;
  let audioContext: AudioContext | undefined;
  let audioSource: MediaStreamAudioSourceNode | undefined;
  let audioProcessor: ScriptProcessorNode | undefined;
  let silentGain: GainNode | undefined;
  const videoTrack = stream.getVideoTracks()[0];

  const post = (message: RealtimeRelayMessage) => {
    if (active) channel.postMessage(message);
  };

  const hasAudioSubscribers = () =>
    [...subscribers.values()].some((subscriber) => subscriber.includeAudio);

  const sendStart = (subscriberId: string) => {
    if (!decoderConfig) return;
    post({
      type: "stream-start",
      sourceId,
      subscriberId,
      sessionId,
      videoConfig: decoderConfig,
      includeAudio: stream.getAudioTracks().length > 0,
    });
    forceKeyFrame = true;
  };

  const reportPublisherError = (detail: string, fallback = false) => {
    post({
      type: "stream-error",
      sourceId,
      sessionId,
      detail,
      fallback,
    });
  };

  const startAudioPublisher = () => {
    if (audioContext || stream.getAudioTracks().length === 0) return;
    try {
      audioContext = new AudioContext({ latencyHint: "interactive" });
      const audioStream = new MediaStream(stream.getAudioTracks());
      audioSource = audioContext.createMediaStreamSource(audioStream);
      audioProcessor = audioContext.createScriptProcessor(
        AUDIO_BUFFER_SIZE,
        2,
        2,
      );
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      audioProcessor.onaudioprocess = (event) => {
        if (!active || !hasAudioSubscribers()) return;
        const input = event.inputBuffer;
        const audioChannels = Array.from(
          { length: input.numberOfChannels },
          (_, channelIndex) =>
            input.getChannelData(channelIndex).slice().buffer,
        );
        post({
          type: "audio-frame",
          sourceId,
          sessionId,
          sampleRate: input.sampleRate,
          audioChannels,
        });
      };
      audioSource.connect(audioProcessor);
      audioProcessor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      void audioContext.resume().catch(() => undefined);
    } catch {
      reportPublisherError(
        "Realtime sound could not start. Video will continue without sound.",
      );
    }
  };

  const configureEncoder = (width: number, height: number) => {
    if (encoder?.state !== "closed") encoder?.close();
    const sourceFrameRate =
      videoTrack?.getSettings().frameRate ?? MAX_VIDEO_FRAMERATE;
    const frameRate = Math.min(MAX_VIDEO_FRAMERATE, sourceFrameRate);
    const config: VideoEncoderConfig = {
      codec: "vp8",
      width,
      height,
      displayWidth: width,
      displayHeight: height,
      bitrate: getLocalVideoRealtimeBitrate(width, height, frameRate),
      framerate: frameRate,
      hardwareAcceleration: "no-preference",
      latencyMode: "realtime",
    };
    decoderConfig = {
      codec: config.codec,
      codedWidth: width,
      codedHeight: height,
      displayAspectWidth: width,
      displayAspectHeight: height,
      hardwareAcceleration: "no-preference",
      optimizeForLatency: true,
    };
    try {
      encoder = new VideoEncoder({
        output: (chunk) => {
          if (!active || subscribers.size === 0) return;
          const data = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(data);
          post({
            type: "video-chunk",
            sourceId,
            sessionId,
            videoChunk: {
              type: chunk.type,
              timestamp: chunk.timestamp,
              ...(chunk.duration !== null ? { duration: chunk.duration } : {}),
              data,
            },
          });
        },
        error: () => {
          reportPublisherError(
            "Realtime video could not continue. Using the compatibility relay.",
            true,
          );
        },
      });
      encoder.configure(config);
      subscribers.forEach((_subscriber, subscriberId) =>
        sendStart(subscriberId),
      );
    } catch {
      encoder?.close();
      encoder = undefined;
      decoderConfig = undefined;
      reportPublisherError(
        "Realtime video is not supported on this device. Using the compatibility relay.",
        true,
      );
    }
  };

  const processVideoFrame: VideoFrameRequestCallback = (now, metadata) => {
    if (!active) return;
    frameCallbackId = video.requestVideoFrameCallback(processVideoFrame);
    if (
      subscribers.size === 0 ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      return;
    }
    const encodedWidth = decoderConfig?.codedWidth;
    const encodedHeight = decoderConfig?.codedHeight;
    if (
      !encoder ||
      encodedWidth !== video.videoWidth ||
      encodedHeight !== video.videoHeight
    ) {
      configureEncoder(video.videoWidth, video.videoHeight);
    }
    if (!encoder || encoder.state !== "configured") return;
    if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) return;

    let frame: VideoFrame | undefined;
    try {
      frame = new VideoFrame(video, {
        timestamp: Math.max(0, Math.round(metadata.mediaTime * 1_000_000)),
      });
      const keyFrame =
        forceKeyFrame || now - lastKeyFrameAt >= KEY_FRAME_INTERVAL_MS;
      encoder.encode(frame, { keyFrame });
      if (keyFrame) {
        forceKeyFrame = false;
        lastKeyFrameAt = now;
      }
    } catch {
      // The next compositor frame is a clean retry point.
    } finally {
      frame?.close();
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
      subscribers.set(message.subscriberId, {
        lastSeenAt: Date.now(),
        includeAudio: message.includeAudio === true,
      });
      if (message.includeAudio) startAudioPublisher();
      sendStart(message.subscriberId);
    }
    if (message.type === "unsubscribe") {
      subscribers.delete(message.subscriberId);
    }
    if (message.type === "request-key-frame") {
      forceKeyFrame = true;
    }
  });

  const cleanupTimer = window.setInterval(() => {
    const staleBefore = Date.now() - SUBSCRIBER_TTL_MS;
    subscribers.forEach((subscriber, subscriberId) => {
      if (subscriber.lastSeenAt < staleBefore) {
        subscribers.delete(subscriberId);
      }
    });
    post({ type: "publisher-ready", sourceId, sessionId });
  }, HEARTBEAT_MS);
  post({ type: "publisher-ready", sourceId, sessionId });
  frameCallbackId = video.requestVideoFrameCallback(processVideoFrame);

  return () => {
    window.clearInterval(cleanupTimer);
    if (frameCallbackId !== undefined) {
      video.cancelVideoFrameCallback(frameCallbackId);
    }
    post({ type: "stream-stopped", sourceId, sessionId });
    active = false;
    subscribers.clear();
    audioProcessor?.disconnect();
    audioSource?.disconnect();
    silentGain?.disconnect();
    void audioContext?.close().catch(() => undefined);
    if (encoder?.state !== "closed") encoder?.close();
    channel.close();
  };
};

/** Decode the shared realtime relay directly into a display canvas and audio output. */
export const subscribeLocalVideoRealtime = (
  sourceId: string,
  canvas: HTMLCanvasElement,
  options: RealtimeSubscriberOptions = {},
): LocalVideoRealtimeSubscription => {
  const noOp = {
    stop: () => undefined,
    setVolume: () => undefined,
    setAudioEnabled: () => undefined,
  };
  if (!supportsLocalVideoRealtimeRelay()) return noOp;

  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) return noOp;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscriberId = createId("realtime-display");
  let active = true;
  let sessionId: string | undefined;
  let decoder: VideoDecoder | undefined;
  let decoderConfig: VideoDecoderConfig | undefined;
  let waitingForKeyFrame = true;
  let hasRenderedFrame = false;
  let hasObservedPublisher = false;
  let lastPublisherActivityAt = 0;
  let publisherLossReported = false;
  let firstFrameWaitingSince = 0;
  let fallbackRequested = false;
  let audioContext: AudioContext | undefined;
  let audioGain: GainNode | undefined;
  let scheduledAudioTime = 0;
  let volume = normalizeVolume(options.volume ?? 1);
  let includeAudio = options.includeAudio === true;
  const audioSources = new Set<AudioBufferSourceNode>();

  const reportError = (detail: string) => {
    options.onError?.(detail);
    reportLocalVideoIssue(sourceId, detail);
  };

  const markPublisherActivity = () => {
    hasObservedPublisher = true;
    lastPublisherActivityAt = Date.now();
    publisherLossReported = false;
    if (!hasRenderedFrame && firstFrameWaitingSince === 0) {
      firstFrameWaitingSince = lastPublisherActivityAt;
    }
  };

  const announce = () => {
    if (!active) return;
    channel.postMessage({
      type: "subscribe",
      sourceId,
      subscriberId,
      sentAt: Date.now(),
      includeAudio,
    } satisfies RealtimeRelayMessage);
  };

  const requestKeyFrame = () => {
    if (!active) return;
    channel.postMessage({
      type: "request-key-frame",
      sourceId,
      subscriberId,
    } satisfies RealtimeRelayMessage);
  };

  const resetDecoder = () => {
    if (decoder?.state !== "closed") decoder?.close();
    decoder = undefined;
    waitingForKeyFrame = true;
  };

  const configureDecoder = (config: VideoDecoderConfig) => {
    resetDecoder();
    decoderConfig = config;
    try {
      decoder = new VideoDecoder({
        output: (frame) => {
          try {
            if (canvas.width !== frame.displayWidth) {
              canvas.width = frame.displayWidth;
            }
            if (canvas.height !== frame.displayHeight) {
              canvas.height = frame.displayHeight;
            }
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            if (!hasRenderedFrame) {
              hasRenderedFrame = true;
              firstFrameWaitingSince = 0;
              options.onStarted?.();
            }
          } finally {
            frame.close();
          }
        },
        error: () => {
          resetDecoder();
          // Rebuild immediately. Waiting for the next two-second publisher
          // heartbeat can otherwise leave the canvas black after a transient
          // WebCodecs decoder failure.
          queueMicrotask(() => {
            if (!active || !decoderConfig) return;
            configureDecoder(decoderConfig);
          });
        },
      });
      decoder.configure(config);
      requestKeyFrame();
    } catch {
      resetDecoder();
      options.onFallback?.();
    }
  };

  const playAudioFrame = (message: RealtimeRelayMessage) => {
    if (
      !includeAudio ||
      !message.sampleRate ||
      !message.audioChannels?.length
    ) {
      return;
    }
    try {
      audioContext ??= new AudioContext({ latencyHint: "interactive" });
      if (!audioGain) {
        audioGain = audioContext.createGain();
        audioGain.gain.value = volume;
        audioGain.connect(audioContext.destination);
      }
      void audioContext.resume().catch(() => undefined);
      const channelData = message.audioChannels.map(
        (data) => new Float32Array(data),
      );
      const frameCount = channelData[0]?.length ?? 0;
      if (frameCount === 0) return;
      const buffer = audioContext.createBuffer(
        channelData.length,
        frameCount,
        message.sampleRate,
      );
      channelData.forEach((data, channelIndex) =>
        buffer.copyToChannel(data, channelIndex),
      );
      const now = audioContext.currentTime;
      if (
        scheduledAudioTime < now ||
        scheduledAudioTime > now + MAX_AUDIO_LEAD_SECONDS
      ) {
        scheduledAudioTime = now + AUDIO_START_LEAD_SECONDS;
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioGain);
      audioSources.add(source);
      source.addEventListener("ended", () => audioSources.delete(source), {
        once: true,
      });
      source.start(scheduledAudioTime);
      scheduledAudioTime += buffer.duration;
    } catch {
      reportError("Realtime sound stopped. Check this display's audio output.");
    }
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
      message.videoConfig
    ) {
      markPublisherActivity();
      const sameSession = sessionId === message.sessionId;
      const sameConfig =
        decoderConfig &&
        getDecoderConfigKey(decoderConfig) ===
          getDecoderConfigKey(message.videoConfig);
      sessionId = message.sessionId;
      // Publisher heartbeats repeat stream-start so a late display can join.
      // Resetting a healthy decoder for each repeat creates a keyframe race
      // that can intermittently leave an Electron output black.
      if (
        !sameSession ||
        !sameConfig ||
        !decoder ||
        decoder.state !== "configured"
      ) {
        configureDecoder(message.videoConfig);
      } else if (!hasRenderedFrame) {
        requestKeyFrame();
      }
    }
    if (
      message.type === "video-chunk" &&
      message.sessionId === sessionId &&
      message.videoChunk &&
      decoderConfig
    ) {
      markPublisherActivity();
      const chunk = message.videoChunk;
      if (
        decoder?.decodeQueueSize &&
        decoder.decodeQueueSize > MAX_DECODE_QUEUE
      ) {
        configureDecoder(decoderConfig);
        return;
      }
      if (waitingForKeyFrame && chunk.type !== "key") return;
      if (!decoder || decoder.state !== "configured") return;
      try {
        waitingForKeyFrame = false;
        decoder.decode(
          new EncodedVideoChunk({
            type: chunk.type,
            timestamp: chunk.timestamp,
            ...(chunk.duration !== undefined
              ? { duration: chunk.duration }
              : {}),
            data: chunk.data,
          }),
        );
      } catch {
        configureDecoder(decoderConfig);
      }
    }
    if (message.type === "audio-frame" && message.sessionId === sessionId) {
      markPublisherActivity();
      playAudioFrame(message);
    }
    if (message.type === "stream-error" && message.detail) {
      markPublisherActivity();
      if (message.fallback) {
        options.onFallback?.();
      } else {
        reportError(message.detail);
      }
    }
    if (message.type === "stream-stopped" && message.sessionId === sessionId) {
      sessionId = undefined;
      hasRenderedFrame = false;
      firstFrameWaitingSince = 0;
      resetDecoder();
      options.onStopped?.();
      announce();
    }
  });

  announce();
  const heartbeat = window.setInterval(announce, HEARTBEAT_MS);
  const publisherHealthCheck = window.setInterval(() => {
    const now = Date.now();
    if (
      active &&
      hasObservedPublisher &&
      !hasRenderedFrame &&
      !fallbackRequested &&
      firstFrameWaitingSince > 0 &&
      now - firstFrameWaitingSince >= FIRST_FRAME_FALLBACK_MS
    ) {
      // MSE is slower than WebCodecs but is a reliable compatibility path.
      // Prefer it over leaving a live audience output permanently black.
      fallbackRequested = true;
      options.onFallback?.();
      return;
    }
    if (
      !active ||
      !hasObservedPublisher ||
      publisherLossReported ||
      now - lastPublisherActivityAt < PUBLISHER_LOSS_GRACE_MS
    ) {
      return;
    }
    publisherLossReported = true;
    sessionId = undefined;
    hasRenderedFrame = false;
    firstFrameWaitingSince = 0;
    resetDecoder();
    options.onStopped?.();
    reportError(
      "The local video publisher stopped. Check the input on this controller.",
    );
  }, HEARTBEAT_MS);

  const stopScheduledAudio = () => {
    audioSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already-ended sources need no further cleanup.
      }
    });
    audioSources.clear();
    scheduledAudioTime = 0;
  };

  const stop = () => {
    if (!active) return;
    active = false;
    window.clearInterval(heartbeat);
    window.clearInterval(publisherHealthCheck);
    channel.postMessage({
      type: "unsubscribe",
      sourceId,
      subscriberId,
    } satisfies RealtimeRelayMessage);
    resetDecoder();
    stopScheduledAudio();
    audioGain?.disconnect();
    void audioContext?.close().catch(() => undefined);
    channel.close();
  };

  return {
    stop,
    setVolume: (nextVolume) => {
      volume = normalizeVolume(nextVolume);
      if (audioGain) audioGain.gain.value = volume;
    },
    setAudioEnabled: (enabled) => {
      if (includeAudio === enabled) return;
      includeAudio = enabled;
      if (!includeAudio) stopScheduledAudio();
      announce();
    },
  };
};
