import {
  classifyVideoFailure,
  friendlyVideoFailure,
  logVideoFailure,
  VideoDownloaderCommandError,
} from "./videoDownloaderErrors";

describe("video downloader error diagnostics", () => {
  it.each([
    ["Enter a valid individual YouTube video link. Playlists are not supported.", "invalid-url"],
    ["Private video", "unavailable-video"],
    ["Sign in to confirm your age", "authentication-required"],
    ["Failed to solve JavaScript challenge", "youtube-challenge"],
    ["RemoteDisconnected while connecting to YouTube", "network"],
    ["HTTP Error 429: Too Many Requests", "provider-blocked"],
    ["No compatible browser-compatible H.264/AAC formats", "no-compatible-formats"],
    ["Missing native video dependency: Deno JavaScript runtime.", "native-dependency"],
  ] as const)("classifies %s", (detail, category) => {
    expect(classifyVideoFailure(new Error(detail))).toBe(category);
  });

  it("distinguishes invalid links from playlist-only links", () => {
    expect(classifyVideoFailure("Enter a valid YouTube video URL.")).toBe("invalid-url");
    expect(classifyVideoFailure("Choose a single YouTube video. Playlists are not supported.")).toBe("playlist");
    expect(classifyVideoFailure("Use a public YouTube video link. Playlists are not supported.")).toBe("invalid-url");
  });

  it.each([
    ["inspection-output-limit", "Video details exceed the supported size"],
    ["stderr-output-limit", "too many diagnostics"],
    ["command-timeout", "timed out"],
    ["yt-dlp-extraction-failure", "yt-dlp could not read video details"],
    ["native-process-failure", "desktop video tool could not complete"],
  ] as const)("keeps %s distinct and operator-facing", (category, message) => {
    const error = new VideoDownloaderCommandError(category, "raw native output should stay hidden", "sensitive native diagnostic");
    expect(classifyVideoFailure(error)).toBe(category);
    expect(friendlyVideoFailure(error, "inspection")).toMatch(new RegExp(message, "i"));
    expect(friendlyVideoFailure(error, "inspection")).not.toContain("sensitive native diagnostic");
  });

  it("distinguishes inspection and download failures without exposing native output", () => {
    const error = new Error("Unable to download API page: https://youtube.com/watch?v=S9EUEdnJQDA?token=secret RemoteDisconnected");
    expect(friendlyVideoFailure(error, "inspection")).toMatch(/video details could not be checked/i);
    expect(friendlyVideoFailure(error, "download")).toMatch(/download stopped/i);
    expect(friendlyVideoFailure(error, "inspection")).not.toContain("S9EUEdnJQDA");
    expect(friendlyVideoFailure(error, "inspection")).not.toContain("secret");
  });

  it("redacts URLs, credentials, and video IDs in operator diagnostics", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      logVideoFailure(new VideoDownloaderCommandError(
        "provider-blocked",
        "yt-dlp extraction failed",
        "HTTP Error 403 https://youtube.com/watch?v=S9EUEdnJQDA?token=secret C:\\Users\\alice\\AppData\\Local\\WorshipSync\\yt-dlp.exe",
      ), "inspection");
      const payload = warn.mock.calls[0][1] as { diagnostics: string; category: string };
      expect(payload.category).toBe("provider-blocked");
      expect(payload.diagnostics).not.toContain("youtube.com");
      expect(payload.diagnostics).not.toContain("S9EUEdnJQDA");
      expect(payload.diagnostics).not.toContain("secret");
      expect(payload.diagnostics).not.toContain("alice");
    } finally {
      warn.mockRestore();
    }
  });

  it("preserves subprocess byte counts while redacting IDs from extractor diagnostics", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      logVideoFailure(new VideoDownloaderCommandError(
        "yt-dlp-extraction-failure",
        "yt-dlp could not extract video details.",
        "ERROR: [youtube] hujbT5BXyrl: failed; stdoutBytes=0; stdoutLimitBytes=4194304; stderrBytes=275; stderrLimitBytes=262144",
      ), "inspection");
      const payload = warn.mock.calls[0][1] as { diagnostics: string };
      expect(payload.diagnostics).not.toContain("hujbT5BXyrl");
      expect(payload.diagnostics).toContain("stdoutBytes=0");
      expect(payload.diagnostics).toContain("stdoutLimitBytes=4194304");
      expect(payload.diagnostics).toContain("stderrBytes=275");
      expect(payload.diagnostics).toContain("stderrLimitBytes=262144");
    } finally {
      warn.mockRestore();
    }
  });
});
