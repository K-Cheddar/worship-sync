import { getYouTubeVideoReference } from "../../utils/youtube";

export type ContentPreviewKind =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "youtube"
  | "text"
  | "web"
  | "unsupported";

export type ContentPreviewProvider =
  | "worshipsync"
  | "youtube"
  | "dropbox"
  | "direct"
  | "web"
  | "unknown";

export type ContentPreviewResolvedSource = {
  url: string;
  originalUrl?: string;
  mimeType?: string;
  fileName?: string;
  title?: string;
  provider?: ContentPreviewProvider;
};

export type ContentPreviewResolution = {
  originalUrl: string | null;
  resolvedUrl: string | null;
  title: string;
  provider: ContentPreviewProvider;
  providerLabel: string;
  mediaType: ContentPreviewKind;
  mimeType?: string;
  renderer: ContentPreviewKind;
  canPreview: boolean;
  fileName?: string;
};

/**
 * Normalized input for the shared previewer. Callers may provide a direct URL
 * or a resolver for private/signed resources; renderer selection stays here.
 */
export type ContentPreviewResource = {
  id: string;
  title?: string;
  url?: string;
  type?: string;
  provider?: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  textContent?: string;
  resolveSource?: () => Promise<ContentPreviewResolvedSource>;
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const MIME_KIND_BY_PREFIX: Array<[string, ContentPreviewKind]> = [
  ["image/", "image"],
  ["audio/", "audio"],
  ["video/", "video"],
];

const MIME_KIND_BY_VALUE: Record<string, ContentPreviewKind> = {
  "application/pdf": "document",
  "application/x-pdf": "document",
  "text/plain": "text",
  "text/markdown": "text",
};

const EXTENSION_KIND: Record<string, ContentPreviewKind> = {
  avif: "image",
  gif: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  webp: "image",
  aac: "audio",
  flac: "audio",
  m4a: "audio",
  mp3: "audio",
  oga: "audio",
  ogg: "audio",
  wav: "audio",
  webm: "video",
  mov: "video",
  mp4: "video",
  m4v: "video",
  ogv: "video",
  pdf: "document",
  md: "text",
  txt: "text",
};

const PROVIDER_LABELS: Record<ContentPreviewProvider, string> = {
  worshipsync: "WorshipSync",
  youtube: "YouTube",
  dropbox: "Dropbox",
  direct: "Direct media",
  web: "Web",
  unknown: "Resource",
};

const MEDIA_KIND_LABELS: Record<ContentPreviewKind, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  document: "Document",
  youtube: "Video",
  text: "Text",
  web: "Web page",
  unsupported: "Resource",
};

const DROPBOX_HOSTS = new Set([
  "dropbox.com",
  "www.dropbox.com",
  "dl.dropboxusercontent.com",
]);

const normalizedMimeType = (value?: string): string =>
  value?.split(";", 1)[0]?.trim().toLowerCase() || "";

const kindForMimeType = (mimeType?: string): ContentPreviewKind | null => {
  const normalized = normalizedMimeType(mimeType);
  if (!normalized) return null;
  if (MIME_KIND_BY_VALUE[normalized]) return MIME_KIND_BY_VALUE[normalized];
  return MIME_KIND_BY_PREFIX.find(([prefix]) => normalized.startsWith(prefix))?.[1] || null;
};

const pathFileName = (value?: string): string | null => {
  const safeUrl = getSafeHttpUrl(value);
  if (!safeUrl) return null;
  try {
    const segment = new URL(safeUrl).pathname.split("/").filter(Boolean).pop() || "";
    if (!segment) return null;
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

const extensionForFileName = (fileName?: string | null): string =>
  fileName?.toLowerCase().split(".").pop() || "";

const kindForFileName = (fileName?: string | null): ContentPreviewKind | null =>
  EXTENSION_KIND[extensionForFileName(fileName)] || null;

const kindForUrlExtension = (value?: string): ContentPreviewKind | null => {
  return kindForFileName(pathFileName(value));
};

export const getSafeHttpUrl = (value?: string): string | null => {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export const getContentPreviewFileName = (value?: string): string | null => {
  const fileName = pathFileName(value);
  if (!fileName || !/\.[a-z0-9]{1,12}$/i.test(fileName)) return null;
  return fileName;
};

const isDropboxUrl = (value?: string): boolean => {
  const safeUrl = getSafeHttpUrl(value);
  if (!safeUrl) return false;
  try {
    return DROPBOX_HOSTS.has(new URL(safeUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
};

type ProviderUrlResolution = {
  provider: ContentPreviewProvider;
  providerLabel: string;
  resolvedUrl: string;
  fileName?: string;
  mediaType?: ContentPreviewKind;
};

/** Provider-specific URL normalization stays outside renderers and callers. */
const resolveDropboxUrl = (value: string): ProviderUrlResolution | null => {
  if (!isDropboxUrl(value)) return null;
  const fileName = getContentPreviewFileName(value) || undefined;
  const mediaType = kindForFileName(fileName) || undefined;
  if (!mediaType || !["image", "audio", "video", "document"].includes(mediaType)) {
    return {
      provider: "dropbox",
      providerLabel: PROVIDER_LABELS.dropbox,
      resolvedUrl: value,
      fileName,
    };
  }

  const resolved = new URL(value);
  resolved.searchParams.delete("dl");
  resolved.searchParams.set("raw", "1");
  return {
    provider: "dropbox",
    providerLabel: PROVIDER_LABELS.dropbox,
    resolvedUrl: resolved.toString(),
    fileName,
    mediaType,
  };
};

const resolveProviderUrl = (value?: string): ProviderUrlResolution | null => {
  if (!value) return null;
  return resolveDropboxUrl(value);
};

export const getContentPreviewKind = (
  resource: ContentPreviewResource,
  resolvedMimeType?: string,
): ContentPreviewKind => {
  if (resource.textContent !== undefined) return "text";

  const provider = resource.provider?.trim().toLowerCase();
  const type = resource.type?.trim().toLowerCase();
  const mediaId = resource.mediaId?.trim() || "";
  const youtube = resource.url ? getYouTubeVideoReference(resource.url) : null;
  if (
    (provider === "youtube" || type === "youtube" || Boolean(youtube)) &&
    (YOUTUBE_VIDEO_ID_PATTERN.test(mediaId) || Boolean(youtube?.videoId))
  ) {
    return "youtube";
  }

  const mimeKind = kindForMimeType(resolvedMimeType || resource.mimeType);
  if (mimeKind) return mimeKind;

  if (["image", "audio", "video", "document", "text"].includes(type || "")) {
    return type as ContentPreviewKind;
  }

  return kindForUrlExtension(resource.url) || (getSafeHttpUrl(resource.url) ? "web" : "unsupported");
};

export const getYouTubePreviewVideoId = (
  resource: ContentPreviewResource,
): string | null => {
  if (resource.mediaId && YOUTUBE_VIDEO_ID_PATTERN.test(resource.mediaId.trim())) {
    return resource.mediaId.trim();
  }
  return resource.url ? getYouTubeVideoReference(resource.url)?.videoId || null : null;
};

type ContentPreviewTitleOptions = {
  resolvedFileName?: string;
  resolvedTitle?: string;
  providerLabel?: string;
};

export const getContentPreviewTitle = (
  resource: ContentPreviewResource,
  sourceUrl?: string,
  options: ContentPreviewTitleOptions = {},
): string => {
  const title = resource.title?.trim();
  if (title && title !== resource.url?.trim()) return title;
  if (resource.fileName?.trim()) return resource.fileName.trim();
  if (options.resolvedFileName?.trim()) return options.resolvedFileName.trim();

  const inferredFileName = getContentPreviewFileName(sourceUrl || resource.url);
  if (inferredFileName) return inferredFileName;
  if (options.resolvedTitle?.trim()) return options.resolvedTitle.trim();

  const safeUrl = getSafeHttpUrl(sourceUrl || resource.url);
  if (safeUrl) {
    try {
      return options.providerLabel || new URL(safeUrl).hostname.replace(/^www\./i, "");
    } catch {
      return safeUrl.length > 80 ? `${safeUrl.slice(0, 77)}…` : safeUrl;
    }
  }
  return "Content preview";
};

export const getContentPreviewMediaLabel = (kind: ContentPreviewKind): string =>
  MEDIA_KIND_LABELS[kind];

export const getContentPreviewProviderLabel = (
  provider: ContentPreviewProvider,
  sourceUrl?: string,
): string => {
  if (provider !== "web") return PROVIDER_LABELS[provider];
  const safeUrl = getSafeHttpUrl(sourceUrl);
  if (!safeUrl) return PROVIDER_LABELS.web;
  try {
    return new URL(safeUrl).hostname.replace(/^www\./i, "");
  } catch {
    return PROVIDER_LABELS.web;
  }
};

export const resolveContentPreviewResource = (
  resource: ContentPreviewResource,
  source?: ContentPreviewResolvedSource | null,
): ContentPreviewResolution => {
  const resourceUrl = getSafeHttpUrl(resource.url);
  const sourceUrl = getSafeHttpUrl(source?.url);
  const originalUrl = resourceUrl
    ? resource.url?.trim() || resourceUrl
    : getSafeHttpUrl(source?.originalUrl)
      ? source?.originalUrl?.trim() || sourceUrl
      : sourceUrl;
  const providerResolution = resolveProviderUrl(resourceUrl || sourceUrl || undefined);
  const resolvedUrl = providerResolution?.resolvedUrl || sourceUrl || originalUrl;
  const fileName = resource.fileName || source?.fileName || providerResolution?.fileName;
  const mimeType = normalizedMimeType(source?.mimeType || resource.mimeType) || undefined;
  const candidate: ContentPreviewResource = {
    ...resource,
    url: resolvedUrl || resource.url,
    fileName,
    mimeType,
  };
  const mediaType = providerResolution?.mediaType || getContentPreviewKind(candidate, mimeType);
  const youtubeVideoId = getYouTubePreviewVideoId(candidate);
  const explicitProvider = resource.provider?.trim().toLowerCase();
  const provider: ContentPreviewProvider = youtubeVideoId || explicitProvider === "youtube"
    ? "youtube"
    : providerResolution?.provider || source?.provider || (
      resource.resolveSource || explicitProvider?.startsWith("worshipsync")
        ? "worshipsync"
        : mediaType === "web"
          ? "web"
          : resolvedUrl
            ? "direct"
            : "unknown"
    );
  const providerLabel = providerResolution?.providerLabel ||
    getContentPreviewProviderLabel(provider, originalUrl || resolvedUrl || undefined);
  const canPreview = mediaType !== "unsupported" && (
    mediaType === "text" || Boolean(resolvedUrl)
  );

  return {
    originalUrl,
    resolvedUrl,
    title: getContentPreviewTitle(resource, resolvedUrl || originalUrl || undefined, {
      resolvedFileName: fileName,
      resolvedTitle: source?.title,
      providerLabel,
    }),
    provider,
    providerLabel,
    mediaType,
    mimeType,
    renderer: mediaType,
    canPreview,
    ...(fileName ? { fileName } : {}),
  };
};
