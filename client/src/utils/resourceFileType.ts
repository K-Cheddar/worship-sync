export type ResourceFileType = "pdf" | "word" | "spreadsheet" | "presentation" | "image" | "audio" | "video" | "link" | "text" | "file";
export type ResourceFileVisual = { type: ResourceFileType; label: string };
type FileMetadata = { mimeType?: string; fileName?: string; name?: string; kind?: string; mediaType?: string; external?: boolean };

const extensionOf = (name?: string) => /\.([a-z0-9]+)$/i.exec(name || "")?.[1].toLowerCase() || "";
const extensions: Record<string, ResourceFileType> = {
  pdf: "pdf", doc: "word", docx: "word", xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet",
  ppt: "presentation", pptx: "presentation", txt: "text", md: "text", markdown: "text",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image", avif: "image", heic: "image",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", flac: "audio",
  mp4: "video", mov: "video", webm: "video", m4v: "video", avi: "video",
};

/** Specific MIME wins; original filename precedes editable display name and broad hints. */
export const resolveResourceFileType = (metadata: FileMetadata): ResourceFileVisual => {
  const mime = (metadata.mimeType || "").split(";")[0].trim().toLowerCase();
  const extension = extensionOf(metadata.fileName) || extensionOf(metadata.name);
  const fromExtension = extensions[extension];
  const visual = (type: ResourceFileType, label: string): ResourceFileVisual => ({ type, label });
  if (mime === "application/pdf") return visual("pdf", "PDF");
  if (mime === "application/msword") return visual("word", "DOCX");
  if (mime.includes("wordprocessingml")) return visual("word", "DOCX");
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return visual("spreadsheet", "XLSX");
  if (mime === "text/csv" || mime === "application/csv") return visual("spreadsheet", "CSV");
  if (mime === "text/markdown") return visual("text", "MD");
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") return visual("presentation", "PPTX");
  if (mime.startsWith("image/")) return visual("image", "Image");
  if (mime.startsWith("video/")) return visual("video", "Video");
  if (mime.startsWith("audio/")) return visual("audio", mime === "audio/mpeg" ? "MP3" : mime.split("/")[1].toUpperCase());
  if (metadata.external && (mime === "text/html" || mime === "application/xhtml+xml")) return visual("link", "Web");
  // text/plain is often assigned to CSV/Markdown by browsers; retain the richer extension.
  if (mime.startsWith("text/") && mime !== "text/plain") return visual("text", "TXT");
  if (fromExtension) {
    if (fromExtension === "image") return visual("image", "Image");
    if (fromExtension === "video") return visual("video", "Video");
    return visual(fromExtension, extension === "markdown" ? "MD" : extension.toUpperCase());
  }
  if (mime === "text/plain") return visual("text", "TXT");
  if (metadata.mediaType === "image") return visual("image", "Image");
  if (metadata.mediaType === "video") return visual("video", "Video");
  if (metadata.mediaType === "audio") return visual("audio", "Audio");
  if (metadata.kind === "image") return visual("image", "Image");
  if (metadata.kind === "audio") return visual("audio", "Audio");
  if (metadata.external && metadata.mediaType === "web") return visual("link", "Web");
  if (extension) return visual("file", extension.toUpperCase());
  if (metadata.external) return visual("link", metadata.mediaType === "document" ? "Document" : "Link");
  return visual("file", metadata.kind === "document" ? "Document" : "File");
};
