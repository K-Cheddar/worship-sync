import { getExternalResourceResolution } from "../../api/auth";
import { getApiBasePath } from "../../utils/environment";
import { getYouTubeVideoReference } from "../../utils/youtube";
import type { RichTextDocument } from "../../types/richText";
import type {
  ExternalResourceMediaType,
  ExternalResourcePreviewType,
} from "../../api/externalResource";

export type ContentPreviewKind =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "youtube"
  | "text"
  | "web"
  | "unknown"
  | "unsupported";

export type ContentPreviewProvider =
  | "worshipsync"
  | "youtube"
  | "dropbox"
  | "google-drive"
  | "onedrive"
  | "sharepoint"
  | "box"
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
  externalUrl?: string;
  previewType?: ExternalResourcePreviewType;
  mediaType?: ExternalResourceMediaType;
  canPreview?: boolean;
  requiresProxy?: boolean;
  mediaId?: string;
  reason?: string;
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
  mediaId?: string;
  requiresProxy?: boolean;
  reason?: string;
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
  richTextContent?: RichTextDocument;
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
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  box: "Box",
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
  unknown: "Resource",
  unsupported: "Resource",
};

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
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) return null;
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

const toAbsolutePreviewUrl = (value?: string): string | null => {
  const safeUrl = getSafeHttpUrl(value);
  if (safeUrl) return safeUrl;
  if (!value?.trim() || !value.trim().startsWith("/")) return null;
  try {
    const apiBase = getApiBasePath();
    const base = getSafeHttpUrl(apiBase) || (
      typeof window !== "undefined" ? getSafeHttpUrl(window.location.origin) : null
    );
    return base ? getSafeHttpUrl(new URL(value.trim(), base).toString()) : null;
  } catch {
    return null;
  }
};

const isContentPreviewProvider = (value?: string): value is ContentPreviewProvider =>
  Boolean(value && value in PROVIDER_LABELS);

/** Resolve public URLs through the authenticated, provider-neutral server boundary. */
export const resolveExternalContentPreviewSource = async (
  resource: ContentPreviewResource,
): Promise<ContentPreviewResolvedSource | null> => {
  const resourceUrl = getSafeHttpUrl(resource.url);
  if (!resourceUrl || resource.resolveSource) return null;

  const resolved = await getExternalResourceResolution(resourceUrl);
  const previewUrl = toAbsolutePreviewUrl(resolved.previewUrl || resolved.externalUrl);
  return {
    url: previewUrl || resourceUrl,
    originalUrl: resolved.originalUrl || resourceUrl,
    externalUrl: resolved.externalUrl || resolved.originalUrl || resourceUrl,
    provider: resolved.provider,
    title: resolved.title,
    mimeType: resolved.mimeType,
    fileName: resolved.filename,
    previewType: resolved.previewType,
    mediaType: resolved.mediaType,
    canPreview: resolved.canPreview,
    requiresProxy: resolved.requiresProxy,
    mediaId: resolved.mediaId,
    reason: resolved.reason,
  };
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
  const resolvedUrl = sourceUrl || originalUrl;
  const fileName = resource.fileName || source?.fileName;
  const mimeType = normalizedMimeType(source?.mimeType || resource.mimeType) || undefined;
  const candidate: ContentPreviewResource = {
    ...resource,
    url: resolvedUrl || resource.url,
    fileName,
    mimeType,
  };
  const serverPreviewType = source?.previewType;
  const mediaType = source?.mediaType
    ? source.mediaType as ContentPreviewKind
    : getContentPreviewKind(candidate, mimeType);
  const youtubeVideoId = source?.mediaId || getYouTubePreviewVideoId(candidate);
  const explicitProvider = resource.provider?.trim().toLowerCase();
  const normalizedExplicitProvider = isContentPreviewProvider(explicitProvider)
    ? explicitProvider
    : undefined;
  const sourceProvider = isContentPreviewProvider(source?.provider) ? source.provider : undefined;
  const provider: ContentPreviewProvider = sourceProvider || (
    youtubeVideoId || explicitProvider === "youtube"
      ? "youtube"
      : normalizedExplicitProvider || (
          resource.resolveSource || explicitProvider?.startsWith("worshipsync")
            ? "worshipsync"
            : mediaType === "web"
              ? "web"
              : resolvedUrl
                ? "direct"
                : "unknown"
        )
  );
  const normalizedProvider = isContentPreviewProvider(provider) ? provider : "unknown";
  const providerLabel = (sourceProvider ? PROVIDER_LABELS[sourceProvider] : null) ||
    getContentPreviewProviderLabel(provider, originalUrl || resolvedUrl || undefined);
  const renderer = serverPreviewType || mediaType;
  const canPreview = source?.canPreview ?? (mediaType !== "unsupported" && (
    mediaType === "text" || Boolean(resolvedUrl)
  ));

  return {
    originalUrl,
    resolvedUrl,
    title: getContentPreviewTitle(resource, resolvedUrl || originalUrl || undefined, {
      resolvedFileName: fileName,
      resolvedTitle: source?.title,
      providerLabel,
    }),
    provider: normalizedProvider,
    providerLabel,
    mediaType,
    mimeType,
    renderer,
    canPreview,
    ...(fileName ? { fileName } : {}),
    ...(youtubeVideoId ? { mediaId: youtubeVideoId } : {}),
    ...(source?.requiresProxy !== undefined ? { requiresProxy: source.requiresProxy } : {}),
    ...(source?.reason ? { reason: source.reason } : {}),
  };
};
