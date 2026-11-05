import { captureLocalVideoInputThumbnail } from "./localVideoInputThumbnail";

describe("local video input thumbnails", () => {
  it("reports a missing or disconnected frame", async () => {
    const video = document.createElement("video");
    await expect(captureLocalVideoInputThumbnail(video)).rejects.toThrow(
      "The video input has not produced a frame yet.",
    );
  });

  it("captures one aspect-preserving frame capped at 640 by 360", async () => {
    const video = document.createElement("video");
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
    });
    const drawImage = jest.fn();
    const originalGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    const originalToBlob = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "toBlob",
    );
    const encoded = new Blob(["still"], { type: "image/webp" });
    const toBlob = jest.fn((callback: BlobCallback) => callback(encoded));
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({ drawImage }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: toBlob,
    });

    try {
      const frame = await captureLocalVideoInputThumbnail(video);
      expect(frame).toEqual({ blob: encoded, width: 640, height: 360 });
      expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360);
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.86);
    } finally {
      if (originalGetContext) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "getContext",
          originalGetContext,
        );
      } else {
        delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>)
          .getContext;
      }
      if (originalToBlob) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "toBlob",
          originalToBlob,
        );
      } else {
        delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>)
          .toBlob;
      }
    }
  });

});
