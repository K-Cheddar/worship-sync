import assert from "node:assert/strict";
import test from "node:test";

import {
  RichLinkPreviewInputError,
  RichLinkPreviewUnavailableError,
  createRichLinkPreviewService,
} from "./richLinkPreview.js";

test("returns normalized YouTube previews and caches URL variants", async () => {
  let calls = 0;
  const service = createRichLinkPreviewService({
    httpClient: {
      get: async (url, options) => {
        calls += 1;
        assert.equal(url, "https://www.youtube.com/oembed");
        assert.equal(
          options.params.url,
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        );
        return {
          data: {
            title: "A useful rehearsal video",
            author_name: "Example channel",
            thumbnail_url:
              "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            thumbnail_width: 480,
            thumbnail_height: 360,
          },
        };
      },
    },
  });

  const first = await service.getPreview(
    "https://youtu.be/dQw4w9WgXcQ?t=90",
  );
  const second = await service.getPreview(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );

  assert.deepEqual(first, second);
  assert.equal(first.provider, "youtube");
  assert.equal(first.creator, "Example channel");
  assert.equal(first.supportsSegments, true);
  assert.equal(calls, 1);
});

test("deduplicates concurrent preview requests", async () => {
  let calls = 0;
  const service = createRichLinkPreviewService({
    httpClient: {
      get: async () => {
        calls += 1;
        await Promise.resolve();
        return { data: { title: "Video" } };
      },
    },
  });

  await Promise.all([
    service.getPreview("https://youtu.be/dQw4w9WgXcQ"),
    service.getPreview("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
  ]);

  assert.equal(calls, 1);
});

test("returns a Spotify preview using only its allowlisted oEmbed response", async () => {
  const service = createRichLinkPreviewService({
    httpClient: {
      get: async (url, options) => {
        assert.equal(url, "https://open.spotify.com/oembed");
        assert.equal(
          options.params.url,
          "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
        );
        return {
          data: {
            title: "Reference track",
            thumbnail_url: "https://i.scdn.co/image/example",
            thumbnail_width: 300,
            thumbnail_height: 300,
            width: 456,
            height: 152,
            html: '<iframe src="https://open.spotify.com/embed/track/6rqhFgbbKwnb9MLmUQDhG6?utm_source=oembed&amp;theme=0"></iframe>',
          },
        };
      },
    },
  });

  const preview = await service.getPreview(
    "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=ignored",
  );

  assert.equal(preview.provider, "spotify");
  assert.equal(preview.kind, "track");
  assert.equal(preview.title, "Reference track");
  assert.equal(preview.embedHeight, 152);
  assert.equal(preview.supportsSegments, false);
  assert.equal(
    preview.embedUrl,
    "https://open.spotify.com/embed/track/6rqhFgbbKwnb9MLmUQDhG6?utm_source=oembed&theme=0",
  );
});

test("supports Spotify short links without following their redirect", async () => {
  const service = createRichLinkPreviewService({
    httpClient: {
      get: async (_url, options) => {
        assert.equal(options.params.url, "https://spotify.link/AbC123");
        return {
          data: {
            title: "Short-link track",
            html: '<iframe src="https://open.spotify.com/embed/track/6rqhFgbbKwnb9MLmUQDhG6"></iframe>',
          },
        };
      },
    },
  });

  const preview = await service.getPreview("https://spotify.link/AbC123?si=x");
  assert.equal(
    preview.canonicalUrl,
    "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
  );
});

test("rejects unrecognized providers before making a request", async () => {
  const service = createRichLinkPreviewService({
    httpClient: { get: async () => assert.fail("request should not run") },
  });

  await assert.rejects(
    service.getPreview("https://example.com/watch?v=dQw4w9WgXcQ"),
    RichLinkPreviewInputError,
  );
});

test("rejects a Spotify response that points its player elsewhere", async () => {
  const service = createRichLinkPreviewService({
    httpClient: {
      get: async () => ({
        data: {
          title: "Unsafe",
          html: '<iframe src="https://example.com/player"></iframe>',
        },
      }),
    },
  });

  await assert.rejects(
    service.getPreview(
      "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
    ),
    RichLinkPreviewUnavailableError,
  );
});
