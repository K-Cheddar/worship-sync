import {
  getContentPreviewKind,
  getContentPreviewTitle,
  getSafeHttpUrl,
  resolveContentPreviewResource,
  selectPreviewRenderer,
  type ContentPreviewRenderer,
} from "./contentPreview";

const dropboxMp4Url =
  "https://www.dropbox.com/scl/fi/abc123/Pathfinder-Day-Ingles-1.mp4?rlkey=secret&st=abc&dl=0";

describe("content preview normalization", () => {
  it.each([
    ["application/msword", "doc", "unsupported"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "docx"],
    ["application/vnd.ms-excel", "xls", "unsupported"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "unsupported"],
    ["application/vnd.ms-powerpoint", "ppt", "unsupported"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "unsupported"],
    ["application/pdf", "pdf", "pdf"],
  ])("selects a renderer for %s and .%s", (mimeType, extension, renderer) => {
    const metadata = { id: "office", url: "https://r2.example.test/opaque?signature=secret" };
    expect(resolveContentPreviewResource({ ...metadata, mimeType })).toMatchObject({ renderer });
    expect(resolveContentPreviewResource({ ...metadata, fileName: `notes.${extension}` })).toMatchObject({ renderer });
    expect(resolveContentPreviewResource({ id: "extension", url: `https://files.example.test/notes.${extension}` })).toMatchObject({ renderer });
  });

  it("keeps DOCX metadata when the signed response has a generic MIME type", () => {
    expect(resolveContentPreviewResource({ id: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, {
      url: "https://r2.example.test/opaque?signature=secret", mimeType: "application/octet-stream", provider: "worshipsync",
    })).toMatchObject({ renderer: "docx" });
  });

  it("preserves explicit inline text even when file metadata is also supplied", () => {
    expect(resolveContentPreviewResource({ id: "notes", fileName: "notes.docx", textContent: "Welcome" })).toMatchObject({ renderer: "text" });
  });

  it("uses the actual PDF capability for provider-converted Office files", () => {
    expect(resolveContentPreviewResource({ id: "converted", fileName: "notes.docx" }, {
      url: "https://worshipsync.test/proxy?token=secret", mimeType: "application/pdf", sourceKind: "file",
    })).toMatchObject({ renderer: "pdf" });
  });

  it("keeps raw Office files unsupported based on their file metadata", () => {
    expect(resolveContentPreviewResource({ id: "sheet", fileName: "notes.xlsx" }, {
      url: "https://worshipsync.test/proxy?token=secret", sourceKind: "file",
    })).toMatchObject({ renderer: "unsupported" });
  });
  it.each([
    ["image", "https://example.test/photo.jpg", "image"],
    ["video", "https://example.test/video.mp4", "video"],
    ["audio", "https://example.test/audio.mp3", "audio"],
    ["pdf", "https://example.test/guide.pdf", "pdf"],
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
      renderer: "video",
      title: "Pathfinder-Day-Ingles-1.mp4",
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
        provider: "google-drive",
        sourceKind: "file",
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
    });
  });

  const rendererCases: Array<[string, Parameters<typeof selectPreviewRenderer>[0], ContentPreviewRenderer]> = [
    ["PDF MIME wins for extensionless signed URLs", { sourceKind: "file", mimeType: "application/pdf", url: "https://cdn.example.test/signed" }, "pdf"],
    ["DOCX MIME", { sourceKind: "file", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", url: "https://cdn.example.test/signed" }, "docx"],
    ["plain text", { sourceKind: "file", mimeType: "text/plain" }, "text"],
    ["markdown extension", { sourceKind: "file", fileName: "notes.md" }, "text"],
    ["image MIME", { sourceKind: "file", mimeType: "image/png" }, "image"],
    ["audio MIME", { sourceKind: "file", mimeType: "audio/mpeg" }, "audio"],
    ["video MIME", { sourceKind: "file", mimeType: "video/mp4" }, "video"],
    ["YouTube", { sourceKind: "youtube", provider: "youtube", mediaId: "dQw4w9WgXcQ" }, "youtube"],
    ["webpage", { sourceKind: "web", mimeType: "text/html" }, "web"],
    ...["doc", "xls", "xlsx", "ppt", "pptx"].map((extension) => [
      `${extension} is unsupported`, { sourceKind: "file", fileName: `guide.${extension}` }, "unsupported" as const,
    ] as [string, Parameters<typeof selectPreviewRenderer>[0], ContentPreviewRenderer]),
  ];

  it.each(rendererCases)("selects one renderer: %s", (_label, input, expected) => {
    expect(selectPreviewRenderer(input)).toBe(expected);
  });

  it("prefers the resolved DOCX MIME over a webpage source classification", () => {
    expect(selectPreviewRenderer({
      sourceKind: "web",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "guide.docx",
    })).toBe("docx");
  });

  it("never renders unavailable upstream files from their original URL", () => {
    const resolution = resolveContentPreviewResource(
      { id: "private-pdf", url: "https://example.test/guide.pdf" },
      {
        url: "",
        originalUrl: "https://example.test/guide.pdf",
        sourceKind: "unavailable",
        mimeType: "application/pdf",
        fileName: "guide.pdf",
      },
    );
    expect(resolution.renderer).toBe("unsupported");
    expect(resolution.resolvedUrl).toBeNull();
    expect(resolution.originalUrl).toBe("https://example.test/guide.pdf");
  });
});
