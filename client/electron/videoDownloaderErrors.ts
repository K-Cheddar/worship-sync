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
  | "unexpected";

const errorText = (error: unknown) => {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
    return `${error.message}${code}`;
  }
  return typeof error === "string" ? error : "";
};

export const classifyVideoFailure = (error: unknown): VideoFailureCategory => {
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

const sanitizeDiagnostic = (value: string) => value
  .replace(/\u001b\[[0-9;]*m/g, "")
  .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
  .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, "[user-profile]")
  .replace(/\/(?:home|Users)\/[^/\s]+/g, "/[user-profile]")
  .replace(/\b(cookie|authorization|token|signature|sig|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
  .replace(/\b[A-Za-z0-9_-]{11}\b/g, "[video-id]")
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
