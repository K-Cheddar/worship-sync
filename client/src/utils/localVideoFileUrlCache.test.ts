import { getLocalVideoFile, getOrCreateLocalVideoFileThumbnail } from "./localVideoFileAssets";
import {
  acquireLocalVideoFileThumbnailUrl,
  acquireLocalVideoFileUrl,
  peekLocalVideoFileThumbnailUrl,
  peekLocalVideoFileUrl,
} from "./localVideoFileUrlCache";

jest.mock("./localVideoFileAssets", () => ({
  getLocalVideoFile: jest.fn(),
  getOrCreateLocalVideoFileThumbnail: jest.fn(),
  subscribeLocalVideoFileChanges: jest.fn(() => jest.fn()),
}));

const mockGetLocalVideoFile = jest.mocked(getLocalVideoFile);
const mockGetOrCreateLocalVideoFileThumbnail = jest.mocked(
  getOrCreateLocalVideoFileThumbnail,
);

describe("localVideoFileUrlCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    delete window.electronAPI;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:local-video"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    mockGetLocalVideoFile.mockResolvedValue({
      id: "video-1",
      blob: new Blob(["video"], { type: "video/mp4" }),
      fileName: "video.mp4",
      contentType: "video/mp4",
      size: 5,
      width: 1920,
      height: 1080,
      duration: 30,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    mockGetOrCreateLocalVideoFileThumbnail.mockResolvedValue({
      id: "video-1",
      blob: new Blob(["thumb"], { type: "image/webp" }),
      width: 160,
      height: 90,
      createdAt: "2026-08-17T00:00:00.000Z",
    });
  });

  afterEach(() => jest.useRealTimers());

  it("shares one browser object URL and revokes it after the final consumer", async () => {
    const first = acquireLocalVideoFileUrl("video-1", "revision-1");
    const second = acquireLocalVideoFileUrl("video-1", "revision-1");

    await expect(first.url).resolves.toBe("blob:local-video");
    await expect(second.url).resolves.toBe("blob:local-video");
    expect(mockGetLocalVideoFile).toHaveBeenCalledTimes(1);
    expect(peekLocalVideoFileUrl("video-1", "revision-1")).toBe(
      "blob:local-video",
    );

    first.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    second.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-video");
  });

  it("uses Electron's streamable protocol URL without reading IndexedDB", async () => {
    const getLocalAsset = jest.fn().mockResolvedValue({
      assetId: "video-native",
      url: "worshipsync-media://asset/video-native?v=hash",
    });
    window.electronAPI = {
      getLocalAsset,
    } as unknown as NonNullable<typeof window.electronAPI>;

    const lease = acquireLocalVideoFileUrl("video-native", "revision-1");
    await expect(lease.url).resolves.toBe(
      "worshipsync-media://asset/video-native?v=hash",
    );
    expect(mockGetLocalVideoFile).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    lease.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("revokes an object URL if its IndexedDB read finishes after release", async () => {
    let resolveStored:
      | ((value: Awaited<ReturnType<typeof getLocalVideoFile>>) => void)
      | undefined;
    mockGetLocalVideoFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStored = resolve;
        }),
    );
    const lease = acquireLocalVideoFileUrl("slow-video");

    lease.release();
    jest.advanceTimersByTime(10_000);
    resolveStored?.({
      id: "slow-video",
      blob: new Blob(["video"], { type: "video/mp4" }),
      fileName: "slow.mp4",
      contentType: "video/mp4",
      size: 5,
      width: 1920,
      height: 1080,
      duration: 30,
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    await expect(lease.url).resolves.toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-video");
  });

  it("keeps list thumbnails on a cache separate from the playback URL", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:local-video-thumb"),
    });
    const lease = acquireLocalVideoFileThumbnailUrl("video-1", "revision-1");

    await expect(lease.url).resolves.toBe("blob:local-video-thumb");
    expect(mockGetOrCreateLocalVideoFileThumbnail).toHaveBeenCalledWith(
      "video-1",
    );
    expect(mockGetLocalVideoFile).not.toHaveBeenCalled();
    expect(peekLocalVideoFileThumbnailUrl("video-1", "revision-1")).toBe(
      "blob:local-video-thumb",
    );
    expect(peekLocalVideoFileUrl("video-1", "revision-1")).toBeUndefined();

    lease.release();
  });
});
