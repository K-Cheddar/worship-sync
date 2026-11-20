import {
  cancelChurchMuxUpload,
  createChurchMuxUpload,
  deleteChurchMuxAsset,
  getChurchMuxAsset,
  getChurchMuxUpload,
} from "../../../api/providerStorage";
import {
  convertMuxVideoToLocalMp4,
  pollUploadStatus,
  uploadDownloadedVideoToMux,
  uploadLocalVideoAssetToMux,
  uploadVideoToMux,
} from "./muxUpload";

jest.mock("../../../api/providerStorage", () => ({
  cancelChurchMuxUpload: jest.fn(),
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
  uploadListeners: Record<string, XhrListener[]> = {};
  upload = { addEventListener: jest.fn((type: string, listener: XhrListener) => {
    this.uploadListeners[type] = this.uploadListeners[type] || [];
    this.uploadListeners[type].push(listener);
  }) };
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
      else this.uploadListeners.progress?.forEach((listener) => listener({ lengthComputable: true, loaded: 4, total: 8 }));
      this.listeners.load?.forEach((listener) => listener({}));
    });
  });

  abort = jest.fn(() => this.listeners.abort?.forEach((listener) => listener({})));
}

const mockCancelUpload = jest.mocked(cancelChurchMuxUpload);
const mockCreateUpload = jest.mocked(createChurchMuxUpload);
const mockGetUpload = jest.mocked(getChurchMuxUpload);
const mockGetAsset = jest.mocked(getChurchMuxAsset);
const mockDeleteAsset = jest.mocked(deleteChurchMuxAsset);

describe("church-scoped Mux upload and temporary conversion", () => {
  const originalXmlHttpRequest = global.XMLHttpRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelUpload.mockResolvedValue({ cancelled: true });
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

  it("streams a disk-backed download through the native transport and the existing Mux registration workflow", async () => {
    let progressListener: ((event: { jobId: string; stage: "uploading"; progress: number | null }) => void) | undefined;
    const unsubscribe = jest.fn();
    const onVideoDownloadProgress = jest.fn((callback: typeof progressListener) => {
      progressListener = callback;
      return unsubscribe;
    });
    const uploadDownloadedVideo = jest.fn(async (jobId: string) => {
      progressListener?.({ jobId, stage: "uploading", progress: 42 });
    });
    const onProgress = jest.fn();
    const setCancelUpload = jest.fn();
    window.electronAPI = {
      uploadDownloadedVideoToMux: uploadDownloadedVideo,
      onVideoDownloadProgress,
      cancelVideoDownload: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;

    const result = await uploadDownloadedVideoToMux(
      "job-1",
      "Sunday Opener.mp4",
      { churchId: "church-1", mediaId: "media-1", title: "Sunday Opener" },
      { setCancelUpload, onProgress },
    );

    expect(uploadDownloadedVideo).toHaveBeenCalledWith("job-1", "https://upload");
    expect(mockCreateUpload).toHaveBeenCalledWith("church-1", {
      mediaId: "media-1",
      title: "Sunday Opener",
      temporary: undefined,
    });
    expect(result).toMatchObject({ playbackId: "playback-1", name: "Sunday Opener" });
    expect(onProgress).toHaveBeenCalledWith(42);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(setCancelUpload).toHaveBeenLastCalledWith(undefined);
  });

  it("cancels an active native upload transport and releases its progress subscription", async () => {
    let rejectTransport!: (error: Error) => void;
    const uploadDownloadedVideo = jest.fn(() => new Promise<void>((_resolve, reject) => {
      rejectTransport = reject;
    }));
    const cancelVideoDownload = jest.fn(async () => {
      rejectTransport(new Error("Upload cancelled."));
      return true;
    });
    const unsubscribe = jest.fn();
    const onVideoDownloadProgress = jest.fn(() => unsubscribe);
    let cancelUpload: (() => Promise<void>) | undefined;
    window.electronAPI = {
      uploadDownloadedVideoToMux: uploadDownloadedVideo,
      onVideoDownloadProgress,
      cancelVideoDownload,
    } as unknown as typeof window.electronAPI;

    const pendingUpload = uploadDownloadedVideoToMux(
      "job-2",
      "Sunday Opener.mp4",
      { churchId: "church-1", mediaId: "media-1" },
      { setCancelUpload: (cancel) => { cancelUpload = cancel; } },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(uploadDownloadedVideo).toHaveBeenCalledTimes(1);
    await expect(cancelUpload?.()).resolves.toBeUndefined();
    await expect(pendingUpload).rejects.toThrow("Cloud upload cancelled.");
    expect(cancelVideoDownload).toHaveBeenCalledWith("job-2");
    expect(mockCancelUpload).toHaveBeenCalledWith("church-1", "upload-1");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("streams a linked local asset through native Mux transport without a renderer File", async () => {
    type NativeUploadEvent = { jobId: string; stage: "uploading"; progress: number | null };
    let progressListener: ((event: NativeUploadEvent) => void) | undefined;
    const uploadLocalAsset = jest.fn(async ({ jobId }: { jobId: string }) => {
      progressListener?.({ jobId, stage: "uploading", progress: 42 });
    });
    const unsubscribe = jest.fn();
    const onProgress = jest.fn();
    const onVideoDownloadProgress = jest.fn((callback: (event: NativeUploadEvent) => void) => {
      progressListener = callback;
      return unsubscribe;
    });
    const cancelVideoDownload = jest.fn(async () => true);
    window.electronAPI = {
      uploadLocalVideoAssetToMux: uploadLocalAsset,
      onVideoDownloadProgress,
      cancelVideoDownload,
    } as unknown as typeof window.electronAPI;

    const result = await uploadLocalVideoAssetToMux(
      "local_video_link_1",
      "welcome.mp4",
      { churchId: "church-1", mediaId: "media-1", title: "Welcome" },
      { onProgress },
    );

    expect(uploadLocalAsset).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "local_video_link_1",
      url: "https://upload",
    }));
    expect(onProgress).toHaveBeenCalledWith(42);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ playbackId: "playback-1", name: "welcome" });
  });

  it("reports browser XHR progress without using the native transport", async () => {
    const xhr = new TestXmlHttpRequest();
    global.XMLHttpRequest = jest.fn(() => xhr) as unknown as typeof XMLHttpRequest;
    const onProgress = jest.fn();
    const file = new File(["video"], "camera.mp4", { type: "video/mp4" });

    await uploadVideoToMux(file, { churchId: "church-1", mediaId: "media-1" }, { onProgress });

    expect(xhr.open).toHaveBeenCalledWith("PUT", "https://upload");
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("classifies browser HTTP upload failures with the shared HTTP status message", async () => {
    const xhr = new TestXmlHttpRequest();
    xhr.status = 403;
    global.XMLHttpRequest = jest.fn(() => xhr) as unknown as typeof XMLHttpRequest;

    await expect(uploadVideoToMux(
      new File(["video"], "camera.mp4", { type: "video/mp4" }),
      { churchId: "church-1", mediaId: "media-1" },
    )).rejects.toMatchObject({
      name: "MuxUploadError",
      stage: "transport",
      message: "The cloud service rejected the video upload (HTTP 403).",
    });
  });

  it("classifies native HTTP upload failures with the same status message", async () => {
    const onVideoDownloadProgress = jest.fn(() => jest.fn());
    window.electronAPI = {
      uploadDownloadedVideoToMux: jest.fn(async () => {
        throw new Error("The cloud service rejected the video upload (HTTP 403).");
      }),
      onVideoDownloadProgress,
      cancelVideoDownload: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;

    await expect(uploadDownloadedVideoToMux(
      "job-http-error",
      "camera.mp4",
      { churchId: "church-1", mediaId: "media-1" },
    )).rejects.toMatchObject({
      name: "MuxUploadError",
      stage: "transport",
      message: "The cloud service rejected the video upload (HTTP 403).",
    });
    expect(onVideoDownloadProgress).toHaveBeenCalledTimes(1);
  });

  it("keeps native timeout failures distinct from HTTP and transport failures", async () => {
    window.electronAPI = {
      uploadDownloadedVideoToMux: jest.fn(async () => {
        throw new Error("The cloud upload timed out. Check your connection and retry.");
      }),
      onVideoDownloadProgress: jest.fn(() => jest.fn()),
      cancelVideoDownload: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;

    await expect(uploadDownloadedVideoToMux(
      "job-timeout",
      "camera.mp4",
      { churchId: "church-1", mediaId: "media-1" },
    )).rejects.toMatchObject({
      stage: "transport",
      message: "The cloud upload timed out. Check your connection and retry.",
    });
  });

  it.each([
    [
      "The cloud upload address is invalid. Retry the cloud upload or contact support.",
      "validation",
      "The cloud upload address is invalid. Retry the cloud upload or contact support.",
    ],
    [
      "The local video could not be read. Check that it is available and retry.",
      "file-read",
      "The local video could not be read. Check that it is available and retry.",
    ],
    [
      "The cloud upload connection failed. Check your connection and retry.",
      "transport",
      "The cloud upload connection failed. Check your connection and retry.",
    ],
  ])("preserves %s as a %s failure", async (detail, stage, message) => {
    window.electronAPI = {
      uploadDownloadedVideoToMux: jest.fn(async () => {
        throw new Error(detail);
      }),
      onVideoDownloadProgress: jest.fn(() => jest.fn()),
      cancelVideoDownload: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;

    await expect(uploadDownloadedVideoToMux(
      "job-distinct-failure",
      "camera.mp4",
      { churchId: "church-1", mediaId: "media-1" },
    )).rejects.toMatchObject({ stage, message });
  });

  it("redacts upload URLs and credentials from user-facing errors and diagnostics", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const uploadUrl = "https://upload.mux.com/private-upload?token=token-secret&signature=query-secret";
    window.electronAPI = {
      uploadDownloadedVideoToMux: jest.fn(async () => {
        throw new Error(`Upload failed for ${uploadUrl} signature=path-secret`);
      }),
      onVideoDownloadProgress: jest.fn(() => jest.fn()),
      cancelVideoDownload: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;

    let failure: unknown;
    try {
      await uploadDownloadedVideoToMux(
        "job-redaction",
        "camera.mp4",
        { churchId: "church-1", mediaId: "media-1" },
      );
    } catch (error) {
      failure = error;
    }

    const publicMessage = failure instanceof Error ? failure.message : String(failure);
    const diagnostics = JSON.stringify(warn.mock.calls);
    [uploadUrl, "token-secret", "query-secret", "path-secret"].forEach((secret) => {
      expect(publicMessage).not.toContain(secret);
      expect(diagnostics).not.toContain(secret);
    });
    expect(publicMessage).toContain("[URL]");
    expect(diagnostics).toContain("[MuxUpload]");
  });

  it("cleans a newly-created Mux upload without starting disk streaming if cancellation arrived during upload creation", async () => {
    const uploadDownloadedVideo = jest.fn().mockResolvedValue(undefined);
    window.electronAPI = {
      uploadDownloadedVideoToMux: uploadDownloadedVideo,
    } as unknown as typeof window.electronAPI;

    await expect(uploadDownloadedVideoToMux(
      "job-1",
      "Sunday Opener.mp4",
      { churchId: "church-1", mediaId: "media-1", title: "Sunday Opener" },
      { isCancelled: () => true },
    )).rejects.toThrow("Cloud upload cancelled.");

    expect(uploadDownloadedVideo).not.toHaveBeenCalled();
    expect(mockCancelUpload).toHaveBeenCalledWith("church-1", "upload-1");
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
    await expect(conversion).rejects.toThrow("Cloud upload cancelled.");
    expect(mockDeleteAsset).toHaveBeenCalledWith("church-1", "asset-1");
  });
});
