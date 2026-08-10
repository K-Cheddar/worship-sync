const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const normalizeVideoId = (value: string | null | undefined) => {
  const videoId = value?.trim() ?? "";
  return YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
};

export type YouTubeVideoReference = {
  videoId: string;
  watchUrl: string;
  embedUrl: string;
  thumbnailUrl: string;
  startSeconds?: number;
};

export const parseYouTubeTimestamp = (value: string): number | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }

  const colonParts = normalized.split(":");
  if (
    colonParts.length >= 2 &&
    colonParts.length <= 3 &&
    colonParts.every((part) => /^\d+$/.test(part))
  ) {
    const values = colonParts.map(Number);
    const seconds = values.at(-1) ?? 0;
    const minutes = values.at(-2) ?? 0;
    const hours = values.at(-3) ?? 0;
    if (seconds >= 60 || minutes >= 60) return null;
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isSafeInteger(total) ? total : null;
  }

  const unitMatch = normalized.match(
    /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/,
  );
  if (unitMatch && unitMatch[0] && unitMatch.slice(1).some(Boolean)) {
    const total =
      Number(unitMatch[1] || 0) * 3600 +
      Number(unitMatch[2] || 0) * 60 +
      Number(unitMatch[3] || 0);
    return Number.isSafeInteger(total) ? total : null;
  }

  return null;
};

export const formatYouTubeTimestamp = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const minuteAndSeconds = `${minutes}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`
    : minuteAndSeconds;
};

const getUrlStartSeconds = (url: URL) => {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const rawTimestamp =
    url.searchParams.get("t") ??
    url.searchParams.get("start") ??
    hashParams.get("t");
  const parsed = rawTimestamp ? parseYouTubeTimestamp(rawTimestamp) : null;
  return parsed !== null && parsed > 0 ? parsed : undefined;
};

export const getYouTubeVideoReference = (
  value: string,
): YouTubeVideoReference | null => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  let videoId: string | null = null;

  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    videoId = normalizeVideoId(parsed.pathname.split("/").filter(Boolean)[0]);
  } else if (YOUTUBE_HOSTS.has(hostname)) {
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.pathname === "/watch") {
      videoId = normalizeVideoId(parsed.searchParams.get("v"));
    } else if (["embed", "shorts", "live"].includes(pathParts[0])) {
      videoId = normalizeVideoId(pathParts[1]);
    }
  }

  if (!videoId) return null;

  return {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    startSeconds: getUrlStartSeconds(parsed),
  };
};
