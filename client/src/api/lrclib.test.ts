import {
  getLrclibTrack,
  resolveLrclibImport,
  searchLrclibTracks,
} from "./lrclib";

jest.mock("../utils/environment", () => ({
  getApiBasePath: jest.fn(() => "https://api.example.com/"),
}));

describe("lrclib api", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns an exact match when LRCLIB get succeeds", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 7,
        trackName: "Amazing Grace",
        artistName: "Traditional",
        plainLyrics: "Amazing grace",
        syncedLyrics: null,
      }),
    });

    const result = await getLrclibTrack({
      trackName: "Amazing Grace",
      artistName: "Traditional",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/lrclib/get?trackName=Amazing+Grace&artistName=Traditional",
    );
    expect(result).toEqual({
      lrclibId: 7,
      source: "lrclib",
      trackName: "Amazing Grace",
      artistName: "Traditional",
      plainLyrics: "Amazing grace",
      syncedLyrics: null,
    });
  });

  it("accepts Genius-backed exact matches from the shared import endpoint", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        source: "genius",
        geniusId: 51,
        geniusUrl: "https://genius.com/example-song-lyrics",
        trackName: "Firm Foundation",
        artistName: "Maverick City Music",
        plainLyrics: "Christ is my firm foundation",
        syncedLyrics: null,
      }),
    });

    const result = await getLrclibTrack({
      trackName: "Firm Foundation",
      artistName: "Maverick City Music",
    });

    expect(result).toEqual({
      source: "genius",
      geniusId: 51,
      geniusUrl: "https://genius.com/example-song-lyrics",
      trackName: "Firm Foundation",
      artistName: "Maverick City Music",
      plainLyrics: "Christ is my firm foundation",
      syncedLyrics: null,
    });
  });

  it("returns search candidates instead of auto-selecting an exact lookup", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 11,
          track_name: "Amazing Grace",
          artist_name: "Choir",
          plainLyrics: "Amazing grace",
          syncedLyrics: null,
        },
      ],
    });

    const result = await resolveLrclibImport({
      trackName: "Amazing Grace",
      artistName: "Traditional",
    });

    expect(result).toEqual({
      match: null,
      candidates: [
        {
          lrclibId: 11,
          source: "lrclib",
          trackName: "Amazing Grace",
          artistName: "Choir",
          plainLyrics: "Amazing grace",
          syncedLyrics: null,
        },
      ],
    });
  });

  it("returns combined provider search candidates when an artist is supplied", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          source: "genius",
          geniusId: 13,
          trackName: "Great Is Thy Faithfulness",
          artistName: "Traditional",
          plainLyrics: "Great is thy faithfulness",
          syncedLyrics: null,
        },
      ],
    });

    const result = await resolveLrclibImport({
      trackName: "Great Is Thy Faithfulness",
      artistName: "Traditional",
    });

    expect(result).toEqual({
      match: null,
      candidates: [
        {
          geniusId: 13,
          source: "genius",
          trackName: "Great Is Thy Faithfulness",
          artistName: "Traditional",
          plainLyrics: "Great is thy faithfulness",
          syncedLyrics: null,
        },
      ],
    });
  });

  it("returns lyrics.ovh candidates from the shared search endpoint", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          source: "lyricsovh",
          lyricsOvhKey: "Traditional::Be Thou My Vision",
          trackName: "Be Thou My Vision",
          artistName: "Traditional",
          plainLyrics: "Be thou my vision",
          syncedLyrics: null,
        },
      ],
    });

    const result = await resolveLrclibImport({
      trackName: "Be Thou My Vision",
      artistName: "Traditional",
    });

    expect(result).toEqual({
      match: null,
      candidates: [
        {
          lyricsOvhKey: "Traditional::Be Thou My Vision",
          source: "lyricsovh",
          trackName: "Be Thou My Vision",
          artistName: "Traditional",
          plainLyrics: "Be thou my vision",
          syncedLyrics: null,
        },
      ],
    });
  });

  it("skips exact lookup and goes straight to search when artist is missing", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 12,
          track_name: "Order My Steps",
          artist_name: "Brooklyn Tabernacle Choir",
          plainLyrics: "Order my steps",
          syncedLyrics: null,
        },
      ],
    });

    const result = await resolveLrclibImport({ trackName: "Order My Steps" });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.com/api/lrclib/search?trackName=Order+My+Steps",
    );
    expect(result).toEqual({
      match: null,
      candidates: [
        {
          lrclibId: 12,
          source: "lrclib",
          trackName: "Order My Steps",
          artistName: "Brooklyn Tabernacle Choir",
          plainLyrics: "Order my steps",
          syncedLyrics: null,
        },
      ],
    });
  });

  it("keeps structured results available for operator selection", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
          {
            id: 2,
            track_name: "Owe You Praise",
            artist_name: "Elevation Worship",
            plainLyrics:
              "We're grateful people\nSo grateful\n\nYou woke me up this morning\nSo I owe You my praise\n\nWe're grateful people\nSo grateful",
          },
          {
            id: 1,
            track_name: "Owe You Praise",
            artist_name: "Elevation Worship",
            plainLyrics:
              "We're grateful people\nSo grateful\nYou woke me up this morning\nSo I owe You my praise\nWe're grateful people\nSo grateful",
          },
      ],
    });

    const result = await resolveLrclibImport({
      trackName: "Owe You Praise",
      artistName: "Elevation Worship",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.match).toBeNull();
    expect(result.candidates[0]?.lrclibId).toBe(2);
  });

  it("returns an empty candidate list when the fallback search finds nothing", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const result = await searchLrclibTracks({ trackName: "Unknown Song" });

    expect(result).toEqual([]);
  });

  it("preserves the candidate order returned by the server", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 20,
          track_name: "Clean Song",
          artist_name: "Choir",
          plainLyrics: "Grace and peace\n\nMore grace",
          syncedLyrics: null,
        },
        {
          id: 21,
          track_name: "Explicit Song",
          artist_name: "Artist",
          explicit: true,
          plainLyrics: "clean words",
          syncedLyrics: null,
        },
        {
          id: 22,
          track_name: "Rude Song",
          artist_name: "Artist",
          plainLyrics: "This lyric says fuck",
          syncedLyrics: null,
        },
      ],
    });

    const result = await searchLrclibTracks({ trackName: "Song" });

    expect(result.map((track) => track.lrclibId)).toEqual([20, 21, 22]);
    expect(result[0]).toMatchObject({
      trackName: "Clean Song",
      artistName: "Choir",
      plainLyrics: "Grace and peace\n\nMore grace",
    });
  });

  it("throws when LRCLIB search returns a server error", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
    });

    await expect(
      searchLrclibTracks({ trackName: "Amazing Grace" }),
    ).rejects.toThrow("Could not search for lyrics.");
  });
});
