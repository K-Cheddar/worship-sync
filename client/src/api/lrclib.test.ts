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
      trackName: "Amazing Grace",
      artistName: "Traditional",
      plainLyrics: "Amazing grace",
      syncedLyrics: null,
    });
  });

  it("falls back to search when the exact lookup misses", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
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
          trackName: "Amazing Grace",
          artistName: "Choir",
          plainLyrics: "Amazing grace",
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
          trackName: "Order My Steps",
          artistName: "Brooklyn Tabernacle Choir",
          plainLyrics: "Order my steps",
          syncedLyrics: null,
        },
      ],
    });
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

  it("throws when LRCLIB search returns a server error", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
    });

    await expect(
      searchLrclibTracks({ trackName: "Amazing Grace" }),
    ).rejects.toThrow("Could not search LRCLIB.");
  });
});
