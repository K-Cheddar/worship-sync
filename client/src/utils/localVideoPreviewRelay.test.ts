import { waitFor } from "@testing-library/react";
import {
  publishLocalVideoPreview,
  subscribeLocalVideoPreview,
} from "./localVideoPreviewRelay";

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
      .forEach((channel) => {
        queueMicrotask(() => {
          channel.listeners.forEach((listener) =>
            listener({ data: message } as MessageEvent<unknown>),
          );
        });
      });
  }

  close() {
    FakeBroadcastChannel.channels = FakeBroadcastChannel.channels.filter(
      (channel) => channel !== this,
    );
  }
}

describe("localVideoPreviewRelay", () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels = [];
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["preview"], { type: "image/webp" })),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("skips preview encoding without subscribers and clears relay intervals on stop", async () => {
    jest.useFakeTimers();
    const video = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const clearInterval = jest.spyOn(window, "clearInterval");
    const stopPublishing = publishLocalVideoPreview("source-no-viewers", video);

    jest.advanceTimersByTime(670);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();

    const stopPreview = subscribeLocalVideoPreview(
      "source-no-viewers",
      jest.fn(),
    );
    await Promise.resolve();
    jest.advanceTimersByTime(67);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1);

    stopPreview();
    stopPublishing();
    expect(clearInterval).toHaveBeenCalledTimes(2);
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
  });

  it("relays bounded frames without creating a network peer connection", async () => {
    const video = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const onFrame = jest.fn();
    const stopPublishing = publishLocalVideoPreview("source-1", video);
    const stopPreview = subscribeLocalVideoPreview("source-1", onFrame);

    await waitFor(() => expect(onFrame).toHaveBeenCalledWith(expect.any(Blob)));
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/webp",
      0.82,
    );

    stopPreview();
    stopPublishing();
    expect(FakeBroadcastChannel.channels).toHaveLength(0);
  });
});
