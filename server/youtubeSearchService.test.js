import assert from "node:assert/strict";
import test from "node:test";

import {
  YouTubeSearchInputError,
  YouTubeSearchUpstreamError,
  buildYouTubeSearchQuery,
  createYouTubeSearchService,
} from "./youtubeSearchService.js";

const searchResponse = (items) => ({ data: { items } });

const makeClient = () => {
  const calls = [];
  const client = {
    calls,
    get: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/search")) {
        return searchResponse([
          {
            id: { videoId: "dQw4w9WgXcQ" },
            snippet: {
              title: "Example official video",
              channelTitle: "Example Channel",
              description: "Description",
              publishedAt: "2026-01-01T00:00:00Z",
              thumbnails: { high: { url: "https://img.example/thumb.jpg" } },
            },
          },
        ]);
      }
      return { data: { items: [{ id: "dQw4w9WgXcQ", contentDetails: { duration: "PT3M12S" }, status: { embeddable: true } }] } };
    },
  };
  return client;
};

test("builds a useful generated query from song metadata", () => {
  assert.equal(
    buildYouTubeSearchQuery({
      title: "  Living   Hope ",
      artist: "Phil Wickham",
      album: "The Ascension",
    }),
    "Living Hope Phil Wickham",
  );
  assert.equal(buildYouTubeSearchQuery({ title: "Build My Life" }), "Build My Life");
  assert.equal(
    buildYouTubeSearchQuery({ title: "Build My Life", album: "Worship Sessions" }),
    "Build My Life Worship Sessions",
  );
});

test("accepts an edited query and returns normalized enriched results", async () => {
  const client = makeClient();
  const service = createYouTubeSearchService({ httpClient: client, apiKey: "server-only" });

  const result = await service.search({
    title: "Living Hope",
    query: "  Phil   Wickham   live version ",
  });

  assert.equal(result.query, "Phil Wickham live version");
  assert.deepEqual(result.results[0], {
    videoId: "dQw4w9WgXcQ",
    title: "Example official video",
    channelName: "Example Channel",
    thumbnail: "https://img.example/thumb.jpg",
    description: "Description",
    publishedAt: "2026-01-01T00:00:00Z",
    durationSeconds: 192,
    embeddable: true,
    watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.equal(client.calls[0].options.params.q, "Phil Wickham live version");
  assert.equal(client.calls[0].options.params.key, "server-only");
});

test("reuses normalized cache entries and force refresh bypasses them", async () => {
  const client = makeClient();
  const service = createYouTubeSearchService({ httpClient: client, apiKey: "key" });

  await service.search({ query: "Living   Hope" });
  const cached = await service.search({ query: " living hope " });
  assert.equal(cached.cached, true);
  assert.equal(client.calls.filter((call) => call.url.endsWith("/search")).length, 1);

  const refreshed = await service.search({ query: "living hope", forceRefresh: true });
  assert.equal(refreshed.cached, false);
  assert.equal(client.calls.filter((call) => call.url.endsWith("/search")).length, 2);
});

test("rejects an empty search before calling YouTube", async () => {
  const client = makeClient();
  const service = createYouTubeSearchService({ httpClient: client, apiKey: "key" });

  await assert.rejects(
    service.search({}),
    (error) => error instanceof YouTubeSearchInputError,
  );
  assert.equal(client.calls.length, 0);
});

test("does not include the API key in normalized client results", async () => {
  const client = makeClient();
  const result = await createYouTubeSearchService({
    httpClient: client,
    apiKey: "do-not-return-this",
  }).search({ query: "song" });

  assert.equal(JSON.stringify(result).includes("do-not-return-this"), false);
});

test("turns an upstream API failure into a clean WorshipSync error", async () => {
  const client = {
    get: async () => {
      throw new Error("quota details should stay server-side");
    },
  };
  const service = createYouTubeSearchService({ httpClient: client, apiKey: "key" });

  await assert.rejects(
    service.search({ query: "song" }),
    (error) =>
      error instanceof YouTubeSearchUpstreamError &&
      error.message === "YouTube search is unavailable right now. Try again.",
  );
});
