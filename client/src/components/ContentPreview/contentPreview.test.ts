import {
  getContentPreviewKind,
  getContentPreviewTitle,
  getSafeHttpUrl,
  resolveContentPreviewResource,
} from "./contentPreview";

const dropboxMp4Url =
  "https://www.dropbox.com/scl/fi/abc123/Pathfinder-Day-Ingles-1.mp4?rlkey=secret&st=abc&dl=0";

describe("content preview normalization", () => {
  it.each([
    ["image", "https://example.test/photo.jpg", "image"],
    ["video", "https://example.test/video.mp4", "video"],
    ["audio", "https://example.test/audio.mp3", "audio"],
    ["pdf", "https://example.test/guide.pdf", "document"],
  ])("detects %s content from a direct URL", (_label, url, expected) => {
    expect(
      getContentPreviewKind({ id: "resource-1", url }),
    ).toBe(expected);
  });

  it("detects YouTube and generic web resources centrally", () => {
    expect(
      getContentPreviewKind({
        id: "youtube-1",
        type: "youtube",
        mediaId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).toBe("youtube");
    expect(
      getContentPreviewKind({ id: "web-1", url: "https://example.test/page" }),
    ).toBe("web");
  });

  it("rejects unsafe schemes before rendering or opening", () => {
    const unsafeUrl = ["java", "script:alert(1)"].join("");
    expect(getSafeHttpUrl(unsafeUrl)).toBeNull();
    expect(getSafeHttpUrl("data:text/html,unsafe")).toBeNull();
  });

  it("uses a domain fallback when a resource has no title", () => {
    expect(
      getContentPreviewTitle({ id: "web-1", url: "https://www.example.test/long/path" }),
    ).toBe("example.test");
  });

  it("resolves Dropbox shared MP4 links to raw media while retaining the original URL", () => {
    const resolution = resolveContentPreviewResource({
      id: "dropbox-video",
      url: dropboxMp4Url,
    });

    expect(resolution).toMatchObject({
      originalUrl: dropboxMp4Url,
      provider: "dropbox",
      providerLabel: "Dropbox",
      mediaType: "video",
      renderer: "video",
      title: "Pathfinder-Day-Ingles-1.mp4",
      canPreview: true,
    });
    expect(new URL(resolution.resolvedUrl || "").searchParams.get("raw")).toBe("1");
    expect(new URL(resolution.resolvedUrl || "").searchParams.get("dl")).toBeNull();
    expect(resolution.resolvedUrl).not.toBe(resolution.originalUrl);
  });

  it.each([
    ["photo.jpg", "image"],
    ["track.mp3", "audio"],
    ["guide.pdf", "document"],
  ])("recognizes Dropbox %s as %s", (fileName, expected) => {
    const resolution = resolveContentPreviewResource({
      id: `dropbox-${fileName}`,
      url: `https://www.dropbox.com/scl/fi/abc123/${fileName}?rlkey=secret&dl=0`,
    });

    expect(resolution.mediaType).toBe(expected);
    expect(resolution.provider).toBe("dropbox");
    expect(resolution.title).toBe(fileName);
  });

  it("prefers an explicit title over an inferred Dropbox filename", () => {
    expect(resolveContentPreviewResource({
      id: "dropbox-video",
      title: "Pathfinder video",
      url: dropboxMp4Url,
    }).title).toBe("Pathfinder video");
  });
});
