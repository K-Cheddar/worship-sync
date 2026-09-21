import {
  __getLocalVideoDiagnosticsForTests,
  __resetLocalVideoDiagnosticsForTests,
  recordLocalVideoCapture,
  recordLocalVideoDecoder,
  recordLocalVideoEncoder,
  recordLocalVideoSourceFrame,
  startLocalVideoView,
  stopLocalVideoView,
  updateLocalVideoView,
} from "./localVideoDiagnostics";

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  listeners = new Set<MessageListener>();

  constructor(public name: string) {
    FakeBroadcastChannel.channels.push(this);
  }

  addEventListener(_type: "message", listener: MessageListener) {
    this.listeners.add(listener);
  }

  postMessage(message: unknown) {
    FakeBroadcastChannel.channels
      .filter((channel) => channel !== this && channel.name === this.name)
      .forEach((channel) =>
        queueMicrotask(() =>
          channel.listeners.forEach((listener) =>
            listener({ data: message } as MessageEvent<unknown>),
          ),
        ),
      );
  }

  close() {
    FakeBroadcastChannel.channels = FakeBroadcastChannel.channels.filter(
      (channel) => channel !== this,
    );
  }
}

describe("localVideoDiagnostics", () => {
  beforeEach(() => {
    localStorage.removeItem("worshipsync_local_video_debug");
    __resetLocalVideoDiagnosticsForTests();
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
  });

  afterEach(() => {
    __resetLocalVideoDiagnosticsForTests();
    FakeBroadcastChannel.channels = [];
    localStorage.removeItem("worshipsync_local_video_debug");
  });

  it("does nothing until explicitly enabled", () => {
    recordLocalVideoCapture("camera-1", { settings: { width: 1920 } });
    startLocalVideoView("camera-1", "projector", { path: "DIRECT" });

    expect(__getLocalVideoDiagnosticsForTests().size).toBe(0);
  });

  it("keeps actual negotiated settings and aggregates encoder drops", () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    recordLocalVideoCapture("camera-1", {
      requestedConstraints: { width: { ideal: 1920 } },
      settings: { width: 1280, height: 720, frameRate: 30 },
    });
    recordLocalVideoEncoder("camera-1", { dropped: 1, queueMax: 3 });
    recordLocalVideoEncoder("camera-1", { dropped: 1, queueMax: 2 });

    const source = __getLocalVideoDiagnosticsForTests().get("camera-1");
    expect(source?.capture).toEqual(
      expect.objectContaining({ settings: { width: 1280, height: 720, frameRate: 30 } }),
    );
    expect(source?.encoder).toEqual(
      expect.objectContaining({ dropped: 2, queueMax: 3 }),
    );
  });

  it("publishes a capture-host snapshot that another renderer can observe", async () => {
    jest.useFakeTimers();
    localStorage.setItem("worshipsync_local_video_debug", "true");
    const observer = new FakeBroadcastChannel(
      "worshipsync-local-video-diagnostics-v1",
    );
    const messages: unknown[] = [];
    observer.addEventListener("message", (event) => messages.push(event.data));

    recordLocalVideoCapture("camera-1", {
      captureOwner: "hidden-capture-host",
      deviceLabel: "USB camera",
      settings: { width: 1_280, height: 720, frameRate: 59.94 },
    });
    recordLocalVideoSourceFrame("camera-1", 1, {
      width: 1_280,
      height: 720,
      mediaTime: 1,
    });
    recordLocalVideoEncoder("camera-1", { submitted: 1 });
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "publisher-snapshot",
          sourceId: "camera-1",
          snapshot: expect.objectContaining({ subscribers: 0 }),
        }),
      ]),
    );
    observer.close();
    jest.useRealTimers();
  });

  it("merges a capture-host snapshot into a reporting renderer", async () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    const publisher = new FakeBroadcastChannel(
      "worshipsync-local-video-diagnostics-v1",
    );
    startLocalVideoView("camera-1", "projector-view", {
      path: "REALTIME_WEBCODECS",
      windowRole: "projector",
    });
    publisher.postMessage({
      type: "publisher-snapshot",
      senderId: "capture-host",
      sourceId: "camera-1",
      snapshot: {
        capture: {
          deviceLabel: "USB camera",
          settings: { width: 1_920, height: 1_080, frameRate: 30 },
        },
        source: {
          callbacks: 30,
          callbacksTotal: 30,
          presentedFrames: 30,
          presentedFramesTotal: 30,
          missedFrames: 0,
          missedFramesTotal: 0,
        },
        sourceInterval: {
          callbacks: 30,
          callbacksTotal: 30,
          presentedFrames: 30,
          presentedFramesTotal: 30,
          missedFrames: 0,
          missedFramesTotal: 0,
        },
        encoder: { submitted: 30, dropped: 0 },
        encoderInterval: { submitted: 30, dropped: 0 },
        subscribers: 2,
      },
    });
    await Promise.resolve();

    const source = __getLocalVideoDiagnosticsForTests().get("camera-1");
    expect(source?.remotePublisher?.capture?.settings).toEqual({
      width: 1_920,
      height: 1_080,
      frameRate: 30,
    });
    expect(source?.remotePublisher?.subscribers).toBe(2);
    publisher.close();
  });

  it("keeps decoder metrics per view and removes an unmounted view", () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    startLocalVideoView("camera-1", "projector-view", {
      path: "REALTIME_WEBCODECS",
      windowRole: "projector",
    });
    startLocalVideoView("camera-1", "editor-view", {
      path: "REALTIME_WEBCODECS",
      windowRole: "editor",
    });
    recordLocalVideoDecoder("camera-1", "projector-view", {
      frames: 55,
      resets: 2,
    });
    recordLocalVideoDecoder("camera-1", "editor-view", { frames: 54 });

    const source = __getLocalVideoDiagnosticsForTests().get("camera-1");
    expect(source?.views.get("projector-view")?.decoder.frames).toBe(55);
    expect(source?.views.get("editor-view")?.decoder.frames).toBe(54);
    expect(source?.views.get("projector-view")?.decoder.resets).toBe(2);
    stopLocalVideoView("camera-1", "projector-view");
    expect(source?.views.has("projector-view")).toBe(false);
    expect(source?.views.has("editor-view")).toBe(true);
  });

  it("accumulates decoder event counters while keeping queue high water as a max", () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    startLocalVideoView("camera-1", "projector-view", {
      path: "REALTIME_WEBCODECS",
    });
    recordLocalVideoDecoder("camera-1", "projector-view", {
      submitted: 2,
      chunks: 3,
      frames: 2,
      droppedForLatency: 4,
      hardResets: 1,
      keyframeWaits: 1,
      keyframeWaitMs: 250,
      queueMax: 5,
    });
    recordLocalVideoDecoder("camera-1", "projector-view", {
      submitted: 1,
      chunks: 2,
      frames: 1,
      droppedForLatency: 2,
      hardResets: 2,
      keyframeWaits: 1,
      keyframeWaitMs: 125,
      queueMax: 3,
    });

    const view = __getLocalVideoDiagnosticsForTests()
      .get("camera-1")
      ?.views.get("projector-view");
    expect(view?.decoder).toEqual(
      expect.objectContaining({
        submitted: 3,
        chunks: 5,
        frames: 3,
        droppedForLatency: 6,
        hardResets: 3,
        keyframeWaits: 2,
        keyframeWaitMs: 375,
        queueMax: 5,
      }),
    );
    expect(view?.decoderInterval).toEqual(view?.decoder);
  });

  it("resets decoder interval counters without resetting cumulative totals", async () => {
    jest.useFakeTimers();
    localStorage.setItem("worshipsync_local_video_debug", "true");
    startLocalVideoView("camera-1", "projector-view", {
      path: "REALTIME_WEBCODECS",
    });
    recordLocalVideoDecoder("camera-1", "projector-view", {
      hardResets: 2,
      droppedForLatency: 3,
      queueMax: 4,
    });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    const view = __getLocalVideoDiagnosticsForTests()
      .get("camera-1")
      ?.views.get("projector-view");
    expect(view?.decoderInterval).toEqual({});
    expect(view?.decoder).toEqual(
      expect.objectContaining({
        hardResets: 2,
        droppedForLatency: 3,
        queueMax: 4,
      }),
    );
    jest.useRealTimers();
  });

  it("keeps preview warming separate from the active realtime path", () => {
    localStorage.setItem("worshipsync_local_video_debug", "true");
    startLocalVideoView("camera-1", "active-view", {
      path: "REALTIME_WEBCODECS",
      windowRole: "projector",
    });
    startLocalVideoView("camera-1", "preview-view", {
      path: "STILL_PREVIEW",
      windowRole: "projector",
    });
    updateLocalVideoView("camera-1", "active-view", { previewWarm: true });

    const source = __getLocalVideoDiagnosticsForTests().get("camera-1");
    expect(source?.views.get("active-view")?.path).toBe("REALTIME_WEBCODECS");
    expect(source?.views.get("active-view")?.previewWarm).toBe(true);
    expect(source?.views.get("preview-view")?.path).toBe("STILL_PREVIEW");

    stopLocalVideoView("camera-1", "preview-view");
    expect(source?.views.get("active-view")?.path).toBe("REALTIME_WEBCODECS");
  });

  it("does not create transport or records when diagnostics are disabled", () => {
    startLocalVideoView("camera-1", "projector-view", {
      path: "REALTIME_WEBCODECS",
    });

    expect(__getLocalVideoDiagnosticsForTests()).toHaveProperty("size", 0);
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
  });
});
