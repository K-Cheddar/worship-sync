import {
  PREPARED_VIDEO_EMPTY_STATE_MESSAGE,
  resolvePreparedVideoSources,
  selectPreparedVideoSources,
} from "./preparedVideoSurfaceEligibility";

describe("prepared video surface eligibility", () => {
  const entries = [
    { source: "media-cache://photo.jpg", contentType: "image/jpeg" },
    { source: "media-cache://slide.png", contentType: "image/png" },
    { source: "media-cache://animated.gif", contentType: "image/gif" },
    { source: "media-cache://clip.mp4", contentType: "video/mp4" },
    { source: "media-cache://clip.webm" },
    { source: "media-cache://live.m3u8", contentType: "application/vnd.apple.mpegurl" },
  ];

  it("excludes image entries and HLS while including finite videos", () => {
    expect(resolvePreparedVideoSources(entries).map((entry) => entry.source)).toEqual([
      "media-cache://clip.mp4",
      "media-cache://clip.webm",
    ]);
  });

  it("selects the first N eligible videos, not arbitrary cache entries", () => {
    const sources = resolvePreparedVideoSources(entries);
    expect(selectPreparedVideoSources(sources, 1).map((entry) => entry.source)).toEqual([
      "media-cache://clip.mp4",
    ]);
    expect(selectPreparedVideoSources(sources, 10)).toHaveLength(2);
  });

  it("returns an empty source list when the cache has no eligible videos", () => {
    expect(
      resolvePreparedVideoSources([
        { source: "media-cache://photo.webp", contentType: "image/webp" },
        { source: "media-cache://art.svg", contentType: "image/svg+xml" },
      ]),
    ).toEqual([]);
    expect(PREPARED_VIDEO_EMPTY_STATE_MESSAGE).toMatch(/Open or cache a service or media library containing videos/);
  });
});
