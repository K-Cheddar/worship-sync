import {
  getVideoPreload,
  getVideoSourceKind,
  isHLSVideoSource,
  isInstantVideoSource,
} from "./isInstantVideoSource";

describe("isInstantVideoSource", () => {
  it("treats local and cached protocols as instant", () => {
    expect(isInstantVideoSource("media-cache://clip.mp4")).toBe(true);
    expect(isInstantVideoSource("worshipsync-media://asset/1")).toBe(true);
    expect(isInstantVideoSource("blob:https://localhost/1")).toBe(true);
  });

  it("treats remote streams as non-instant", () => {
    expect(isInstantVideoSource("https://cdn.example.com/clip.mp4")).toBe(
      false,
    );
    expect(isInstantVideoSource("https://stream.example.com/live.m3u8")).toBe(
      false,
    );
    expect(isInstantVideoSource(undefined)).toBe(false);
  });

  it("distinguishes finite files from HLS manifests for display loading", () => {
    expect(isHLSVideoSource("https://stream.example.com/live.m3u8")).toBe(true);
    expect(
      isHLSVideoSource("https://stream.example.com/live.m3u8?token=abc"),
    ).toBe(true);
    expect(isHLSVideoSource("https://cdn.example.com/clip.mp4")).toBe(false);

    expect(getVideoPreload("https://cdn.example.com/clip.mp4", "output")).toBe(
      "auto",
    );
    expect(getVideoPreload("https://cdn.example.com/clip.mp4", "preview")).toBe(
      "metadata",
    );
    expect(getVideoPreload("https://cdn.example.com/clip.mp4")).toBe(
      "metadata",
    );
    expect(getVideoPreload("https://stream.example.com/live.m3u8")).toBe(
      "metadata",
    );
    expect(getVideoPreload("media-cache://clip.mp4")).toBe("auto");
    expect(getVideoPreload("media-cache://cached-manifest.m3u8")).toBe(
      "metadata",
    );
    expect(getVideoSourceKind("https://cdn.example.com/clip.mp4")).toBe(
      "network",
    );
    expect(getVideoSourceKind("media-cache://clip.mp4")).toBe("cache");
    expect(getVideoSourceKind("worshipsync-media://asset/1")).toBe("local");
    expect(getVideoSourceKind("https://stream.example.com/live.m3u8")).toBe(
      "hls",
    );
  });
});
