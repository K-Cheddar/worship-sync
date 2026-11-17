export type VideoFailureStage = "inspection" | "download";

export type VideoFailureCategory =
  | "invalid-url"
  | "unavailable-video"
  | "authentication-required"
  | "youtube-challenge"
  | "network"
  | "provider-blocked"
  | "no-compatible-formats"
  | "native-dependency"
  | "unsupported-video"
  | "inspection-data"
  | "storage"
  | "playlist"
  | "inspection-output-limit"
  | "stdout-output-limit"
  | "stderr-output-limit"
  | "command-timeout"
  | "yt-dlp-extraction-failure"
  | "native-process-failure"
  | "unexpected";

export class VideoDownloaderCommandError extends Error {
  constructor(
    readonly category: VideoFailureCategory,
    message: string,
    readonly diagnostic = "",
  ) {
    super(message);
    this.name = "VideoDownloaderCommandError";
  }
}

const errorText = (error: unknown) => {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
    const diagnostic = "diagnostic" in error && typeof error.diagnostic === "string"
      ? ` ${error.diagnostic}` : "";
    return `${error.message}${code}${diagnostic}`;
  }
  return typeof error === "string" ? error : "";
};

export const classifyVideoFailure = (error: unknown): VideoFailureCategory => {
  if (error instanceof VideoDownloaderCommandError) return error.category;
  const detail = errorText(error);
  if (/invalid.*(?:youtube|video).*url|enter a valid.*(?:video )?(?:link|url)|use a public youtube video link|unsupported url|no suitable extractor/i.test(detail)) {
    return "invalid-url";
  }
  if (/playlist/i.test(detail)) return "playlist";
  if (/sign in|log ?in|authentication|age.?restricted|confirm your age|cookies? required|members.? only/i.test(detail)) {
    return "authentication-required";
  }
  if (/private video|video unavailable|has been removed|video is unavailable|http error 404|not available in your country/i.test(detail)) {
    return "unavailable-video";
  }
  if (/no compatible|browser-compatible|no suitable formats|requested format is not available|no formats found/i.test(detail)) {
    return "no-compatible-formats";
  }
  if (/live videos|longer than 6 hours|duration.*not supported/i.test(detail)) return "unsupported-video";
  if (/could not read (?:the )?video (?:details|title)|video details.*invalid/i.test(detail)) return "inspection-data";
  if (/missing native|native video dependency|ffmpeg.*(?:not found|missing)|ffprobe.*(?:not found|missing)|spawn .*\b(?:ENOENT|ENOEXEC|EACCES)\b|not a valid win32 application|could not run.*(?:deno|yt-dlp|ffmpeg|ffprobe)|required javascript runtime.*(?:missing|unavailable)|(?:no|missing|unavailable|not found).*javascript runtime|js runtime.*(?:missing|unavailable)|yt-dlp-ejs.*(?:missing|not found)/i.test(detail)) {
    return "native-dependency";
  }
  if (/javascript challenge|js challenge|challenge solver|failed to solve.*challenge|bot.?check|verification challenge/i.test(detail)) {
    return "youtube-challenge";
  }
  if (/http error 429|too many requests|rate.?limit|temporarily blocked|request blocked|http error 403|forbidden/i.test(detail)) {
    return "provider-blocked";
  }
  if (/no space left|disk full|not enough free storage|winerror\s*112|enospc/i.test(detail)) {
    return "storage";
  }
  if (/timed? out|timeout|temporary failure|connection|network|unable to download|remote.?disconnected|connection aborted|connection reset|name or service not known|getaddrinfo|host is down|unreachable|sslerror|transporterror|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT)\b/i.test(detail)) {
    return "network";
  }
  return "unexpected";
};

export const friendlyVideoFailure = (
  error: unknown,
  stage: VideoFailureStage,
) => {
  switch (classifyVideoFailure(error)) {
    case "invalid-url":
      return "Enter a valid individual YouTube video link. Playlists are not supported.";
    case "unavailable-video":
      return "This YouTube video is unavailable, private, or has been removed. Only publicly accessible videos can be added.";
    case "authentication-required":
      return "This YouTube video requires sign-in or age verification, which WorshipSync does not support.";
    case "youtube-challenge":
      return "YouTube could not complete its verification challenge. Try again later; if it continues, contact support.";
    case "network":
      return stage === "inspection"
        ? "Video details could not be checked because the network connection failed. Check your connection and retry."
        : "The video download stopped because the network connection failed. Check your connection and retry.";
    case "provider-blocked":
      return "YouTube or this network is limiting or blocking the request. Wait and retry; videos blocked by YouTube cannot be added.";
    case "no-compatible-formats":
      return "This video does not provide a compatible H.264/AAC MP4 format and cannot be added without conversion.";
    case "native-dependency":
      return "A required desktop video tool is missing or cannot run. Restart or reinstall WorshipSync, then try again.";
    case "unsupported-video":
      return "Live videos and videos longer than 6 hours are not supported.";
    case "inspection-data":
      return "Video details could not be read from this link. Check the link and retry.";
    case "inspection-output-limit":
      return "Video details exceed the supported size. Retry later; contact support if it continues.";
    case "stdout-output-limit":
      return "The video tool produced too much output to continue. Retry the operation; contact support if it continues.";
    case "stderr-output-limit":
      return "The video tool produced too many diagnostics to continue. Retry the operation; contact support if it continues.";
    case "command-timeout":
      return stage === "inspection"
        ? "Video details could not be checked before inspection timed out. Retry later; contact support if it continues."
        : "The video tool timed out while checking the download. Retry; contact support if it continues.";
    case "yt-dlp-extraction-failure":
      return "yt-dlp could not read video details. Check the link and retry; contact support if it continues.";
    case "native-process-failure":
      return "A desktop video tool could not complete the operation. Restart or reinstall WorshipSync, then try again.";
    case "storage":
      return "This computer does not have enough free storage for the video.";
    case "playlist":
      return "Choose a single YouTube video. Playlists are not supported.";
    case "unexpected":
      return stage === "inspection"
        ? "Video inspection failed unexpectedly. Retry the link; contact support if it continues."
        : "The video download failed unexpectedly. Retry the download; contact support if it continues.";
    default:
      return stage === "inspection"
        ? "Video inspection failed unexpectedly. Retry the link; contact support if it continues."
        : "The video download failed unexpectedly. Retry the download; contact support if it continues.";
  }
};

const ANSI_SGR_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const sanitizeDiagnostic = (value: string) => value
  .replace(ANSI_SGR_SEQUENCE, "")
  .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
  .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, "[user-profile]")
  .replace(/\/(?:home|Users)\/[^/\s]+/g, "/[user-profile]")
  .replace(/\b(cookie|authorization|token|signature|sig|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
  .replace(/(\[youtube(?:-nocookie)?\]\s*)[A-Za-z0-9_-]{11}\b/gi, "$1[video-id]")
  .replace(/\b((?:youtube[_ -]?)?video[_ -]?id\s*[:=]\s*)[A-Za-z0-9_-]{11}\b/gi, "$1[video-id]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 1200);

export const logVideoFailure = (
  error: unknown,
  stage: VideoFailureStage,
) => {
  const category = classifyVideoFailure(error);
  const diagnostics = sanitizeDiagnostic(errorText(error));
  console.warn("[VideoDownloader] operation failed", {
    stage,
    provider: "youtube",
    category,
    diagnostics: diagnostics || "No native diagnostic output was returned.",
  });
};
