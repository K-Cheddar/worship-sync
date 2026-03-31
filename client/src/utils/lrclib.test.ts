import {
  createSongMetadataFromLrclib,
  extractPlainLyricsFromSyncedLyrics,
  normalizeLrclibTrack,
} from "./lrclib";

describe("lrclib utils", () => {
  it("normalizes LRCLIB track payloads and derives plain lyrics when needed", () => {
    const result = normalizeLrclibTrack({
      id: 15,
      trackName: "Amazing Grace",
      artistName: "John Newton",
      albumName: "Hymns",
      duration: 245,
      instrumental: false,
      syncedLyrics: "[00:01.00]Amazing\n[00:02.00]Grace",
    });

    expect(result).toEqual({
      lrclibId: 15,
      trackName: "Amazing Grace",
      artistName: "John Newton",
      albumName: "Hymns",
      durationMs: 245000,
      instrumental: false,
      plainLyrics: "Amazing\nGrace",
      syncedLyrics: "[00:01.00]Amazing\n[00:02.00]Grace",
    });
  });

  it("extracts plain lyrics from synced lines and drops empty metadata lines", () => {
    expect(
      extractPlainLyricsFromSyncedLyrics(
        "[ar:Artist]\n[00:01.00]Line 1\n[00:02.00]Line 2",
      ),
    ).toBe("Line 1\nLine 2");
  });

  it("creates persisted song metadata with source and import timestamp", () => {
    const metadata = createSongMetadataFromLrclib(
      {
        lrclibId: 20,
        trackName: "Song",
        artistName: "Artist",
        plainLyrics: "Words",
        syncedLyrics: null,
      },
      "2026-03-30T12:00:00.000Z",
    );

    expect(metadata).toEqual({
      source: "lrclib",
      importedAt: "2026-03-30T12:00:00.000Z",
      lrclibId: 20,
      trackName: "Song",
      artistName: "Artist",
      plainLyrics: "Words",
      syncedLyrics: null,
    });
  });

  it("accepts tracks that are already normalized by the server", () => {
    const result = normalizeLrclibTrack({
      lrclibId: 3937704,
      trackName: "Order My Steps",
      artistName: "GMWA Women of Worship",
      albumName: "WOW Gospel 1998",
      durationMs: 285000,
      instrumental: false,
      plainLyrics: "Order my steps",
      syncedLyrics: "[00:01.06] Order my steps",
    });

    expect(result).toEqual({
      lrclibId: 3937704,
      trackName: "Order My Steps",
      artistName: "GMWA Women of Worship",
      albumName: "WOW Gospel 1998",
      durationMs: 285000,
      instrumental: false,
      plainLyrics: "Order my steps",
      syncedLyrics: "[00:01.06] Order my steps",
    });
  });
});
