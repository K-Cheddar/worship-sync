import {
  classifyVideoFailure,
  friendlyVideoFailure,
  logVideoFailure,
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
      logVideoFailure(new Error("HTTP Error 403 https://youtube.com/watch?v=S9EUEdnJQDA?token=secret C:\\Users\\alice\\AppData\\Local\\WorshipSync\\yt-dlp.exe"), "inspection");
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
});
