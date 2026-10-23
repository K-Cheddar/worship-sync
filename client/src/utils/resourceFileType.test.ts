import { resolveResourceFileType } from "./resourceFileType";

describe("resource file types", () => {
  it.each([
    ["guide.pdf", "pdf", "PDF"], ["guide.docx", "word", "DOCX"],
    ["budget.xlsx", "spreadsheet", "XLSX"], ["budget.csv", "spreadsheet", "CSV"],
    ["slides.pptx", "presentation", "PPTX"], ["notes.txt", "text", "TXT"],
    ["notes.md", "text", "MD"], ["photo.jpg", "image", "Image"],
    ["song.mp3", "audio", "MP3"], ["movie.mp4", "video", "Video"],
    ["archive.xyz", "file", "XYZ"], ["download", "file", "File"],
  ])("classifies original filename %s", (fileName, type, label) => {
    expect(resolveResourceFileType({ fileName })).toMatchObject({ type, label });
  });

  it("prefers a recognized MIME over conflicting names and media fallbacks", () => {
    expect(resolveResourceFileType({ mimeType: " Application/PDF; charset=binary ", fileName: "wrong.docx", mediaType: "web", external: true })).toMatchObject({ type: "pdf", label: "PDF" });
  });

  it("uses original metadata before renamed display names and generic MIME", () => {
    expect(resolveResourceFileType({ mimeType: "application/octet-stream", fileName: "guide.docx", name: "Sunday.pdf", external: true, mediaType: "web" })).toMatchObject({ type: "word", label: "DOCX" });
  });

  it.each([
    [{ external: true, mediaType: "web" }, "link", "Web"],
    [{ external: true, kind: "other" }, "link", "Link"],
    [{ external: true, mediaType: "audio" }, "audio", "Audio"],
    [{ external: true, mediaType: "video", kind: "image" }, "video", "Video"],
    [{ external: true, mediaType: "web", fileName: "guide.pdf" }, "pdf", "PDF"],
    [{ kind: "image" }, "image", "Image"],
    [{ kind: "document" }, "file", "Document"],
    [{ name: "fallback.csv" }, "spreadsheet", "CSV"],
    [{ mimeType: "text/csv" }, "spreadsheet", "CSV"],
    [{ mimeType: "text/html", external: true }, "link", "Web"],
    [{ mimeType: "text/plain", fileName: "notes.md" }, "text", "MD"],
    [{ mimeType: "text/markdown", fileName: "wrong.pdf" }, "text", "MD"],
  ])("safely falls back for %j", (input, type, label) => {
    expect(resolveResourceFileType(input)).toMatchObject({ type, label });
  });
});
