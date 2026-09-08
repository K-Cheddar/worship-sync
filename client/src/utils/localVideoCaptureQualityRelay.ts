import {
  DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE,
  type LocalVideoCaptureProfile,
  resolveLocalVideoCaptureProfile,
} from "./localVideoQuality";

const CHANNEL_NAME = "worshipsync-local-video-capture-quality-v1";
const HEARTBEAT_MS = 2_000;
const SUBSCRIBER_TTL_MS = 6_000;
const PROFILE_UPGRADE_DEBOUNCE_MS = 250;
const PROFILE_DOWNGRADE_GRACE_MS = 10_000;
const MAX_FRAME_RATE = 60;

type CaptureQualityMessage = {
  type: "subscribe" | "unsubscribe" | "publisher-ready";
  sourceId: string;
  subscriberId?: string;
  targetWidth?: number;
  targetHeight?: number;
};

type CaptureQualitySubscriber = {
  lastSeenAt: number;
  targetWidth: number;
  targetHeight: number;
};

export type LocalVideoCaptureQualitySubscription = {
  stop: () => void;
  updateTargetSize: (width: number, height: number) => void;
};

const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `capture-quality-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeDimension = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;

const isCaptureQualityMessage = (
  value: unknown,
): value is CaptureQualityMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CaptureQualityMessage>;
  return (
    typeof candidate.sourceId === "string" &&
    (candidate.type === "subscribe" ||
      candidate.type === "unsubscribe" ||
      candidate.type === "publisher-ready")
  );
};

/** Applies the smallest shared capture profile that covers all live outputs. */
export const publishLocalVideoCaptureQuality = (
  sourceId: string,
  stream: MediaStream,
) => {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return () => undefined;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscribers = new Map<string, CaptureQualitySubscriber>();
  let active = true;
  let currentProfile = DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE;
  let desiredProfile = DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE;
  let pendingProfile = DEFAULT_LOCAL_VIDEO_CAPTURE_PROFILE;
  let profileChangeRunning = false;
  let profileTimer: number | undefined;
  const failedProfiles = new Set<LocalVideoCaptureProfile["id"]>();

  const postReady = () => {
    if (active) {
      channel.postMessage({
        type: "publisher-ready",
        sourceId,
      } satisfies CaptureQualityMessage);
    }
  };

  const resolveRequiredProfile = () =>
    resolveLocalVideoCaptureProfile(
      [...subscribers.values()].map((subscriber) => ({
        width: subscriber.targetWidth,
        height: subscriber.targetHeight,
      })),
    );

  const profilePixelCount = (profile: LocalVideoCaptureProfile) =>
    profile.width * profile.height;

  const applyDesiredProfile = async () => {
    if (profileChangeRunning || !active) return;
    profileChangeRunning = true;
    try {
      while (
        active &&
        desiredProfile.id !== currentProfile.id &&
        !failedProfiles.has(desiredProfile.id)
      ) {
        const nextProfile = desiredProfile;
        try {
          await videoTrack.applyConstraints({
            width: { ideal: nextProfile.width },
            height: { ideal: nextProfile.height },
            frameRate: { ideal: MAX_FRAME_RATE },
          });
          currentProfile = nextProfile;
        } catch {
          // Many capture cards expose only one fixed mode and reject live
          // renegotiation even though their existing stream is healthy. Keep
          // that closest available mode and avoid retry/toast churn until the
          // capture is reopened.
          failedProfiles.add(nextProfile.id);
        }
      }
    } finally {
      profileChangeRunning = false;
    }
  };

  const scheduleProfileUpdate = () => {
    pendingProfile = resolveRequiredProfile();
    if (profileTimer !== undefined) window.clearTimeout(profileTimer);
    if (pendingProfile.id === desiredProfile.id) {
      profileTimer = undefined;
      return;
    }
    const isDowngrade =
      profilePixelCount(pendingProfile) < profilePixelCount(desiredProfile);
    profileTimer = window.setTimeout(
      () => {
        profileTimer = undefined;
        desiredProfile = pendingProfile;
        void applyDesiredProfile();
      },
      isDowngrade ? PROFILE_DOWNGRADE_GRACE_MS : PROFILE_UPGRADE_DEBOUNCE_MS,
    );
  };

  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      !active ||
      !isCaptureQualityMessage(message) ||
      message.sourceId !== sourceId ||
      !message.subscriberId
    ) {
      return;
    }
    if (message.type === "subscribe") {
      const next = {
        lastSeenAt: Date.now(),
        targetWidth: normalizeDimension(message.targetWidth),
        targetHeight: normalizeDimension(message.targetHeight),
      };
      const previous = subscribers.get(message.subscriberId);
      subscribers.set(message.subscriberId, next);
      if (
        !previous ||
        previous.targetWidth !== next.targetWidth ||
        previous.targetHeight !== next.targetHeight
      ) {
        scheduleProfileUpdate();
      }
    }
    if (message.type === "unsubscribe") {
      if (subscribers.delete(message.subscriberId)) scheduleProfileUpdate();
    }
  });

  const cleanupTimer = window.setInterval(() => {
    const staleBefore = Date.now() - SUBSCRIBER_TTL_MS;
    let removedSubscriber = false;
    subscribers.forEach((subscriber, subscriberId) => {
      if (subscriber.lastSeenAt < staleBefore) {
        subscribers.delete(subscriberId);
        removedSubscriber = true;
      }
    });
    if (removedSubscriber) scheduleProfileUpdate();
    postReady();
  }, HEARTBEAT_MS);
  postReady();

  return () => {
    active = false;
    window.clearInterval(cleanupTimer);
    if (profileTimer !== undefined) window.clearTimeout(profileTimer);
    subscribers.clear();
    channel.close();
  };
};

/** Reports an output's real rendered pixel demand to the capture owner. */
export const subscribeLocalVideoCaptureQuality = (
  sourceId: string,
  initialWidth: number,
  initialHeight: number,
): LocalVideoCaptureQualitySubscription => {
  const noOp = { stop: () => undefined, updateTargetSize: () => undefined };
  if (typeof BroadcastChannel === "undefined") return noOp;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const subscriberId = createId();
  let active = true;
  let targetWidth = normalizeDimension(initialWidth);
  let targetHeight = normalizeDimension(initialHeight);

  const announce = () => {
    if (!active) return;
    channel.postMessage({
      type: "subscribe",
      sourceId,
      subscriberId,
      targetWidth,
      targetHeight,
    } satisfies CaptureQualityMessage);
  };

  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      active &&
      isCaptureQualityMessage(message) &&
      message.type === "publisher-ready" &&
      message.sourceId === sourceId
    ) {
      announce();
    }
  });

  announce();
  const heartbeat = window.setInterval(announce, HEARTBEAT_MS);

  return {
    stop: () => {
      if (!active) return;
      active = false;
      window.clearInterval(heartbeat);
      channel.postMessage({
        type: "unsubscribe",
        sourceId,
        subscriberId,
      } satisfies CaptureQualityMessage);
      channel.close();
    },
    updateTargetSize: (width, height) => {
      const nextWidth = normalizeDimension(width);
      const nextHeight = normalizeDimension(height);
      if (nextWidth === targetWidth && nextHeight === targetHeight) return;
      targetWidth = nextWidth;
      targetHeight = nextHeight;
      announce();
    },
  };
};
