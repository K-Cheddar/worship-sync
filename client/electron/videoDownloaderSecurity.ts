import { validateSafeHttpUrl, type SafeHttpLookupAll } from "./safeHttp";

const SUPPORTED_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
const EXTRACTOR_HOSTS = [
  ...SUPPORTED_HOSTS,
  "googlevideo.com",
  "googleapis.com",
  "ytimg.com",
];

const isHostnameWithin = (hostname: string, suffixes: string[]) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return suffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
};

export const validateSupportedVideoUrl = (rawUrl: unknown): string => {
  if (typeof rawUrl !== "string" || rawUrl.length > 4096) {
    throw new Error("Enter a valid YouTube video URL.");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid YouTube video URL.");
  }
  if (
    url.protocol !== "https:" ||
    !isHostnameWithin(url.hostname, SUPPORTED_HOSTS) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (url.pathname === "/playlist" && !url.searchParams.has("v"))
  ) {
    throw new Error("Use a public YouTube video link. Playlists are not supported.");
  }
  return url.toString();
};

export const validateExtractorRequestUrl = async (
  rawUrl: string,
  lookupAll?: SafeHttpLookupAll,
) => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The video source requested an invalid address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !isHostnameWithin(url.hostname, EXTRACTOR_HOSTS) ||
    (url.protocol === "https:" && url.port && url.port !== "443") ||
    (url.protocol === "http:" && url.port && url.port !== "80")
  ) {
    throw new Error("The video source requested an unsupported network address.");
  }
  const validated = await validateSafeHttpUrl(url.toString(), lookupAll);
  return { url, address: validated.address };
};

export type YtDlpFormat = {
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
};

export const getCompatibleVideoQualities = (formats: YtDlpFormat[]) => {
  const hasAacAudio = formats.some(
    (format) => format.ext === "m4a" && format.acodec?.startsWith("mp4a"),
  );
  const combinedHeights = formats
    .filter(
      (format) =>
        format.ext === "mp4" &&
        format.vcodec?.startsWith("avc1") &&
        format.acodec?.startsWith("mp4a") &&
        Number.isInteger(format.height) &&
        Number(format.height) > 0,
    )
    .map((format) => Number(format.height));
  const videoHeights = hasAacAudio
    ? formats
        .filter(
          (format) =>
            format.ext === "mp4" &&
            format.vcodec?.startsWith("avc1") &&
            format.acodec === "none" &&
            Number.isInteger(format.height) &&
            Number(format.height) > 0,
        )
        .map((format) => Number(format.height))
    : [];
  const heights = [...new Set([...combinedHeights, ...videoHeights])].sort(
    (a, b) => b - a,
  );
  if (!heights.length) {
    throw new Error(
      "This video has no browser-compatible H.264 and AAC MP4 streams. It cannot be added without conversion.",
    );
  }
  return heights;
};
