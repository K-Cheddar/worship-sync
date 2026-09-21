import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { MediaCacheManager } from "./mediaCache";

const mockGetPath = jest.fn();

jest.mock("electron", () => ({
  app: {
    getPath: (...args: string[]) => mockGetPath(...args),
  },
}));

describe("MediaCacheManager", () => {
  let tempRoot: string;

  beforeEach(() => {
    jest.restoreAllMocks();
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), "worship-sync-media-cache-"));
    mockGetPath.mockReturnValue(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("keeps the cache entry when a file cannot be deleted yet", async () => {
    const manager = new MediaCacheManager();
    const localPath = join(tempRoot, "media-cache", "busy.mp4");
    fs.writeFileSync(localPath, "video");

    manager["cacheIndex"].set("https://cdn.example.com/busy.mp4", {
      url: "https://cdn.example.com/busy.mp4",
      localPath,
      lastUsed: Date.now(),
      contentType: "video/mp4",
    });

    manager["cleanupFile"] = jest.fn(() => false);

    await manager.cleanupUnusedMedia(new Set());

    expect(manager.getAllCachedUrls()).toEqual([
      "https://cdn.example.com/busy.mp4",
    ]);
  });

  it("shares one download for simultaneous requests for the same Mux asset", async () => {
    const manager = new MediaCacheManager();
    const muxHlsUrl = "https://stream.mux.com/playback-id/master.m3u8";
    const cachedPath = join(tempRoot, "media-cache", "playback-id.mp4");
    let resolveDownload: (path: string | null) => void = () => undefined;
    const pendingDownload = new Promise<string | null>((resolve) => {
      resolveDownload = resolve;
    });
    const downloadMediaInternal = jest.fn(() => pendingDownload);
    manager["downloadMediaInternal"] = downloadMediaInternal;

    const firstRequest = manager.downloadMedia(muxHlsUrl);
    const secondRequest = manager.downloadMedia(muxHlsUrl);

    expect(downloadMediaInternal).toHaveBeenCalledTimes(1);

    resolveDownload(cachedPath);

    await expect(firstRequest).resolves.toBe(cachedPath);
    await expect(secondRequest).resolves.toBe(cachedPath);
    expect(manager["inFlightDownloads"].size).toBe(0);
  });

  it("shares a download between equivalent Mux URL formats", async () => {
    const manager = new MediaCacheManager();
    const muxHlsUrl = "https://stream.mux.com/playback-id/master.m3u8";
    const muxMp4Url = "https://stream.mux.com/playback-id/highest.mp4";
    const cachedPath = join(tempRoot, "media-cache", "playback-id.mp4");
    const downloadMediaInternal = jest.fn(() => Promise.resolve(cachedPath));
    manager["downloadMediaInternal"] = downloadMediaInternal;

    const [fromHls, fromMp4] = await Promise.all([
      manager.downloadMedia(muxHlsUrl),
      manager.downloadMedia(muxMp4Url),
    ]);

    expect(downloadMediaInternal).toHaveBeenCalledTimes(1);
    expect(fromHls).toBe(cachedPath);
    expect(fromMp4).toBe(cachedPath);
  });

  it("maps both stored Mux playback URL forms to one cached MP4", () => {
    const manager = new MediaCacheManager();
    const localPath = join(tempRoot, "media-cache", "playback-id.mp4");
    fs.writeFileSync(localPath, "video");
    manager["cacheIndex"].set(
      "https://stream.mux.com/playback-id/highest.mp4",
      {
        url: "https://stream.mux.com/playback-id/highest.mp4",
        localPath,
        lastUsed: Date.now(),
        contentType: "video/mp4",
      },
    );

    const map = manager.getMediaCacheMap();

    expect(map["https://stream.mux.com/playback-id/highest.mp4"]).toBe(
      "media-cache://playback-id.mp4",
    );
    expect(map["https://stream.mux.com/playback-id.m3u8"]).toBe(
      "media-cache://playback-id.mp4",
    );
    expect(map["https://stream.mux.com/playback-id/master.m3u8"]).toBe(
      "media-cache://playback-id.mp4",
    );
  });

  it("additively ensures unique cacheable URLs without removing unrelated entries", async () => {
    const manager = new MediaCacheManager();
    const unrelatedPath = join(tempRoot, "media-cache", "unrelated.mp4");
    fs.writeFileSync(unrelatedPath, "video");
    manager["cacheIndex"].set("https://cdn.example.com/unrelated.mp4", {
      url: "https://cdn.example.com/unrelated.mp4",
      localPath: unrelatedPath,
      lastUsed: Date.now(),
    });
    const downloadMedia = jest
      .spyOn(manager, "downloadMedia")
      .mockResolvedValue(join(tempRoot, "media-cache", "new.mp4"));

    const result = await manager.ensureMediaCached([
      "https://stream.mux.com/playback-id.m3u8",
      "https://stream.mux.com/playback-id/master.m3u8",
      "https://example.com/live.m3u8",
    ]);

    expect(downloadMedia).toHaveBeenCalledTimes(1);
    expect(downloadMedia).toHaveBeenCalledWith(
      "https://stream.mux.com/playback-id.m3u8",
    );
    expect(result).toMatchObject({ requested: 3, cacheable: 1, downloaded: 1 });
    expect(manager.getAllCachedUrls()).toContain(
      "https://cdn.example.com/unrelated.mp4",
    );
  });

  it("returns cache metadata for the dev prepared-video picker", () => {
    const manager = new MediaCacheManager();
    const localPath = join(tempRoot, "media-cache", "clip.mp4");
    fs.writeFileSync(localPath, "video");
    manager["cacheIndex"].set("https://cdn.example.com/clip.mp4", {
      url: "https://cdn.example.com/clip.mp4",
      localPath,
      lastUsed: Date.now(),
      contentType: "video/mp4",
    });

    expect(manager.getMediaCacheEntries()).toEqual([
      {
        source: "media-cache://clip.mp4",
        sourceUrl: "https://cdn.example.com/clip.mp4",
        contentType: "video/mp4",
      },
    ]);
  });
});
