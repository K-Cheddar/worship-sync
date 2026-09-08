const CHANNEL_NAME = "worshipsync-local-video-preview-v2";
const FRAME_INTERVAL_MS = 67;
const SUBSCRIBER_HEARTBEAT_MS = 2_000;
const SUBSCRIBER_TTL_MS = 5_000;
const PREVIEW_MAX_WIDTH = 640;
const PREVIEW_MAX_HEIGHT = 360;
const PREVIEW_QUALITY = 0.82;

type RelayMessage = {
  type: "subscribe" | "unsubscribe" | "frame" | "ready" | "stopped";
  sourceId: string;
  subscriberId?: string;
  sentAt?: number;
  frame?: Blob;
};

const isRelayMessage = (value: unknown): value is RelayMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayMessage>;
  return (
    (candidate.type === "subscribe" ||
      candidate.type === "unsubscribe" ||
      candidate.type === "frame" ||
      candidate.type === "ready" ||
      candidate.type === "stopped") &&
    typeof candidate.sourceId === "string"
  );
};

const createSubscriberId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getPreviewDimensions = (width: number, height: number) => {
  const scale = Math.min(
    PREVIEW_MAX_WIDTH / width,
    PREVIEW_MAX_HEIGHT / height,
    1,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * Publish small preview frames through browser-local structured cloning. This
 * deliberately avoids WebRTC and all network sockets.
 */
export const publishLocalVideoPreview = (
  sourceId: string,
  video: HTMLVideoElement,
) => {
  if (typeof BroadcastChannel === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscribers = new Map<string, number>();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  let active = true;
  let encoding = false;

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
      subscribers.set(message.subscriberId, Date.now());
    } else if (message.type === "unsubscribe") {
      subscribers.delete(message.subscriberId);
    }
  });

  const publishFrame = () => {
    if (!active || encoding || !context || video.readyState < 2) return;
    const now = Date.now();
    subscribers.forEach((lastSeenAt, subscriberId) => {
      if (now - lastSeenAt > SUBSCRIBER_TTL_MS) subscribers.delete(subscriberId);
    });
    if (subscribers.size === 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return;
    }
    const dimensions = getPreviewDimensions(video.videoWidth, video.videoHeight);
    if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
    if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    encoding = true;
    canvas.toBlob(
      (frame) => {
        encoding = false;
        if (!active || !frame || subscribers.size === 0) return;
        channel.postMessage({
          type: "frame",
          sourceId,
          frame,
        } satisfies RelayMessage);
      },
      "image/webp",
      PREVIEW_QUALITY,
    );
  };

  const frameTimer = window.setInterval(publishFrame, FRAME_INTERVAL_MS);
  channel.postMessage({ type: "ready", sourceId } satisfies RelayMessage);
  return () => {
    active = false;
    window.clearInterval(frameTimer);
    channel.postMessage({ type: "stopped", sourceId } satisfies RelayMessage);
    channel.close();
  };
};

/** Receive local preview frames without opening the USB capture a second time. */
export const subscribeLocalVideoPreview = (
  sourceId: string,
  onFrame: (frame: Blob | undefined) => void,
) => {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscriberId = createSubscriberId();
  let active = true;

  const announce = () => {
    if (!active) return;
    channel.postMessage({
      type: "subscribe",
      sourceId,
      subscriberId,
      sentAt: Date.now(),
    } satisfies RelayMessage);
  };
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!active || !isRelayMessage(message) || message.sourceId !== sourceId) {
      return;
    }
    if (message.type === "ready") announce();
    if (message.type === "stopped") onFrame(undefined);
    if (message.type === "frame" && message.frame) onFrame(message.frame);
  });
  announce();
  const heartbeat = window.setInterval(announce, SUBSCRIBER_HEARTBEAT_MS);

  return () => {
    active = false;
    window.clearInterval(heartbeat);
    channel.postMessage({
      type: "unsubscribe",
      sourceId,
      subscriberId,
    } satisfies RelayMessage);
    channel.close();
  };
};
