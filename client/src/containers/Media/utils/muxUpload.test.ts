import {
  convertMuxVideoToLocalMp4,
  pollUploadStatus,
} from "./muxUpload";

type XhrListener = (event: unknown) => void;

class TestXmlHttpRequest {
  status = 200;
  response: Blob | undefined;
  responseType = "";
  method = "";
  url = "";
  upload = {
    addEventListener: jest.fn(),
  };
  private readonly listeners: Record<string, XhrListener[]> = {};

  open = jest.fn((method: string, url: string) => {
    this.method = method;
    this.url = url;
  });

  addEventListener = jest.fn((type: string, listener: XhrListener) => {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  });

  send = jest.fn(() => {
    queueMicrotask(() => {
      if (this.method === "GET") {
        this.response = new Blob(["converted"], { type: "video/mp4" });
      }
      this.listeners.load?.forEach((listener) => listener({}));
    });
  });

  abort = jest.fn(() => {
    this.listeners.abort?.forEach((listener) => listener({}));
  });
}

describe("convertMuxVideoToLocalMp4", () => {
  const originalFetch = global.fetch;
  const originalXmlHttpRequest = global.XMLHttpRequest;

  afterEach(() => {
    global.fetch = originalFetch;
    global.XMLHttpRequest = originalXmlHttpRequest;
    jest.restoreAllMocks();
  });

  it("cancels pending upload status polling", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "waiting" }),
    });

    let cancelled = false;
    let cancelPolling: (() => void) | undefined;
    let resolvePollingStarted: (() => void) | undefined;
    const pollingStarted = new Promise<void>((resolve) => {
      resolvePollingStarted = resolve;
    });
    const polling = pollUploadStatus("upload-1", {
      isCancelled: () => cancelled,
      addTimeout: (_timeoutId, cancel) => {
        cancelPolling = cancel;
        resolvePollingStarted?.();
      },
    });

    await pollingStarted;
    cancelled = true;
    if (!cancelPolling) {
      throw new Error("Expected a pending polling timer to be cancellable");
    }
    cancelPolling();

    await expect(polling).rejects.toThrow("Upload cancelled");
  });

  it("downloads a static MP4 and removes the temporary Mux asset", async () => {
    const uploadXhr = new TestXmlHttpRequest();
    const downloadXhr = new TestXmlHttpRequest();
    const xhrs = [uploadXhr, downloadXhr];
    global.XMLHttpRequest = jest.fn(
      () => xhrs.shift() as TestXmlHttpRequest,
    ) as unknown as typeof XMLHttpRequest;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uploadId: "upload-1", url: "https://upload" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "asset_created", assetId: "asset-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ready",
          playbackId: "playback-1",
          staticRenditionReady: true,
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const source = new File(["source"], "camera.mov", {
      type: "video/quicktime",
    });
    const converted = await convertMuxVideoToLocalMp4(source);

    expect(converted.name).toBe("camera.mp4");
    expect(converted.type).toBe("video/mp4");
    expect(converted.size).toBeGreaterThan(0);
    expect(downloadXhr.open).toHaveBeenCalledWith(
      "GET",
      "https://stream.mux.com/playback-1/highest.mp4",
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      "/api/mux/asset/asset-1",
      { method: "DELETE" },
    );
  });

  it("cancels pending rendition polling and removes the temporary Mux asset", async () => {
    const uploadXhr = new TestXmlHttpRequest();
    global.XMLHttpRequest = jest.fn(
      () => uploadXhr,
    ) as unknown as typeof XMLHttpRequest;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uploadId: "upload-1", url: "https://upload" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "asset_created", assetId: "asset-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "processing",
          playbackId: undefined,
          staticRenditionReady: false,
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    let cancelled = false;
    let cancelPolling: (() => void) | undefined;
    let resolvePollingStarted: (() => void) | undefined;
    const pollingStarted = new Promise<void>((resolve) => {
      resolvePollingStarted = resolve;
    });
    const source = new File(["source"], "camera.mov", {
      type: "video/quicktime",
    });
    const conversion = convertMuxVideoToLocalMp4(source, {
      isCancelled: () => cancelled,
      addTimeout: (_timeoutId, cancel) => {
        cancelPolling = cancel;
        resolvePollingStarted?.();
      },
    });

    await pollingStarted;
    cancelled = true;
    if (!cancelPolling) {
      throw new Error("Expected a pending polling timer to be cancellable");
    }
    cancelPolling();

    await expect(conversion).rejects.toThrow("Upload cancelled");
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      "/api/mux/asset/asset-1",
      { method: "DELETE" },
    );
  });
});
