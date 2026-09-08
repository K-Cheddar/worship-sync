import { act, waitFor } from "@testing-library/react";
import {
  publishLocalVideoMedia,
  subscribeLocalVideoMedia,
} from "./localVideoMediaRelay";
import { reportLocalVideoIssue } from "./localVideoIssues";

jest.mock("./localVideoIssues", () => ({
  reportLocalVideoIssue: jest.fn(),
}));

const mockReportLocalVideoIssue = jest.mocked(reportLocalVideoIssue);

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  listeners = new Set<MessageListener>();
  received: unknown[] = [];

  constructor(public name: string) {
    FakeBroadcastChannel.channels.push(this);
  }

  addEventListener(_type: "message", listener: MessageListener) {
    this.listeners.add(listener);
  }

  postMessage(message: unknown) {
    FakeBroadcastChannel.channels
      .filter((channel) => channel !== this && channel.name === this.name)
      .forEach((channel) => {
        channel.received.push(message);
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

type RecorderListener = (event: Event & { data?: Blob }) => void;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = jest.fn(() => true);
  listeners = new Map<string, RecorderListener[]>();
  mimeType: string;
  state: RecordingState = "inactive";
  stop = jest.fn(() => {
    this.state = "inactive";
  });

  constructor(
    public stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? "video/webm";
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: RecorderListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  start = jest.fn((_timeslice?: number) => {
    this.state = "recording";
    this.emit("start", new Event("start"));
    this.emit(
      "dataavailable",
      Object.assign(new Event("dataavailable"), {
        data: new Blob(["media"], { type: this.mimeType }),
      }),
    );
  });

  private emit(type: string, event: Event & { data?: Blob }) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

type SourceBufferListener = () => void;

class FakeSourceBuffer {
  buffered = {
    length: 1,
    start: () => 0,
    end: () => 1.5,
  } as TimeRanges;
  mode: AppendMode = "segments";
  updating = false;
  listeners = new Map<string, SourceBufferListener[]>();

  addEventListener(type: string, listener: SourceBufferListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  appendBuffer() {
    queueMicrotask(() =>
      this.listeners.get("updateend")?.forEach((listener) => listener()),
    );
  }

  remove() {
    queueMicrotask(() =>
      this.listeners.get("updateend")?.forEach((listener) => listener()),
    );
  }
}

class FakeMediaSource {
  static isTypeSupported = jest.fn(() => true);
  readyState: ReadyState = "open";
  sourceBuffer = new FakeSourceBuffer();

  addEventListener(type: string, listener: () => void) {
    if (type === "sourceopen") queueMicrotask(listener);
  }

  addSourceBuffer() {
    return this.sourceBuffer;
  }
}

describe("localVideoMediaRelay", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    FakeBroadcastChannel.channels = [];
    FakeMediaRecorder.instances = [];
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(globalThis, "MediaSource", {
      configurable: true,
      value: FakeMediaSource,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:local-video-relay"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value: jest.fn(async () => new ArrayBuffer(8)),
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("encodes the existing capture for a local display subscriber", async () => {
    const stream = {} as MediaStream;
    const stopPublisher = publishLocalVideoMedia("source-1", stream);
    const displayChannel = new FakeBroadcastChannel(
      "worshipsync-local-video-media-v1",
    );

    displayChannel.postMessage({
      type: "subscribe",
      sourceId: "source-1",
      subscriberId: "display-1",
      audioEnabled: true,
    });

    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    expect(FakeMediaRecorder.instances[0].stream).toBe(stream);
    expect(FakeMediaRecorder.instances[0].mimeType).toBe(
      "video/webm;codecs=vp8,opus",
    );
    expect(FakeMediaRecorder.instances[0].start).toHaveBeenCalledWith(50);
    expect(displayChannel.received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "stream-start",
          subscriberId: "display-1",
        }),
        expect.objectContaining({
          type: "stream-chunk",
          subscriberId: "display-1",
          chunk: expect.any(Blob),
        }),
      ]),
    );

    displayChannel.postMessage({
      type: "unsubscribe",
      sourceId: "source-1",
      subscriberId: "display-1",
    });
    await waitFor(() =>
      expect(FakeMediaRecorder.instances[0].stop).toHaveBeenCalled(),
    );

    displayChannel.close();
    stopPublisher();
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
  });

  it("shares one encoder across subscribers with different sound settings", async () => {
    const stream = {} as MediaStream;
    const stopPublisher = publishLocalVideoMedia("source-1", stream);
    const displayChannel = new FakeBroadcastChannel(
      "worshipsync-local-video-media-v1",
    );

    displayChannel.postMessage({
      type: "subscribe",
      sourceId: "source-1",
      subscriberId: "projector",
      audioEnabled: true,
    });
    displayChannel.postMessage({
      type: "subscribe",
      sourceId: "source-1",
      subscriberId: "monitor",
      audioEnabled: false,
    });

    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    await waitFor(() =>
      expect(displayChannel.received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "stream-start",
            subscriberId: "projector",
          }),
          expect.objectContaining({
            type: "stream-start",
            subscriberId: "monitor",
          }),
          expect.objectContaining({
            type: "stream-chunk",
            subscriberId: "monitor",
          }),
        ]),
      ),
    );

    displayChannel.postMessage({
      type: "unsubscribe",
      sourceId: "source-1",
      subscriberId: "projector",
    });
    await Promise.resolve();
    expect(FakeMediaRecorder.instances[0].stop).not.toHaveBeenCalled();

    displayChannel.postMessage({
      type: "unsubscribe",
      sourceId: "source-1",
      subscriberId: "monitor",
    });
    await waitFor(() =>
      expect(FakeMediaRecorder.instances[0].stop).toHaveBeenCalled(),
    );

    displayChannel.close();
    stopPublisher();
  });

  it("keeps an audience display close to the live edge", async () => {
    const stream = {} as MediaStream;
    const stopPublisher = publishLocalVideoMedia("source-1", stream);
    const video = document.createElement("video");
    video.currentTime = 0;
    const stopSubscriber = subscribeLocalVideoMedia("source-1", video, {
      includeAudio: true,
    });

    await waitFor(() => expect(video.currentTime).toBeCloseTo(1.46, 2));
    expect(video.playbackRate).toBe(1);

    stopSubscriber();
    stopPublisher();
  });

  it("actively removes small relay drift before it becomes visible delay", async () => {
    const stopPublisher = publishLocalVideoMedia("source-1", {} as MediaStream);
    const video = document.createElement("video");
    video.currentTime = 1.41;
    const stopSubscriber = subscribeLocalVideoMedia("source-1", video);

    await waitFor(() => expect(video.playbackRate).toBe(1.08));
    expect(video.currentTime).toBeCloseTo(1.41, 2);

    stopSubscriber();
    stopPublisher();
  });

  it("reconnects an existing display when the publisher restarts", async () => {
    const stream = {} as MediaStream;
    const onStarted = jest.fn();
    const video = document.createElement("video");
    const stopFirstPublisher = publishLocalVideoMedia("source-1", stream);
    const stopSubscriber = subscribeLocalVideoMedia("source-1", video, {
      includeAudio: true,
      onStarted,
    });
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));

    stopFirstPublisher();
    const stopSecondPublisher = publishLocalVideoMedia("source-1", stream);

    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(2));

    stopSubscriber();
    stopSecondPublisher();
  });

  it("stays quiet while the capture publisher is still starting", () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const stopSubscriber = subscribeLocalVideoMedia(
      "source-starting",
      document.createElement("video"),
      { onError },
    );

    act(() => jest.advanceTimersByTime(60_000));

    expect(onError).not.toHaveBeenCalled();
    expect(mockReportLocalVideoIssue).not.toHaveBeenCalled();
    stopSubscriber();
  });

  it("warns only when a previously connected publisher stays lost", async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const onStarted = jest.fn();
    const stopPublisher = publishLocalVideoMedia("source-1", {} as MediaStream);
    const stopSubscriber = subscribeLocalVideoMedia(
      "source-1",
      document.createElement("video"),
      { onError, onStarted },
    );

    await act(async () => {
      jest.advanceTimersByTime(1);
      jest.runAllTicks();
      await Promise.resolve();
      jest.runAllTicks();
      await Promise.resolve();
    });
    expect(onStarted).toHaveBeenCalled();

    stopPublisher();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => jest.advanceTimersByTime(14_000));
    expect(onError).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(2_000));
    expect(onError).toHaveBeenCalledWith(
      "The local video publisher stopped. Check the input on this controller.",
    );
    expect(mockReportLocalVideoIssue).toHaveBeenCalledWith(
      "source-1",
      "The local video publisher stopped. Check the input on this controller.",
    );

    stopSubscriber();
  });
});
