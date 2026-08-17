import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import {
  deleteLocalVideoFile,
  getLocalVideoFile,
  getOrCreateLocalVideoFileThumbnail,
  saveLocalVideoFile,
} from "./localVideoFileAssets";
import {
  getLocalImageThumbnail,
  saveLocalImageThumbnail,
} from "./localImageAssets";

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
  beforeEach(async () => {
    delete window.electronAPI;
    await deleteAssetDatabase();
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
});
