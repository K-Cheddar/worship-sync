import { waitFor } from "@testing-library/react";
import {
  publishLocalVideoRealtime,
  subscribeLocalVideoRealtime,
  supportsLocalVideoRealtimeRelay,
} from "./localVideoRealtimeRelay";
import {
  __getLocalVideoDiagnosticsForTests,
  __resetLocalVideoDiagnosticsForTests,
} from "./localVideoDiagnostics";

jest.mock("./localVideoIssues", () => ({
  reportLocalVideoIssue: jest.fn(),
}));

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  static messages: unknown[] = [];
  listeners = new Set<MessageListener>();

  constructor(public name: string) {
    FakeBroadcastChannel.channels.push(this);
  }

  addEventListener(_type: "message", listener: MessageListener) {
    this.listeners.add(listener);
  }

  postMessage(message: unknown) {
    FakeBroadcastChannel.messages.push(message);
    FakeBroadcastChannel.channels
      .filter((channel) => channel !== this && channel.name === this.name)
      .forEach((channel) => {
        queueMicrotask(() =>
          channel.listeners.forEach((listener) =>
            listener({ data: message } as MessageEvent<unknown>),
          ),
        );
      });
  }

  close() {
    FakeBroadcastChannel.channels = FakeBroadcastChannel.channels.filter(
      (channel) => channel !== this,
    );
  }
}

class FakeVideoFrame {
  displayWidth = 1_920;
  displayHeight = 1_080;
  close = jest.fn();
}

class FakeEncodedVideoChunk {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration: number | null;
  byteLength: number;
  private data: ArrayBuffer;

  constructor(init: EncodedVideoChunkInit) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? null;
    const bytes = ArrayBuffer.isView(init.data)
      ? new Uint8Array(
          init.data.buffer,
          init.data.byteOffset,
          init.data.byteLength,
        )
      : new Uint8Array(init.data);
    this.data = bytes.slice().buffer;
    this.byteLength = this.data.byteLength;
  }

  copyTo(destination: AllowSharedBufferSource) {
    const target = ArrayBuffer.isView(destination)
      ? new Uint8Array(
          destination.buffer,
          destination.byteOffset,
          destination.byteLength,
        )
      : new Uint8Array(destination);
    target.set(new Uint8Array(this.data));
  }
}

class FakeVideoEncoder {
  static instances: FakeVideoEncoder[] = [];
  state: CodecState = "unconfigured";
  encodeQueueSize = 0;
  configure = jest.fn(() => {
    this.state = "configured";
  });
  close = jest.fn(() => {
    this.state = "closed";
  });

  constructor(
    private init: {
      output: (chunk: EncodedVideoChunk) => void;
      error: (error: DOMException) => void;
    },
  ) {
    FakeVideoEncoder.instances.push(this);
  }

  encode = jest.fn((frame: VideoFrame, options?: VideoEncoderEncodeOptions) => {
    this.init.output(
      new FakeEncodedVideoChunk({
        type: options?.keyFrame ? "key" : "delta",
        timestamp: 1,
        data: new Uint8Array([1, 2, 3]),
      }) as unknown as EncodedVideoChunk,
    );
  });
}

class FakeVideoDecoder {
  static instances: FakeVideoDecoder[] = [];
  state: CodecState = "unconfigured";
  decodeQueueSize = 0;
  configure = jest.fn(() => {
    this.state = "configured";
  });
  close = jest.fn(() => {
    this.state = "closed";
  });

  constructor(
    private init: {
      output: (frame: VideoFrame) => void;
      error: (error: DOMException) => void;
    },
  ) {
    FakeVideoDecoder.instances.push(this);
  }

  decode = jest.fn(() => {
    this.init.output(new FakeVideoFrame() as unknown as VideoFrame);
  });

  fail() {
    this.init.error(new DOMException("decoder failed", "EncodingError"));
  }
}

describe("localVideoRealtimeRelay", () => {
  let nextVideoFrame: VideoFrameRequestCallback | undefined;
  let drawImage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    FakeBroadcastChannel.channels = [];
    FakeBroadcastChannel.messages = [];
    FakeVideoEncoder.instances = [];
    FakeVideoDecoder.instances = [];
    nextVideoFrame = undefined;
    localStorage.setItem("worshipsync_local_video_debug", "true");
    __resetLocalVideoDiagnosticsForTests();
    drawImage = jest.fn();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    Object.defineProperty(window, "__ELECTRON__", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    Object.defineProperty(globalThis, "VideoEncoder", {
      configurable: true,
      value: FakeVideoEncoder,
    });
    Object.defineProperty(globalThis, "VideoDecoder", {
      configurable: true,
      value: FakeVideoDecoder,
    });
    Object.defineProperty(globalThis, "VideoFrame", {
      configurable: true,
      value: FakeVideoFrame,
    });
    Object.defineProperty(globalThis, "EncodedVideoChunk", {
      configurable: true,
      value: FakeEncodedVideoChunk,
    });
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestVideoFrameCallback",
      {
        configurable: true,
        value: jest.fn((callback: VideoFrameRequestCallback) => {
          nextVideoFrame = callback;
          return 1;
        }),
      },
    );
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "cancelVideoFrameCallback",
      {
        configurable: true,
        value: jest.fn(),
      },
    );
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    delete window.__ELECTRON__;
    localStorage.removeItem("worshipsync_local_video_debug");
    __resetLocalVideoDiagnosticsForTests();
    jest.restoreAllMocks();
  });

  it("uses one realtime encoder for every local output", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const videoTrack = {
      getSettings: () => ({ frameRate: 60 }),
    };
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const onProjectorStarted = jest.fn();
    const onMonitorStarted = jest.fn();
    const stopPublisher = publishLocalVideoRealtime("source-1", video, stream);
    const projector = subscribeLocalVideoRealtime(
      "source-1",
      document.createElement("canvas"),
      { onStarted: onProjectorStarted },
    );
    const monitor = subscribeLocalVideoRealtime(
      "source-1",
      document.createElement("canvas"),
      { onStarted: onMonitorStarted },
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, {
      mediaTime: 1,
    } as VideoFrameCallbackMetadata);

    await waitFor(() => expect(onProjectorStarted).toHaveBeenCalledTimes(1));
    expect(onMonitorStarted).toHaveBeenCalledTimes(1);
    expect(
      __getLocalVideoDiagnosticsForTests().get("source-1")?.subscribers,
    ).toBe(2);
    expect(FakeVideoEncoder.instances).toHaveLength(1);
    expect(FakeVideoEncoder.instances[0].configure).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: "vp8",
        latencyMode: "realtime",
        width: 1_920,
        height: 1_080,
      }),
    );
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 2_560 },
      videoHeight: { configurable: true, value: 1_440 },
    });
    nextVideoFrame?.(1_017, {
      mediaTime: 1.017,
    } as VideoFrameCallbackMetadata);

    await waitFor(() => expect(FakeVideoEncoder.instances).toHaveLength(2));
    expect(FakeVideoEncoder.instances[0].close).toHaveBeenCalledTimes(1);
    expect(FakeVideoEncoder.instances[1].configure).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 2_560,
        height: 1_440,
        bitrate: 20_000_000,
        latencyMode: "realtime",
      }),
    );

    projector.stop();
    monitor.stop();
    stopPublisher();
    expect(
      FakeBroadcastChannel.channels.filter(
        (channel) => channel.name === "worshipsync-local-video-realtime-v1",
      ),
    ).toHaveLength(0);
  });

  it("separates rVFC callback rate from unique presented frames", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-rate", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-rate",
      document.createElement("canvas"),
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, {
      mediaTime: 1,
      presentedFrames: 1,
    } as VideoFrameCallbackMetadata);
    nextVideoFrame?.(1_016, {
      mediaTime: 1,
      presentedFrames: 1,
    } as VideoFrameCallbackMetadata);
    nextVideoFrame?.(1_033, {
      mediaTime: 1.033,
      presentedFrames: 2,
    } as VideoFrameCallbackMetadata);

    await waitFor(() =>
      expect(
        __getLocalVideoDiagnosticsForTests().get("source-rate")?.encoder
          .submitted,
      ).toBe(2),
    );
    const source = __getLocalVideoDiagnosticsForTests().get("source-rate");
    expect(source?.sourceInterval.callbacks).toBe(3);
    expect(source?.sourceInterval.presentedFrames).toBe(2);

    subscription.stop();
    stopPublisher();
  });

  it("is disabled in the browser so the compatibility relay remains available", () => {
    delete window.__ELECTRON__;

    expect(supportsLocalVideoRealtimeRelay()).toBe(false);
  });

  it("changes subscriber audio demand without rebuilding video", async () => {
    const messages: Array<{ type?: string; includeAudio?: boolean }> = [];
    const observer = new FakeBroadcastChannel(
      "worshipsync-local-video-realtime-v1",
    );
    observer.addEventListener("message", (event) => {
      messages.push(event.data as { type?: string; includeAudio?: boolean });
    });
    const subscription = subscribeLocalVideoRealtime(
      "source-1",
      document.createElement("canvas"),
      { includeAudio: false },
    );

    subscription.setAudioEnabled(true);

    await waitFor(() =>
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "subscribe", includeAudio: true }),
        ]),
      ),
    );
    subscription.stop();
    observer.close();
  });

  it("does not reset a healthy decoder for repeated publisher handshakes", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 60 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-1", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-1",
      document.createElement("canvas"),
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, {
      mediaTime: 1,
    } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));

    subscription.setAudioEnabled(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeVideoDecoder.instances).toHaveLength(1);
    expect(FakeVideoDecoder.instances[0].close).not.toHaveBeenCalled();
    const view = [
      ...(__getLocalVideoDiagnosticsForTests().get("source-1")?.views.values() ?? []),
    ][0];
    expect(view?.decoderLifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "create", reason: "INITIAL_CREATE" }),
      ]),
    );
    expect(view?.decoderLifecycle).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "destroy" }),
      ]),
    );

    subscription.stop();
    stopPublisher();
  });

  it("rebuilds the decoder immediately after a transient decoder failure", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 60 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-1", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-1",
      document.createElement("canvas"),
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, {
      mediaTime: 1,
    } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));

    FakeVideoDecoder.instances[0].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(2));
    expect(FakeVideoDecoder.instances[1].configure).toHaveBeenCalled();

    subscription.stop();
    stopPublisher();
  });

  it("falls back when a connected realtime publisher never delivers a frame", async () => {
    jest.useFakeTimers();
    const onFallback = jest.fn();
    const subscription = subscribeLocalVideoRealtime(
      "source-black",
      document.createElement("canvas"),
      { onFallback },
    );
    const publisher = new FakeBroadcastChannel(
      "worshipsync-local-video-realtime-v1",
    );

    publisher.postMessage({
      type: "publisher-ready",
      sourceId: "source-black",
      sessionId: "publisher-1",
    });
    await Promise.resolve();

    jest.advanceTimersByTime(7_999);
    expect(onFallback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onFallback).toHaveBeenCalledTimes(1);

    subscription.stop();
    publisher.close();
    jest.useRealTimers();
  });

  it("sheds a brief decoder queue spike without rebuilding, then hard-resets on decoder error", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const stream = { getAudioTracks: () => [], getVideoTracks: () => [{ getSettings: () => ({ frameRate: 60 }) }] } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-metrics", video, stream);
    const subscription = subscribeLocalVideoRealtime("source-metrics", document.createElement("canvas"));
    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, { mediaTime: 1, presentedFrames: 1 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoEncoder.instances).toHaveLength(1));
    FakeVideoEncoder.instances[0].encodeQueueSize = 3;
    nextVideoFrame?.(1_017, { mediaTime: 1.017, presentedFrames: 2 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(__getLocalVideoDiagnosticsForTests().get("source-metrics")?.encoder.dropped).toBe(1));
    FakeVideoEncoder.instances[0].encodeQueueSize = 0;
    FakeVideoDecoder.instances[0].decodeQueueSize = 3;
    nextVideoFrame?.(1_034, { mediaTime: 1.034, presentedFrames: 3 } as VideoFrameCallbackMetadata);
    await waitFor(() =>
      expect(
        __getLocalVideoDiagnosticsForTests().get("source-metrics")?.views,
      ).toBeDefined(),
    );
    expect(FakeVideoDecoder.instances).toHaveLength(1);
    const viewAfterShedding = [
      ...(__getLocalVideoDiagnosticsForTests().get("source-metrics")?.views.values() ?? []),
    ][0];
    expect(viewAfterShedding?.decoder.droppedForLatency).toBe(1);
    expect(viewAfterShedding?.decoder.hardResets).toBeUndefined();

    FakeVideoDecoder.instances[0].decodeQueueSize = 0;
    nextVideoFrame?.(2_051, { mediaTime: 2.051, presentedFrames: 4 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances[0].decode).toHaveBeenCalledTimes(2));
    FakeVideoDecoder.instances[0].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(2));
    await waitFor(() =>
      expect(
        [...(__getLocalVideoDiagnosticsForTests().get("source-metrics")?.views.values() ?? [])].some(
          (view) => Number(view.decoder.hardResets ?? 0) > 0,
        ),
      ).toBe(true),
    );
    const diagnosticView = [
      ...(__getLocalVideoDiagnosticsForTests().get("source-metrics")?.views.values() ?? []),
    ][0];
    expect(diagnosticView?.decoderInstanceCount).toBeGreaterThan(1);
    expect(diagnosticView?.lastDecoderResetInstanceId).toBeDefined();
    expect(diagnosticView?.decoderInstanceId).not.toBe(
      diagnosticView?.lastDecoderResetInstanceId,
    );
    expect(diagnosticView?.decoder.hardResets).toBe(1);
    expect(diagnosticView?.decoder.droppedForLatency).toBe(1);
    expect(diagnosticView?.decoderLifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "destroy",
          reason: "DECODER_ERROR",
        }),
      ]),
    );
    expect(diagnosticView?.decoderLifecycle).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "destroy",
          reason: "QUEUE_OVERFLOW",
        }),
      ]),
    );
    subscription.stop();
    stopPublisher();
  });

  it("ignores a stale decoder error after a newer decoder is active", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-stale-error", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-stale-error",
      document.createElement("canvas"),
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));
    FakeVideoDecoder.instances[0].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(2));

    FakeVideoDecoder.instances[0].fail();
    await Promise.resolve();
    expect(FakeVideoDecoder.instances).toHaveLength(2);

    subscription.stop();
    stopPublisher();
  });

  it("falls back instead of repeatedly rebuilding an unrecoverable decoder", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const onFallback = jest.fn();
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-reset-storm", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-reset-storm",
      document.createElement("canvas"),
      { onFallback },
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));
    FakeVideoDecoder.instances[0].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(2));
    FakeVideoDecoder.instances[1].fail();
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(FakeVideoDecoder.instances).toHaveLength(2);

    subscription.stop();
    stopPublisher();
  });

  it("does not clear recovery protection after one lucky output frame", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const onFallback = jest.fn();
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-recovery-window", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-recovery-window",
      document.createElement("canvas"),
      { onFallback },
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));
    FakeVideoDecoder.instances[0].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(2));

    jest.useFakeTimers();
    nextVideoFrame?.(1_017, { mediaTime: 1.017 } as VideoFrameCallbackMetadata);
    FakeVideoDecoder.instances[1].fail();
    await Promise.resolve();
    expect(FakeVideoDecoder.instances).toHaveLength(2);
    expect(onFallback).toHaveBeenCalledTimes(1);
    jest.useRealTimers();

    subscription.stop();
    stopPublisher();
  });

  it("allows an isolated decoder failure after the stability window", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const onFallback = jest.fn();
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-recovery-stable", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-recovery-stable",
      document.createElement("canvas"),
      { onFallback },
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));
    FakeVideoDecoder.instances[0].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(2));

    jest.useFakeTimers();
    nextVideoFrame?.(1_017, { mediaTime: 1.017 } as VideoFrameCallbackMetadata);
    jest.advanceTimersByTime(1_001);
    nextVideoFrame?.(2_018, { mediaTime: 2.018 } as VideoFrameCallbackMetadata);
    FakeVideoDecoder.instances[1].fail();
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(3));
    expect(onFallback).not.toHaveBeenCalled();
    jest.useRealTimers();

    subscription.stop();
    stopPublisher();
  });

  it("drops a pressured keyframe and accepts a fresh keyframe without rebuilding", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_ENOUGH_DATA,
      },
      videoWidth: { configurable: true, value: 1_920 },
      videoHeight: { configurable: true, value: 1_080 },
    });
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoRealtime("source-keyframe", video, stream);
    const subscription = subscribeLocalVideoRealtime(
      "source-keyframe",
      document.createElement("canvas"),
    );

    await waitFor(() => expect(nextVideoFrame).toBeDefined());
    nextVideoFrame?.(1_000, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    await waitFor(() => expect(FakeVideoDecoder.instances).toHaveLength(1));
    FakeVideoDecoder.instances[0].decodeQueueSize = 3;
    nextVideoFrame?.(2_100, { mediaTime: 2.1 } as VideoFrameCallbackMetadata);
    await waitFor(() =>
      expect(
        __getLocalVideoDiagnosticsForTests().get("source-keyframe")?.views,
      ).toBeDefined(),
    );
    expect(FakeVideoDecoder.instances).toHaveLength(1);

    await Promise.resolve();
    nextVideoFrame?.(3_100, { mediaTime: 3.1 } as VideoFrameCallbackMetadata);
    await waitFor(() =>
      expect(
        [...(__getLocalVideoDiagnosticsForTests().get("source-keyframe")?.views.values() ?? [])][0]
          ?.decoder.droppedForLatency,
      ).toBe(2),
    );
    FakeVideoDecoder.instances[0].decodeQueueSize = 0;
    nextVideoFrame?.(4_100, { mediaTime: 4.1 } as VideoFrameCallbackMetadata);
    await waitFor(() =>
      expect(
        FakeBroadcastChannel.messages.filter(
          (message) =>
            (message as { type?: string }).type === "request-key-frame",
        ),
      ).toHaveLength(2),
    );
    await Promise.resolve();
    nextVideoFrame?.(5_100, { mediaTime: 5.1 } as VideoFrameCallbackMetadata);
    await Promise.resolve();
    expect(FakeVideoDecoder.instances[0].decode.mock.calls.length).toBeGreaterThanOrEqual(2);
    const view = [
      ...(__getLocalVideoDiagnosticsForTests().get("source-keyframe")?.views.values() ?? []),
    ][0];
    expect(view?.decoder.droppedForLatency).toBeGreaterThanOrEqual(2);
    expect(view?.decoder.hardResets).toBeUndefined();

    subscription.stop();
    stopPublisher();
  });
});
