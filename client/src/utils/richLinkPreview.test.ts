import { getRichLinkReference } from "./richLinkPreview";

describe("getRichLinkReference", () => {
  it("normalizes supported YouTube links", () => {
    expect(
      getRichLinkReference("https://youtu.be/dQw4w9WgXcQ?t=90"),
    ).toEqual({ provider: "youtube", cacheKey: "youtube:dQw4w9WgXcQ" });
  });

  it.each([
    [
      "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=abc",
      "spotify:track:6rqhFgbbKwnb9MLmUQDhG6",
    ],
    [
      "https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy",
      "spotify:album:4aawyAB9vmqN3uQ7FjRGTy",
    ],
    ["https://spotify.link/AbC_123", "spotify:short:AbC_123"],
  ])("recognizes supported Spotify links", (url, cacheKey) => {
    expect(getRichLinkReference(url)).toEqual({
      provider: "spotify",
      cacheKey,
    });
  });

  it.each([
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://open.spotify.com/unsupported/abc",
    "https://spotify.example/track/abc",
    "data:text/plain,not-a-link-preview",
  ])("leaves unsupported links generic: %s", (url) => {
    expect(getRichLinkReference(url)).toBeNull();
  });
});
