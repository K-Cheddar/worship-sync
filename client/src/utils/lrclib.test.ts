import {
  createManualSongMetadata,
  createSongMetadataFromLrclib,
  extractPlainLyricsFromSyncedLyrics,
  getLyricsImportStructureScore,
  normalizeLrclibTrack,
  sortLyricsImportTracksBySource,
  sortLrclibTracksByLyricsStructure,
} from "./lrclib";

describe("lrclib utils", () => {
  it("orders lyric providers as Genius, LRCLIB, then lyrics.ovh", () => {
    const tracks = [
      normalizeLrclibTrack({
        source: "lyricsovh",
        lyricsOvhKey: "Artist/Song",
        trackName: "Song",
        artistName: "Artist",
        plainLyrics: "Lyrics.ovh",
      }),
      normalizeLrclibTrack({
        source: "lrclib",
        id: 1,
        trackName: "Song",
        artistName: "Artist",
        plainLyrics: "LRCLIB",
      }),
      normalizeLrclibTrack({
        source: "genius",
        geniusId: 2,
        trackName: "Song",
        artistName: "Artist",
        plainLyrics: "Genius",
      }),
    ];

    expect(sortLyricsImportTracksBySource(tracks).map((track) => track.source)).toEqual([
      "genius",
      "lrclib",
      "lyricsovh",
    ]);
  });

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

  it("preserves section breaks from blank pause lines in synced lyrics", () => {
    expect(
      extractPlainLyricsFromSyncedLyrics(
        "[00:01.00]Verse line 1\n[00:02.00]Verse line 2\n[00:03.00] \n[00:04.00]Chorus line 1",
      ),
    ).toBe("Verse line 1\nVerse line 2\n\nChorus line 1");
  });

  it("collapses multiple consecutive pause lines into a single section break", () => {
    expect(
      extractPlainLyricsFromSyncedLyrics(
        "[00:01.00]Verse line\n[00:02.00] \n[00:03.00] \n[00:04.00]Chorus line",
      ),
    ).toBe("Verse line\n\nChorus line");
  });

  it("ranks lyrics with section breaks above single-block LRCLIB submissions", () => {
    const poorlyStructured = normalizeLrclibTrack({
      id: 1,
      trackName: "Owe You Praise",
      artistName: "Elevation Worship",
      plainLyrics:
        "We're grateful people\nSo grateful\nYou woke me up this morning\nSo I owe You my praise",
    });
    const wellStructured = normalizeLrclibTrack({
      id: 2,
      trackName: "Owe You Praise",
      artistName: "Elevation Worship",
      plainLyrics:
        "We're grateful people\nSo grateful\n\nYou woke me up this morning\nSo I owe You my praise",
    });

    expect(getLyricsImportStructureScore(wellStructured)).toBeGreaterThan(
      getLyricsImportStructureScore(poorlyStructured),
    );
    expect(
      sortLrclibTracksByLyricsStructure([poorlyStructured, wellStructured])[0]
        .lrclibId,
    ).toBe(2);
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
