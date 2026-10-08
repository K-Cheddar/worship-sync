import { createPreviewSourceCache } from "./previewSourceCache";
import { createChurchResourcePreview, createSongAudioPreview, resolvePreviewSource } from "./contentPreview";
import type { ChurchResource } from "../../types/churchResource";

describe("preview source cache", () => {
  it("reuses valid sources and deduplicates pending requests", async () => {
    const cache = createPreviewSourceCache();
    const load = jest.fn(async () => ({ url: "https://files.test/guide.pdf", sourceKind: "file" as const }));
    const [first, second] = await Promise.all([cache.resolve("guide", load), cache.resolve("guide", load)]);
    expect(first).toBe(second);
    expect(await cache.resolve("guide", load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refreshes 45 seconds before exact expiry, or after a conservative fallback TTL", async () => {
    let now = 0;
    const cache = createPreviewSourceCache(() => now);
    const signed = jest.fn(async () => ({ url: "https://files.test/signed", expiresAt: new Date(300_000).toISOString() }));
    const fallback = jest.fn(async () => ({ url: "https://files.test/no-expiry" }));
    await cache.resolve("signed", signed);
    await cache.resolve("fallback", fallback);
    now = 119_999;
    await cache.resolve("fallback", fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    now = 120_000;
    await cache.resolve("fallback", fallback);
    expect(fallback).toHaveBeenCalledTimes(2);
    now = 254_999;
    await cache.resolve("signed", signed);
    expect(signed).toHaveBeenCalledTimes(1);
    now = 255_000;
    await cache.resolve("signed", signed);
    expect(signed).toHaveBeenCalledTimes(2);
  });

  it("does not retain failed or unavailable resolutions", async () => {
    const cache = createPreviewSourceCache();
    const load = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ url: "https://files.test/retry" });
    await expect(cache.resolve("retry", load)).rejects.toThrow("offline");
    await expect(cache.resolve("retry", load)).resolves.toEqual({ url: "https://files.test/retry" });
    expect(load).toHaveBeenCalledTimes(2);
    const unavailable = jest.fn(async () => ({ url: "", sourceKind: "unavailable" as const, reason: "Access denied" }));
    await cache.resolve("denied", unavailable);
    await cache.resolve("denied", unavailable);
    expect(unavailable).toHaveBeenCalledTimes(2);
  });

  it("bounds entries to 100", async () => {
    const cache = createPreviewSourceCache();
    const load = jest.fn(async () => ({ url: "https://files.test/file" }));
    for (let index = 0; index <= 100; index += 1) await cache.resolve(String(index), load);
    await cache.resolve("100", load);
    expect(load).toHaveBeenCalledTimes(101);
    await cache.resolve("0", load);
    expect(load).toHaveBeenCalledTimes(102);
  });

  it("allows retry after a stalled request and ignores its late completion", async () => {
    jest.useFakeTimers();
    try {
      const cache = createPreviewSourceCache();
      let finish!: (source: { url: string }) => void;
      const pending = cache.resolve("file", () => new Promise((resolve) => { finish = resolve; }));
      const failure = pending.catch((error: Error) => error);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(await failure).toEqual(new Error("The preview could not be prepared in time."));
      const fresh = jest.fn(async () => ({ url: "https://files.test/fresh" }));
      await cache.resolve("file", fresh);
      finish({ url: "https://files.test/stale" });
      expect(await cache.resolve("file", fresh)).toEqual({ url: "https://files.test/fresh" });
      expect(fresh).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keys uploads by content identity and song audio by song, key and upload version", () => {
    const resource: ChurchResource = {
      id: "file", churchId: "church", name: "Guide", kind: "document",
      createdAt: "", createdBy: "", updatedAt: "", updatedBy: "",
      storage: { key: "key", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 1, uploadedAt: "v1" },
    };
    expect(createChurchResourcePreview(resource).cacheKey).not.toEqual(createChurchResourcePreview({ ...resource, contentVersion: "v2" }).cacheKey);
    const audio = { id: "audio", key: "key", fileName: "audio.mp3", contentType: "audio/mpeg" as const, sizeBytes: 1, uploadedAt: "v1" };
    const load = async () => ({ url: "https://files.test/audio" });
    expect(createSongAudioPreview(audio, "song-1", load).cacheKey).not.toEqual(createSongAudioPreview(audio, "song-2", load).cacheKey);
    expect(createSongAudioPreview(audio, "song-1", load).cacheKey).not.toEqual(createSongAudioPreview({ ...audio, uploadedAt: "v2" }, "song-1", load).cacheKey);
  });

  it("does not cache an unsafe resolver URL", async () => {
    const cache = createPreviewSourceCache();
    const load = jest.fn().mockResolvedValueOnce({ url: "file:///private" }).mockResolvedValue({ url: "https://files.test/safe" });
    const resource = { id: "safe", resolveSource: load };
    await expect(resolvePreviewSource(resource, cache)).rejects.toThrow("unsupported URL");
    await expect(resolvePreviewSource(resource, cache)).resolves.toEqual({ url: "https://files.test/safe" });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
