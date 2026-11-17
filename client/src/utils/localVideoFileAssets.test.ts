import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import { encodeLocalAssetThumbnailBlob, openLocalAssetDb } from "./localImageAssets";
import {
  deleteLocalVideoFile,
  getLocalVideoFile,
  getOrCreateLocalVideoFileThumbnail,
  saveLocalVideoFile,
  subscribeLocalVideoFileChanges,
} from "./localVideoFileAssets";
import {
  getLocalImageThumbnail,
  saveLocalImageThumbnail,
  saveLocalVideoThumbnail,
} from "./localImageAssets";

jest.mock("./localImageAssets", () => ({
  ...jest.requireActual("./localImageAssets"),
  encodeLocalAssetThumbnailBlob: jest.fn(),
}));

const mockedEncodeThumbnail = jest.mocked(encodeLocalAssetThumbnailBlob);

const deleteAssetDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("worshipsync-local-assets");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Database deletion was blocked."));
  });

const storedVideo = (id: string) => ({
  id,
  workspaceId: "church-1",
  blob: new Blob(["video"], { type: "video/mp4" }),
  fileName: `${id}.mp4`,
  contentType: "video/mp4",
  size: 5,
  width: 1920,
  height: 1080,
  duration: 12,
  createdAt: "2026-08-17T00:00:00.000Z",
});

const storedThumbnail = (id: string) => ({
  id,
  blob: new Blob(["thumb"], { type: "image/webp" }),
  width: 160,
  height: 90,
  createdAt: "2026-08-17T00:00:00.000Z",
});

describe("localVideoFileAssets thumbnails", () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(async () => {
    delete window.electronAPI;
    mockedEncodeThumbnail.mockReset();
    mockedEncodeThumbnail.mockResolvedValue({
      blob: new Blob(["encoded thumbnail"], { type: "image/webp" }),
      width: 160,
      height: 90,
    });
    await deleteAssetDatabase();
  });

  afterEach(() => {
    if (originalCreateImageBitmap) {
      globalThis.createImageBitmap = originalCreateImageBitmap;
    } else {
      Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
  });

  afterAll(() => deleteAssetDatabase());

  it("keeps a saved still beside the local video", async () => {
    await saveLocalVideoFile(storedVideo("local_video_1"));
    await saveLocalImageThumbnail(storedThumbnail("local_video_1"));

    await expect(getLocalVideoFile("local_video_1")).resolves.toEqual(
      expect.objectContaining({ id: "local_video_1" }),
    );
    await expect(getLocalImageThumbnail("local_video_1")).resolves.toEqual(
      expect.objectContaining({
        id: "local_video_1",
        width: 160,
        height: 90,
      }),
    );
  });

  it("prefers a valid source thumbnail over a black opening frame and keys it by the video asset id", async () => {
    const bitmap = { width: 1280, height: 720, close: jest.fn() } as unknown as ImageBitmap;
    globalThis.createImageBitmap = jest.fn(async () => bitmap) as typeof createImageBitmap;
    const createElement = jest.spyOn(document, "createElement");
    const sourceThumbnail = new Blob(["source image"], { type: "image/jpeg" });

    await saveLocalVideoFile(storedVideo("local_video_download_source"), {
      thumbnailBlob: sourceThumbnail,
    });

    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(sourceThumbnail);
    expect(mockedEncodeThumbnail).toHaveBeenCalledWith(bitmap, 1280, 720);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(createElement.mock.calls.filter(([tag]) => String(tag).toLowerCase() === "video")).toHaveLength(0);
    await expect(getLocalImageThumbnail("local_video_download_source")).resolves.toMatchObject({
      id: "local_video_download_source",
      width: 160,
      height: 90,
    });
    createElement.mockRestore();
  });

  it("finishes saving a downloaded video while its thumbnail is still being prepared", async () => {
    const bitmap = { width: 1280, height: 720, close: jest.fn() } as unknown as ImageBitmap;
    let resolveBitmap: ((value: ImageBitmap) => void) | undefined;
    let markBitmapRequested: (() => void) | undefined;
    const bitmapRequested = new Promise<void>((resolve) => {
      markBitmapRequested = resolve;
    });
    globalThis.createImageBitmap = jest.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
      markBitmapRequested?.();
    })) as typeof createImageBitmap;
    const video = storedVideo("local_video_download_nonblocking_thumb");

    await saveLocalVideoFile(video, {
      thumbnailBlob: new Blob(["source image"], { type: "image/jpeg" }),
      deferThumbnail: true,
    });
    await expect(getLocalVideoFile(video.id)).resolves.toMatchObject({ id: video.id });
    expect(mockedEncodeThumbnail).not.toHaveBeenCalled();

    const thumbnailPromise = getOrCreateLocalVideoFileThumbnail(video.id);
    await bitmapRequested;
    expect(mockedEncodeThumbnail).not.toHaveBeenCalled();
    resolveBitmap?.(bitmap);
    await expect(thumbnailPromise).resolves.toMatchObject({ id: video.id, width: 160 });
    expect(mockedEncodeThumbnail).toHaveBeenCalledWith(bitmap, 1280, 720);
  });

  it("does not recreate a thumbnail when the video is deleted during generation", async () => {
    const bitmap = { width: 1280, height: 720, close: jest.fn() } as unknown as ImageBitmap;
    let resolveBitmap: ((value: ImageBitmap) => void) | undefined;
    let markBitmapRequested: (() => void) | undefined;
    const bitmapRequested = new Promise<void>((resolve) => {
      markBitmapRequested = resolve;
    });
    globalThis.createImageBitmap = jest.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
      markBitmapRequested?.();
    })) as typeof createImageBitmap;
    const video = storedVideo("local_video_download_deleted_during_thumb");
    const sourceThumbnail = new Blob(["source image"], { type: "image/jpeg" });

    await saveLocalVideoFile(video, { thumbnailBlob: sourceThumbnail, deferThumbnail: true });
    const thumbnailPromise = getOrCreateLocalVideoFileThumbnail(video.id);
    await bitmapRequested;
    await deleteLocalVideoFile(video.id);
    resolveBitmap?.(bitmap);

    await expect(thumbnailPromise).resolves.toBeUndefined();
    await expect(getLocalVideoFile(video.id)).resolves.toBeUndefined();
    await expect(getLocalImageThumbnail(video.id)).resolves.toBeUndefined();
  });

  it("uses the existing video frame fallback when no source thumbnail is available", async () => {
    const createElement = jest.spyOn(document, "createElement");
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:local-video");
    URL.revokeObjectURL = jest.fn();
    try {
      const video = storedVideo("local_video_download_fallback");
      await saveLocalVideoFile(video);
      await expect(getLocalVideoFile(video.id)).resolves.toMatchObject({ id: video.id });

      expect(createElement.mock.calls.filter(([tag]) => String(tag).toLowerCase() === "video")).toHaveLength(1);
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      createElement.mockRestore();
    }
  });

  it("keeps the video usable when thumbnail decoding or IndexedDB thumbnail saving fails", async () => {
    globalThis.createImageBitmap = jest.fn().mockRejectedValue(new Error("unsupported source image")) as typeof createImageBitmap;
    await saveLocalVideoFile(storedVideo("local_video_download_bad_thumb"), {
      thumbnailBlob: new Blob(["bad image"], { type: "image/png" }),
    });

    await expect(getLocalVideoFile("local_video_download_bad_thumb")).resolves.toMatchObject({
      id: "local_video_download_bad_thumb",
    });
    await expect(getLocalImageThumbnail("local_video_download_bad_thumb")).resolves.toBeUndefined();
  });

  it("retries source thumbnail persistence under one stable asset key", async () => {
    const bitmap = { width: 640, height: 360, close: jest.fn() } as unknown as ImageBitmap;
    globalThis.createImageBitmap = jest.fn(async () => bitmap) as typeof createImageBitmap;
    const video = storedVideo("local_video_download_retry");
    const thumbnailBlob = new Blob(["source image"], { type: "image/webp" });

    await saveLocalVideoFile(video, { thumbnailBlob });
    await saveLocalVideoFile(video, { thumbnailBlob });

    const db = await openLocalAssetDb();
    try {
      const count = await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction("imageThumbnails", "readonly");
        const request = transaction.objectStore("imageThumbnails").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("uses byte IPC for a downloaded conversion in Electron", async () => {
    const importLocalAssetBytes = jest.fn().mockResolvedValue({
      assetId: "local_video_converted",
      contentType: "video/mp4",
      url: "worshipsync-media://asset/local_video_converted",
    });
    window.electronAPI = {
      importLocalAssetBytes,
    } as unknown as NonNullable<typeof window.electronAPI>;

    const file = new File(["video"], "local_video_converted.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new ArrayBuffer(5),
    });

    await saveLocalVideoFile(
      {
        ...storedVideo("local_video_converted"),
        blob: file,
      },
      { importBytes: true },
    );

    expect(importLocalAssetBytes).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({
        assetId: "local_video_converted",
        contentType: "video/mp4",
      }),
    );
    await expect(
      getLocalVideoFile("local_video_converted"),
    ).resolves.toEqual(expect.objectContaining({ blob: undefined }));
  });

  it("reuses a stored still instead of decoding the original again", async () => {
    await saveLocalVideoFile(storedVideo("local_video_cached"));
    await saveLocalImageThumbnail(storedThumbnail("local_video_cached"));
    const createElement = jest.spyOn(document, "createElement");

    await expect(
      getOrCreateLocalVideoFileThumbnail("local_video_cached"),
    ).resolves.toEqual(
      expect.objectContaining({ id: "local_video_cached", width: 160 }),
    );
    expect(
      createElement.mock.calls.filter(
        ([tagName]) => String(tagName).toLowerCase() === "video",
      ),
    ).toHaveLength(0);
    createElement.mockRestore();
  });

  it("removes the still when the local video is deleted", async () => {
    await saveLocalVideoFile(storedVideo("local_video_deleted"));
    await saveLocalImageThumbnail(storedThumbnail("local_video_deleted"));
    await deleteLocalVideoFile("local_video_deleted");

    await expect(
      getLocalVideoFile("local_video_deleted"),
    ).resolves.toBeUndefined();
    await expect(
      getLocalImageThumbnail("local_video_deleted"),
    ).resolves.toBeUndefined();
  });

  it("rejects an older thumbnail after the same playback ID adopts replacement content", async () => {
    const video = { ...storedVideo("stable-video"), contentHash: "a".repeat(64) };
    await saveLocalVideoFile(video);
    await saveLocalImageThumbnail(storedThumbnail(video.id));
    await saveLocalVideoFile({ ...video, contentHash: "b".repeat(64) }, { invalidateThumbnail: true, deferThumbnail: true });
    await expect(saveLocalVideoThumbnail(storedThumbnail(video.id), video.contentHash)).resolves.toBe(false);
    await expect(getLocalImageThumbnail(video.id)).resolves.toBeUndefined();
    await expect(saveLocalVideoThumbnail(storedThumbnail(video.id), "b".repeat(64))).resolves.toBe(true);
  });

  it("fans native committed changes out through the existing renderer event", () => {
    let notify!: (id: string) => void;
    const subscribe = jest.fn((listener: (id: string) => void) => { notify = listener; return jest.fn(); });
    window.electronAPI = { onLocalVideoAssetChanged: subscribe } as unknown as typeof window.electronAPI;
    const first = jest.fn(); const second = jest.fn();
    const stopFirst = subscribeLocalVideoFileChanges(first);
    const stopSecond = subscribeLocalVideoFileChanges(second);
    notify("stable");
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith("stable"); expect(second).toHaveBeenCalledWith("stable");
    stopFirst(); stopSecond();
  });
});
