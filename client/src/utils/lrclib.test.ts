import {
  createManualSongMetadata,
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
      source: "lrclib",
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

  it("creates manual song metadata for operator-entered details", () => {
    expect(
      createManualSongMetadata(
        {
          trackName: "  Holy Holy Holy ",
          artistName: " Reginald Heber ",
          albumName: " Hymns ",
        },
        "2026-04-05T12:00:00.000Z",
      ),
    ).toEqual({
      source: "manual",
      trackName: "Holy Holy Holy",
      artistName: "Reginald Heber",
      albumName: "Hymns",
      importedAt: "2026-04-05T12:00:00.000Z",
    });
  });

  it("creates persisted song metadata with source and import timestamp", () => {
    const metadata = createSongMetadataFromLrclib(
      {
        source: "lrclib",
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
      source: "lrclib",
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
      source: "lrclib",
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

  it("normalizes Genius-backed track payloads", () => {
    const result = normalizeLrclibTrack({
      source: "genius",
      geniusId: 99,
      geniusUrl: "https://genius.com/example-song-lyrics",
      trackName: "Firm Foundation",
      artistName: "Maverick City Music",
      plainLyrics: "Christ is my firm foundation",
      syncedLyrics: null,
    });

    expect(result).toEqual({
      source: "genius",
      geniusId: 99,
      geniusUrl: "https://genius.com/example-song-lyrics",
      trackName: "Firm Foundation",
      artistName: "Maverick City Music",
      plainLyrics: "Christ is my firm foundation",
      syncedLyrics: null,
    });
  });
});
