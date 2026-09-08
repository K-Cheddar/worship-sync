import {
  publishLocalVideoCaptureQuality,
  subscribeLocalVideoCaptureQuality,
} from "./localVideoCaptureQualityRelay";

type MessageListener = (event: MessageEvent<unknown>) => void;

const advanceTimers = async (milliseconds: number) => {
  await Promise.resolve();
  jest.advanceTimersByTime(milliseconds);
  await Promise.resolve();
};

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

describe("localVideoCaptureQualityRelay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeBroadcastChannel.channels = [];
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies only the highest active output requirement", async () => {
    const videoTrack = {
      applyConstraints: jest.fn().mockResolvedValue(undefined),
    };
    const stream = {
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoCaptureQuality("source-1", stream);
    const projector = subscribeLocalVideoCaptureQuality(
      "source-1",
      1_920,
      1_080,
    );
    const monitor = subscribeLocalVideoCaptureQuality("source-1", 2_560, 1_440);

    await advanceTimers(250);
    expect(videoTrack.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 2_560 },
      height: { ideal: 1_440 },
      frameRate: { ideal: 60 },
    });
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    monitor.stop();
    await advanceTimers(9_999);
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);
    await advanceTimers(1);
    expect(videoTrack.applyConstraints).toHaveBeenLastCalledWith({
      width: { ideal: 1_920 },
      height: { ideal: 1_080 },
      frameRate: { ideal: 60 },
    });

    projector.stop();
    stopPublisher();
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
  });

  it("updates capture demand when a display moves or resizes", async () => {
    const videoTrack = {
      applyConstraints: jest.fn().mockResolvedValue(undefined),
    };
    const stream = {
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoCaptureQuality("source-1", stream);
    const output = subscribeLocalVideoCaptureQuality("source-1", 1_920, 1_080);

    output.updateTargetSize(3_840, 2_160);
    await advanceTimers(250);
    expect(videoTrack.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 3_840 },
      height: { ideal: 2_160 },
      frameRate: { ideal: 60 },
    });

    output.stop();
    stopPublisher();
  });

  it("cancels a pending downgrade when the high-resolution output returns", async () => {
    const videoTrack = {
      applyConstraints: jest.fn().mockResolvedValue(undefined),
    };
    const stream = {
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoCaptureQuality("source-1", stream);
    const projector = subscribeLocalVideoCaptureQuality(
      "source-1",
      1_920,
      1_080,
    );
    let highResolutionOutput = subscribeLocalVideoCaptureQuality(
      "source-1",
      2_560,
      1_440,
    );

    await advanceTimers(250);
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    highResolutionOutput.stop();
    await advanceTimers(2_000);
    highResolutionOutput = subscribeLocalVideoCaptureQuality(
      "source-1",
      2_560,
      1_440,
    );
    await advanceTimers(10_000);

    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    highResolutionOutput.stop();
    projector.stop();
    stopPublisher();
  });

  it("coalesces rapid profile changes and never applies constraints concurrently", async () => {
    let finishFirstChange: (() => void) | undefined;
    const firstChange = new Promise<void>((resolve) => {
      finishFirstChange = resolve;
    });
    const videoTrack = {
      applyConstraints: jest
        .fn()
        .mockReturnValueOnce(firstChange)
        .mockResolvedValue(undefined),
    };
    const stream = {
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoCaptureQuality("source-1", stream);
    const output = subscribeLocalVideoCaptureQuality("source-1", 2_560, 1_440);

    await advanceTimers(250);
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    output.updateTargetSize(3_840, 2_160);
    await advanceTimers(250);
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    finishFirstChange?.();
    await firstChange;
    await Promise.resolve();
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(2);
    expect(videoTrack.applyConstraints).toHaveBeenLastCalledWith({
      width: { ideal: 3_840 },
      height: { ideal: 2_160 },
      frameRate: { ideal: 60 },
    });

    output.stop();
    stopPublisher();
  });

  it("keeps a healthy stream and does not retry a rejected live mode", async () => {
    const videoTrack = {
      applyConstraints: jest.fn().mockRejectedValue(new Error("fixed mode")),
    };
    const stream = {
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const stopPublisher = publishLocalVideoCaptureQuality("source-1", stream);
    const firstOutput = subscribeLocalVideoCaptureQuality(
      "source-1",
      2_560,
      1_440,
    );

    await advanceTimers(250);
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    const secondOutput = subscribeLocalVideoCaptureQuality(
      "source-1",
      2_560,
      1_440,
    );
    await advanceTimers(1_000);
    expect(videoTrack.applyConstraints).toHaveBeenCalledTimes(1);

    firstOutput.stop();
    secondOutput.stop();
    stopPublisher();
  });
});
