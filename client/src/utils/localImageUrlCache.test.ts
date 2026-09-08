import {
  getLocalImage,
  getOrCreateLocalImageThumbnail,
} from "./localImageAssets";
import {
  acquireLocalImageThumbnailUrl,
  acquireLocalImageUrl,
  invalidateLocalImageUrl,
  peekLocalImageUrl,
} from "./localImageUrlCache";

jest.mock("./localImageAssets", () => ({
  getLocalImage: jest.fn(),
  getOrCreateLocalImageThumbnail: jest.fn(),
  subscribeLocalImageChanges: jest.fn(() => jest.fn()),
  subscribeLocalImageThumbnailChanges: jest.fn(() => jest.fn()),
}));

const mockGetLocalImage = jest.mocked(getLocalImage);
const mockGetOrCreateLocalImageThumbnail = jest.mocked(
  getOrCreateLocalImageThumbnail,
);

describe("localImageUrlCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    delete window.electronAPI;
    let nextUrl = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => `blob:cached-${++nextUrl}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    mockGetLocalImage.mockImplementation(async (id) => ({
      id,
      workspaceId: "church-1",
      blob: new Blob([id], { type: "image/png" }),
      fileName: `${id}.png`,
      contentType: "image/png",
      size: id.length,
      width: 100,
      height: 100,
      createdAt: "2026-08-12T00:00:00.000Z",
    }));
    mockGetOrCreateLocalImageThumbnail.mockImplementation(async (id) => ({
      id,
      blob: new Blob(["thumb"], { type: "image/webp" }),
      width: 160,
      height: 90,
      createdAt: "2026-08-12T00:00:00.000Z",
    }));
  });

  afterEach(() => jest.useRealTimers());

  it("uses Electron's versioned streaming URL without materializing a blob", async () => {
    const getLocalAsset = jest.fn().mockResolvedValue({
      assetId: "native-asset",
      url: "worshipsync-media://asset/native-asset?v=hash-1",
    });
    window.electronAPI = {
      getLocalAsset,
    } as unknown as NonNullable<typeof window.electronAPI>;

    const lease = acquireLocalImageUrl("native-asset");

    await expect(lease.url).resolves.toBe(
      "worshipsync-media://asset/native-asset?v=hash-1",
    );
    expect(getLocalAsset).toHaveBeenCalledWith("native-asset");
    expect(mockGetLocalImage).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    lease.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps IndexedDB images created by older Electron builds available", async () => {
    window.electronAPI = {
      getLocalAsset: jest.fn().mockResolvedValue(undefined),
    } as unknown as NonNullable<typeof window.electronAPI>;

    const lease = acquireLocalImageUrl("legacy-native-asset");

    await expect(lease.url).resolves.toBe("blob:cached-1");
    expect(mockGetLocalImage).toHaveBeenCalledWith("legacy-native-asset");
    lease.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-1");
  });

  it("shares one blob URL and releases it after the final consumer", async () => {
    const first = acquireLocalImageUrl("shared-asset");
    const second = acquireLocalImageUrl("shared-asset");

    await expect(first.url).resolves.toBe("blob:cached-1");
    await expect(second.url).resolves.toBe("blob:cached-1");
    expect(peekLocalImageUrl("shared-asset")).toBe("blob:cached-1");
    expect(mockGetLocalImage).toHaveBeenCalledTimes(1);

    first.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    second.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-1");
  });

  it("keeps outline thumbnails on a cache separate from full display blobs", async () => {
    const lease = acquireLocalImageThumbnailUrl("outline-asset");

    await expect(lease.url).resolves.toBe("blob:cached-1");
    expect(mockGetOrCreateLocalImageThumbnail).toHaveBeenCalledWith(
      "outline-asset",
    );
    expect(mockGetLocalImage).not.toHaveBeenCalled();

    lease.release();
  });

  it("keeps replacement reference counts independent during relink", async () => {
    const oldLease = acquireLocalImageUrl("relinked-asset");
    await oldLease.url;
    oldLease.release();
    invalidateLocalImageUrl("relinked-asset");
    expect(peekLocalImageUrl("relinked-asset")).toBeUndefined();
    const newLease = acquireLocalImageUrl("relinked-asset");
    await expect(newLease.url).resolves.toBe("blob:cached-2");

    jest.advanceTimersByTime(650);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:cached-1");

    jest.advanceTimersByTime(9_350);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-1");

    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:cached-2");
    newLease.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-2");
  });

  it("pins an active legacy URL through its first revisioned relink", async () => {
    const oldLease = acquireLocalImageUrl("legacy-relinked-asset");
    await expect(oldLease.url).resolves.toBe("blob:cached-1");

    invalidateLocalImageUrl("legacy-relinked-asset");
    expect(peekLocalImageUrl("legacy-relinked-asset")).toBe("blob:cached-1");
    const outgoingLease = acquireLocalImageUrl("legacy-relinked-asset");
    await expect(outgoingLease.url).resolves.toBe("blob:cached-1");
    const replacementLease = acquireLocalImageUrl(
      "legacy-relinked-asset",
      "revision-1",
    );
    await expect(replacementLease.url).resolves.toBe("blob:cached-2");

    oldLease.release();
    outgoingLease.release();
    jest.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-1");
    replacementLease.release();
  });

  it("keeps the outgoing byte revision addressable during a relink", async () => {
    const oldLease = acquireLocalImageUrl("versioned-asset", "revision-1");
    await expect(oldLease.url).resolves.toBe("blob:cached-1");

    invalidateLocalImageUrl("versioned-asset");
    expect(peekLocalImageUrl("versioned-asset", "revision-1")).toBe(
      "blob:cached-1",
    );

    const outgoingLease = acquireLocalImageUrl("versioned-asset", "revision-1");
    const replacementLease = acquireLocalImageUrl(
      "versioned-asset",
      "revision-2",
    );
    await expect(outgoingLease.url).resolves.toBe("blob:cached-1");
    await expect(replacementLease.url).resolves.toBe("blob:cached-2");
    expect(mockGetLocalImage).toHaveBeenCalledTimes(2);

    oldLease.release();
    outgoingLease.release();
    jest.advanceTimersByTime(650);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:cached-1");

    jest.advanceTimersByTime(9_350);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-1");
    replacementLease.release();
  });

  it("revokes a URL whose database read finishes after invalidation", async () => {
    let resolveStored:
      | ((value: Awaited<ReturnType<typeof getLocalImage>>) => void)
      | undefined;
    mockGetLocalImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStored = resolve;
        }),
    );
    const lease = acquireLocalImageUrl("slow-asset");

    invalidateLocalImageUrl("slow-asset");
    lease.release();
    jest.advanceTimersByTime(10_000);
    resolveStored?.({
      id: "slow-asset",
      blob: new Blob(["slow"], { type: "image/png" }),
      fileName: "slow.png",
      contentType: "image/png",
      size: 4,
      width: 100,
      height: 100,
      createdAt: "2026-08-12T00:00:00.000Z",
    });

    await expect(lease.url).resolves.toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-1");
  });
});
