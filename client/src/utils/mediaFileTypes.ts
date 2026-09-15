const VIDEO_EXTENSION_CONTENT_TYPES: Record<string, string> = {
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  mkv: "video/x-matroska",
  m2ts: "video/mp2t",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  mts: "video/mp2t",
  ogv: "video/ogg",
  ts: "video/mp2t",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
};

export const IMAGE_CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/jxl": ".jxl",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
};

const IMAGE_EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(IMAGE_CONTENT_TYPE_EXTENSIONS).map(([type, extension]) => [
      extension.slice(1),
      type,
    ]),
  ),
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
};

export const SUPPORTED_VIDEO_EXTENSIONS = new Set(
  Object.keys(VIDEO_EXTENSION_CONTENT_TYPES),
);

export const getFileExtension = (fileName: string) =>
  fileName.split(".").pop()?.trim().toLowerCase() || "";

/**
 * Recognize image inputs broadly. The browser/Electron decoder remains the
 * authority for local playback; unsupported decoders can use cloud conversion.
 */
export const isRecognizedImageFile = (
  file: Pick<File, "name" | "type">,
) =>
  file.type.toLowerCase().startsWith("image/") ||
  Object.prototype.hasOwnProperty.call(
    IMAGE_EXTENSION_CONTENT_TYPES,
    getFileExtension(file.name),
  );

export const getImageContentType = (file: Pick<File, "name" | "type">) => {
  const declaredType = file.type.split(";", 1)[0].trim().toLowerCase();
  if (declaredType.startsWith("image/")) return declaredType;
  return (
    IMAGE_EXTENSION_CONTENT_TYPES[getFileExtension(file.name)] ||
    "application/octet-stream"
  );
};

/**
 * File.type is empty or generic for some files selected through Windows and
 * Electron. Keep the extension as a classification fallback, then let the
 * browser/provider validate the actual container and codec.
 */
export const isSupportedVideoFile = (file: Pick<File, "name" | "type">) =>
  file.type.toLowerCase().startsWith("video/") ||
  SUPPORTED_VIDEO_EXTENSIONS.has(getFileExtension(file.name));

export const getVideoContentType = (file: Pick<File, "name" | "type">) => {
  const declaredType = file.type.split(";", 1)[0].trim().toLowerCase();
  if (declaredType.startsWith("video/")) return declaredType;
  return (
    VIDEO_EXTENSION_CONTENT_TYPES[getFileExtension(file.name)] ||
    "application/octet-stream"
  );
};
