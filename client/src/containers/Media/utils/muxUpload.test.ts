import {
  createChurchMuxUpload,
  deleteChurchMuxAsset,
  getChurchMuxAsset,
  getChurchMuxUpload,
} from "../../../api/providerStorage";
import {
  convertMuxVideoToLocalMp4,
  pollUploadStatus,
} from "./muxUpload";

jest.mock("../../../api/providerStorage", () => ({
  createChurchMuxUpload: jest.fn(),
  deleteChurchMuxAsset: jest.fn(),
  getChurchMuxAsset: jest.fn(),
  getChurchMuxUpload: jest.fn(),
}));

type XhrListener = (event: unknown) => void;

class TestXmlHttpRequest {
  status = 200;
  response: Blob | undefined;
  responseType = "";
  method = "";
  url = "";
  upload = { addEventListener: jest.fn() };
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
      if (this.method === "GET") this.response = new Blob(["converted"], { type: "video/mp4" });
      this.listeners.load?.forEach((listener) => listener({}));
    });
  });

  abort = jest.fn(() => this.listeners.abort?.forEach((listener) => listener({})));
}

const mockCreateUpload = jest.mocked(createChurchMuxUpload);
const mockGetUpload = jest.mocked(getChurchMuxUpload);
const mockGetAsset = jest.mocked(getChurchMuxAsset);
const mockDeleteAsset = jest.mocked(deleteChurchMuxAsset);

describe("church-scoped Mux upload and temporary conversion", () => {
  const originalXmlHttpRequest = global.XMLHttpRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateUpload.mockResolvedValue({ uploadId: "upload-1", url: "https://upload" });
    mockGetUpload.mockResolvedValue({ status: "asset_created", assetId: "asset-1" });
    mockGetAsset.mockResolvedValue({
      status: "ready",
      playbackId: "playback-1",
      duration: 60,
      staticRenditionReady: true,
    });
    mockDeleteAsset.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    global.XMLHttpRequest = originalXmlHttpRequest;
    jest.restoreAllMocks();
  });

  it("cancels pending church-scoped upload status polling", async () => {
    mockGetUpload.mockResolvedValue({ status: "waiting" });
    let cancelled = false;
    let cancelPolling: (() => void) | undefined;
    let resolvePollingStarted: (() => void) | undefined;
    const pollingStarted = new Promise<void>((resolve) => { resolvePollingStarted = resolve; });
    const polling = pollUploadStatus("upload-1", "church-1", {
      isCancelled: () => cancelled,
      addTimeout: (_timeoutId, cancel) => {
        cancelPolling = cancel;
        resolvePollingStarted?.();
      },
    });
    await pollingStarted;
    cancelled = true;
    cancelPolling?.();
    await expect(polling).rejects.toThrow("Upload cancelled");
    expect(mockGetUpload).toHaveBeenCalledWith("church-1", "upload-1");
  });

  it("downloads a static MP4 and removes the temporary Mux asset", async () => {
    const uploadXhr = new TestXmlHttpRequest();
    const downloadXhr = new TestXmlHttpRequest();
    const xhrs = [uploadXhr, downloadXhr];
    global.XMLHttpRequest = jest.fn(() => xhrs.shift() as TestXmlHttpRequest) as unknown as typeof XMLHttpRequest;
    const source = new File(["source"], "camera.mov", { type: "video/quicktime" });
    const converted = await convertMuxVideoToLocalMp4(source, "church-1");
    expect(converted.name).toBe("camera.mp4");
    expect(converted.type).toBe("video/mp4");
    expect(converted.size).toBeGreaterThan(0);
    expect(downloadXhr.open).toHaveBeenCalledWith("GET", "https://stream.mux.com/playback-1/highest.mp4");
    expect(mockCreateUpload).toHaveBeenCalledWith("church-1", expect.objectContaining({ temporary: true }));
    expect(mockGetAsset).toHaveBeenCalledWith("church-1", "asset-1");
    expect(mockDeleteAsset).toHaveBeenCalledWith("church-1", "asset-1");
  });

  it("removes an uncommitted asset after rendition polling is cancelled", async () => {
    const uploadXhr = new TestXmlHttpRequest();
    global.XMLHttpRequest = jest.fn(() => uploadXhr) as unknown as typeof XMLHttpRequest;
    mockGetAsset.mockResolvedValue({ status: "processing", staticRenditionReady: false });
    let cancelled = false;
    let cancelPolling: (() => void) | undefined;
    let resolvePollingStarted: (() => void) | undefined;
    const pollingStarted = new Promise<void>((resolve) => { resolvePollingStarted = resolve; });
    const source = new File(["source"], "camera.mov", { type: "video/quicktime" });
    const conversion = convertMuxVideoToLocalMp4(source, "church-1", {
      isCancelled: () => cancelled,
      addTimeout: (_timeoutId, cancel) => {
        cancelPolling = cancel;
        resolvePollingStarted?.();
      },
    });
    await pollingStarted;
    cancelled = true;
    cancelPolling?.();
    await expect(conversion).rejects.toThrow("Upload cancelled");
    expect(mockDeleteAsset).toHaveBeenCalledWith("church-1", "asset-1");
  });
});
