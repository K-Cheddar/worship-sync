import {
  formatYouTubeTimestamp,
  getYouTubeVideoReference,
  parseYouTubeTimestamp,
} from "./youtube";

describe("getYouTubeVideoReference", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ])("normalizes supported YouTube URLs: %s", (url) => {
    expect(getYouTubeVideoReference(url)).toEqual({
      videoId: "dQw4w9WgXcQ",
      watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      startSeconds: undefined,
    });
  });

  it.each([
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "ftp://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=too-short",
    "not a URL",
  ])("rejects unsupported or invalid URLs: %s", (url) => {
    expect(getYouTubeVideoReference(url)).toBeNull();
  });

  it("preserves a timestamp from a shared YouTube URL", () => {
    expect(
      getYouTubeVideoReference(
        "https://youtu.be/dQw4w9WgXcQ?t=1h2m3s",
      )?.startSeconds,
    ).toBe(3723);
  });
});

describe("YouTube timestamps", () => {
  it.each([
    ["90", 90],
    ["1:30", 90],
    ["1:02:03", 3723],
    ["1h2m3s", 3723],
  ])("parses %s", (value, expected) => {
    expect(parseYouTubeTimestamp(value)).toBe(expected);
  });

  it.each(["", "1:60", "abc", "1.5"])("rejects %s", (value) => {
    expect(parseYouTubeTimestamp(value)).toBeNull();
  });

  it("formats seconds for operators", () => {
    expect(formatYouTubeTimestamp(90)).toBe("1:30");
    expect(formatYouTubeTimestamp(3723)).toBe("1:02:03");
  });
});
