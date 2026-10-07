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
    ["application/msword", "doc", "legacy-office", false],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "docx", true],
    ["application/vnd.ms-excel", "xls", "spreadsheet", false],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "spreadsheet", false],
    ["application/vnd.ms-powerpoint", "ppt", "presentation", false],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "presentation", false],
    ["application/pdf", "pdf", "pdf", true],
  ])("selects a capability for %s and .%s", (mimeType, extension, renderer, canPreview) => {
    const metadata = { id: "office", url: "https://r2.example.test/opaque?signature=secret" };
    expect(resolveContentPreviewResource({ ...metadata, mimeType })).toMatchObject({ mediaType: "document", renderer, canPreview });
    expect(resolveContentPreviewResource({ ...metadata, fileName: `notes.${extension}` })).toMatchObject({ mediaType: "document", renderer, canPreview });
    expect(resolveContentPreviewResource({ id: "extension", url: `https://files.example.test/notes.${extension}` })).toMatchObject({ renderer, canPreview });
  });

  it("keeps DOCX metadata when the signed response has a generic MIME type", () => {
    expect(resolveContentPreviewResource({ id: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, {
      url: "https://r2.example.test/opaque?signature=secret", mimeType: "application/octet-stream", provider: "worshipsync",
    })).toMatchObject({ renderer: "docx", mediaType: "document", canPreview: true });
  });

  it("preserves explicit inline text even when file metadata is also supplied", () => {
    expect(resolveContentPreviewResource({ id: "notes", fileName: "notes.docx", textContent: "Welcome" })).toMatchObject({ mediaType: "text", renderer: "text", canPreview: true });
  });

  it("uses the actual PDF capability for provider-converted Office files", () => {
    expect(resolveContentPreviewResource({ id: "converted", fileName: "notes.docx" }, {
      url: "https://worshipsync.test/proxy?token=secret", mimeType: "application/pdf", previewType: "document", mediaType: "document", canPreview: true,
    })).toMatchObject({ renderer: "pdf", canPreview: true });
  });

  it("does not trust an old server's document capability for raw Office files", () => {
    expect(resolveContentPreviewResource({ id: "sheet", fileName: "notes.xlsx" }, {
      url: "https://worshipsync.test/proxy?token=secret", previewType: "document", mediaType: "document", canPreview: true,
    })).toMatchObject({ renderer: "spreadsheet", canPreview: false });
  });
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
    expect(getSafeHttpUrl("https://user:password@example.test/file.mp4")).toBeNull();
  });

  it("uses a domain fallback when a resource has no title", () => {
    expect(
      getContentPreviewTitle({ id: "web-1", url: "https://www.example.test/long/path" }),
    ).toBe("example.test");
  });

  it("leaves provider URL normalization to the server resolver", () => {
    const resolution = resolveContentPreviewResource({
      id: "dropbox-video",
      url: dropboxMp4Url,
    });

    expect(resolution).toMatchObject({
      originalUrl: dropboxMp4Url,
      provider: "direct",
      mediaType: "video",
      renderer: "video",
      title: "Pathfinder-Day-Ingles-1.mp4",
      canPreview: true,
    });
    expect(resolution.resolvedUrl).toBe(dropboxMp4Url);
  });

  it("prefers an explicit title over an inferred Dropbox filename", () => {
    expect(resolveContentPreviewResource({
      id: "dropbox-video",
      title: "Pathfinder video",
      url: dropboxMp4Url,
    }).title).toBe("Pathfinder video");
  });

  it("consumes a server descriptor without moving provider logic into the caller", () => {
    const resolution = resolveContentPreviewResource(
      {
        id: "drive-video",
        title: "Rehearsal clip",
        url: "https://drive.google.com/file/d/drive-file/view",
      },
      {
        url: "https://www.worshipsync.net/api/resources/proxy?token=short-lived",
        originalUrl: "https://drive.google.com/file/d/drive-file/view",
        externalUrl: "https://drive.google.com/file/d/drive-file/view",
        provider: "google-drive",
        previewType: "video",
        mediaType: "video",
        canPreview: true,
        requiresProxy: true,
        mediaId: "drive-file",
        fileName: "rehearsal.mp4",
      },
    );

    expect(resolution).toMatchObject({
      provider: "google-drive",
      renderer: "video",
      resolvedUrl: "https://www.worshipsync.net/api/resources/proxy?token=short-lived",
      originalUrl: "https://drive.google.com/file/d/drive-file/view",
      mediaId: "drive-file",
      requiresProxy: true,
    });
  });
});
