import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { createLyricsImportService } from "../lyricsImport.js";

/**
 * Genius scraping requests always hit genius.com/api.genius.com directly, so
 * these tests monkey-patch axios.get (matching the pattern already used by
 * server/restreamService.test.js) instead of hitting the network.
 */
const withMockedAxiosGet = async (mockImplementation, fn) => {
  const originalGet = axios.get;
  axios.get = mockImplementation;
  try {
    await fn();
  } finally {
    axios.get = originalGet;
  }
};

test("getGeniusTrack propagates search failures so callers can fall back to LRCLIB", async () => {
  const service = createLyricsImportService({
    geniusAccessToken: "test-token",
  });

  await withMockedAxiosGet(
    async (url) => {
      assert.ok(url.startsWith("https://api.genius.com/search"));
      const error = new Error("Request failed with status code 401");
      error.response = { status: 401 };
      throw error;
    },
    async () => {
      await assert.rejects(() =>
        service.getGeniusTrack({
          track_name: "Amazing Grace",
          artist_name: "Chris Tomlin",
        }),
      );
    },
  );
});

test("getGeniusTrack resolves to null when the lyrics page has no lyrics container", async () => {
  // A 200 response missing the lyrics container simulates Genius serving a
  // bot-challenge/interstitial page instead of the real song page, which is
  // the most likely production failure mode when scraping from a cloud IP.
  const service = createLyricsImportService({
    geniusAccessToken: "test-token",
  });

  await withMockedAxiosGet(
    async (url) => {
      if (url.startsWith("https://api.genius.com/search")) {
        return {
          data: {
            response: {
              hits: [
                {
                  type: "song",
                  result: {
                    id: 1,
                    url: "https://genius.com/chris-tomlin-amazing-grace-lyrics",
                    title: "Amazing Grace",
                    primary_artist: { name: "Chris Tomlin" },
                    instrumental: false,
                  },
                },
              ],
            },
          },
        };
      }

      return {
        status: 200,
        data: "<html><body>Just a moment...</body></html>",
      };
    },
    async () => {
      const track = await service.getGeniusTrack({
        track_name: "Amazing Grace",
        artist_name: "Chris Tomlin",
      });

      assert.equal(track, null);
    },
  );
});

test("getGeniusTrack returns normalized lyrics when Genius search and scrape both succeed", async () => {
  const service = createLyricsImportService({
    geniusAccessToken: "test-token",
  });

  await withMockedAxiosGet(
    async (url) => {
      if (url.startsWith("https://api.genius.com/search")) {
        return {
          data: {
            response: {
              hits: [
                {
                  type: "song",
                  result: {
                    id: 42,
                    url: "https://genius.com/chris-tomlin-amazing-grace-lyrics",
                    title: "Amazing Grace",
                    primary_artist: { name: "Chris Tomlin" },
                    instrumental: false,
                  },
                },
              ],
            },
          },
        };
      }

      return {
        status: 200,
        data:
          "<div id=\"lyrics-root\"><div data-lyrics-container='true'>1 Contributor Amazing Grace Lyrics" +
          "[Verse 1]<br>Amazing grace<br>How sweet the sound</div></div>",
      };
    },
    async () => {
      const track = await service.getGeniusTrack({
        track_name: "Amazing Grace",
        artist_name: "Chris Tomlin",
      });

      assert.equal(track?.source, "genius");
      assert.equal(track?.plainLyrics, "Amazing grace\nHow sweet the sound");
    },
  );
});

test("getLrclibTrack derives plain lyrics from synced lyrics and preserves section breaks", async () => {
  const service = createLyricsImportService({});

  await withMockedAxiosGet(
    async (url) => {
      assert.equal(url, "https://lrclib.net/api/get");
      return {
        data: {
          id: 100,
          trackName: "Amazing Grace",
          artistName: "Chris Tomlin",
          syncedLyrics:
            "[00:01.00]Amazing grace\n[00:02.00]How sweet the sound\n[00:03.00] \n[00:04.00]My chains are gone",
        },
      };
    },
    async () => {
      const track = await service.getLrclibTrack({
        track_name: "Amazing Grace",
        artist_name: "Chris Tomlin",
      });

      assert.equal(
        track.plainLyrics,
        "Amazing grace\nHow sweet the sound\n\nMy chains are gone",
      );
    },
  );
});

test("searchLrclibTracks ranks better-structured lyrics ahead of LRCLIB default order", async () => {
  const service = createLyricsImportService({});

  await withMockedAxiosGet(
    async (url) => {
      assert.equal(url, "https://lrclib.net/api/search");
      return {
        data: [
          {
            id: 1,
            trackName: "Owe You Praise",
            artistName: "Elevation Worship",
            plainLyrics:
              "We're grateful people\nSo grateful\nYou woke me up this morning\nSo I owe You my praise\nPraises\nOh Lord, You deserve",
          },
          {
            id: 2,
            trackName: "Owe You Praise",
            artistName: "Elevation Worship",
            plainLyrics:
              "We're grateful people\nSo grateful\n\nYou woke me up this morning\nSo I owe You my praise\n\nPraises\nOh Lord, You deserve",
          },
        ],
      };
    },
    async () => {
      const tracks = await service.searchLrclibTracks({
        track_name: "Owe You Praise",
        artist_name: "Elevation Worship",
      });

      assert.equal(tracks.length, 2);
      assert.equal(tracks[0].lrclibId, 2);
      assert.match(tracks[0].plainLyrics ?? "", /\n\n/);
    },
  );
});
