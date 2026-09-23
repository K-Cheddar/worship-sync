import {
  areEquivalentMediaSources,
  classifyMediaSource,
  isPlayableMediaSource,
} from "./mediaSource";

describe("media source boundary", () => {
  it("distinguishes opaque persisted references from playable URLs", () => {
    expect(classifyMediaSource("local-video-file://asset123")).toBe(
      "opaque-reference",
    );
    expect(classifyMediaSource("local-image://asset123")).toBe(
      "opaque-reference",
    );
    expect(isPlayableMediaSource("worshipsync-media://asset/asset123/file.mp4")).toBe(
      true,
    );
    expect(isPlayableMediaSource("media-cache://asset123.mp4")).toBe(true);
    expect(isPlayableMediaSource("blob:https://example.test/video")).toBe(true);
    expect(isPlayableMediaSource("https://cdn.example.test/video.mp4")).toBe(true);
  });

  it("compares canonicalized Electron custom-protocol media URLs", () => {
    expect(
      areEquivalentMediaSources(
        "media-cache://abc.mp4",
        "media-cache://abc.mp4/",
      ),
    ).toBe(true);
    expect(
      areEquivalentMediaSources(
        "worshipsync-media://asset/video.mp4",
        "worshipsync-media://asset/video.mp4/",
      ),
    ).toBe(true);
    expect(
      areEquivalentMediaSources(
        "https://cdn.example.test/video.mp4",
        "https://CDN.EXAMPLE.TEST:443/video.mp4/",
      ),
    ).toBe(true);
  });
});
