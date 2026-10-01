import { act, render, screen } from "@testing-library/react";
import { PreparedSurface, waitForEvent, waitForPresentedFrame } from "./PreparedVideoSurfaces";

describe("prepared video experiment waits", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("pauses a surface when metadata preparation times out", async () => {
    jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const pause = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(
      <PreparedSurface
        mediaKey="metadata-timeout"
        source="media-cache://metadata-timeout.mp4"
        strategy="opacity"
        onControl={() => undefined}
        onMetric={() => undefined}
      />,
    );

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(pause).toHaveBeenCalled();
  });

  it("pauses a surface when its prepared frame times out", async () => {
    jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(
      <PreparedSurface
        mediaKey="frame-timeout"
        source="media-cache://frame-timeout.mp4"
        strategy="opacity"
        onControl={() => undefined}
        onMetric={() => undefined}
      />,
    );
    const video = screen.getByTestId("prepared-surface-frame-timeout");
    const requestFrame = jest.fn(() => 17);
    Object.defineProperty(video, "requestVideoFrameCallback", { value: requestFrame });
    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestFrame).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(pause).toHaveBeenCalled();
  });

  it("removes event listeners when an event wait times out", async () => {
    const video = document.createElement("video");
    const removeListener = jest.spyOn(video, "removeEventListener");
    const surfaceWait = waitForEvent(video, "loadedmetadata");
    const rejection = surfaceWait.promise.then(() => null, (error: Error) => error);

    jest.advanceTimersByTime(5_000);

    await expect(rejection).resolves.toMatchObject({ message: "loadedmetadata timeout" });
    expect(removeListener).toHaveBeenCalledWith("loadedmetadata", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("cancels a pending video-frame callback on timeout", async () => {
    const video = document.createElement("video") as HTMLVideoElement & {
      requestVideoFrameCallback: jest.Mock;
      cancelVideoFrameCallback: jest.Mock;
    };
    video.requestVideoFrameCallback = jest.fn(() => 21);
    video.cancelVideoFrameCallback = jest.fn();
    const surfaceWait = waitForPresentedFrame(video);
    const rejection = surfaceWait.promise.then(() => null, (error: Error) => error);

    jest.advanceTimersByTime(5_000);

    await expect(rejection).resolves.toMatchObject({ message: "presented-frame timeout" });
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(21);
  });

  it("cancels the queued animation frame when the wait is cancelled", async () => {
    let nextFrameId = 0;
    const cancelAnimationFrame = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => ++nextFrameId);
    const surfaceWait = waitForPresentedFrame(document.createElement("video"));
    const rejection = surfaceWait.promise.then(() => null, (error: Error) => error);

    surfaceWait.cancel();
    await expect(rejection).resolves.toMatchObject({ message: "presented-frame wait cancelled" });

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
