import {
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
});
