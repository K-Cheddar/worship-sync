import { getExternalResourceResolution } from "../../api/auth";
import { getApiBasePath } from "../../utils/environment";
import { getYouTubeVideoReference } from "../../utils/youtube";
import type { RichTextDocument } from "../../types/richText";
import type { ExternalResourceSourceKind } from "../../api/externalResource";
import type { ChurchResource } from "../../types/churchResource";
import type { SongAudio } from "../../types";

export type ContentPreviewRenderer =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "docx"
  | "text"
  | "youtube"
  | "web"
  | "unsupported";
export type ContentPreviewKind = ContentPreviewRenderer;

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
  sourceKind?: ExternalResourceSourceKind;
  mediaId?: string;
  reason?: string;
};

export type ContentPreviewResolution = {
  originalUrl: string | null;
  resolvedUrl: string | null;
  title: string;
  provider: ContentPreviewProvider;
  providerLabel: string;
  mimeType?: string;
  renderer: ContentPreviewRenderer;
  fileName?: string;
  mediaId?: string;
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
  sourceKind?: ExternalResourceSourceKind;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  textContent?: string;
  richTextContent?: RichTextDocument;
  resolveSource?: () => Promise<ContentPreviewResolvedSource>;
};

export const createChurchResourcePreview = (
  resource: ChurchResource,
  resolveSource?: () => Promise<ContentPreviewResolvedSource>,
): ContentPreviewResource => resource.sourceType === "external"
  ? {
      id: resource.id,
      title: resource.name,
      url: resource.external.url,
      provider: resource.external.provider,
      mimeType: resource.external.mimeType,
      fileName: resource.external.fileName,
    }
  : {
      id: resource.id,
      title: resource.name,
      provider: "worshipsync",
      sourceKind: "file",
      mimeType: resource.storage.contentType,
      fileName: resource.storage.fileName,
      ...(resolveSource ? { resolveSource } : {}),
    };

export const createSongAudioPreview = (
  audio: SongAudio,
  songId: string,
  resolveSource: () => Promise<ContentPreviewResolvedSource>,
): ContentPreviewResource => ({
  id: audio.id,
  title: audio.fileName,
  provider: "worshipsync",
  sourceKind: "file",
  mimeType: audio.contentType,
  fileName: audio.fileName,
  resolveSource,
  type: `song-audio:${songId}`,
});

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const MIME_KIND_BY_PREFIX: Array<[string, ContentPreviewRenderer]> = [
  ["image/", "image"],
  ["audio/", "audio"],
  ["video/", "video"],
];

const MIME_KIND_BY_VALUE: Record<string, ContentPreviewRenderer> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
  "application/msword": "unsupported",
  "application/vnd.ms-excel": "unsupported",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "unsupported",
  "application/vnd.ms-powerpoint": "unsupported",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "unsupported",
  "text/html": "web",
  "application/xhtml+xml": "web",
};

const EXTENSION_KIND: Record<string, ContentPreviewRenderer> = {
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
  pdf: "pdf",
  docx: "docx",
  doc: "unsupported",
  xls: "unsupported",
  xlsx: "unsupported",
  ppt: "unsupported",
  pptx: "unsupported",
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

const MEDIA_KIND_LABELS: Record<ContentPreviewRenderer, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
  docx: "Document",
  youtube: "Video",
  text: "Text",
  web: "Web page",
  unsupported: "Resource",
};

const normalizedMimeType = (value?: string): string =>
  value?.split(";", 1)[0]?.trim().toLowerCase() || "";

const isGenericMimeType = (value?: string): boolean =>
  ["application/octet-stream", "application/binary", "binary/octet-stream"].includes(
    normalizedMimeType(value),
  );

const kindForMimeType = (mimeType?: string): ContentPreviewRenderer | null => {
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

const kindForFileName = (fileName?: string | null): ContentPreviewRenderer | null =>
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

export const selectPreviewRenderer = ({
  sourceKind,
  mimeType,
  fileName,
  provider,
  mediaId,
  url,
  textContent,
}: {
  sourceKind?: ExternalResourceSourceKind;
  mimeType?: string;
  fileName?: string | null;
  provider?: string;
  mediaId?: string;
  url?: string;
  textContent?: string;
}): ContentPreviewRenderer => {
  if (textContent !== undefined) return "text";
  if (sourceKind === "unavailable") return "unsupported";
  const youtube = provider?.toLowerCase() === "youtube" || Boolean(mediaId && YOUTUBE_VIDEO_ID_PATTERN.test(mediaId))
    ? mediaId || (url ? getYouTubeVideoReference(url)?.videoId : undefined)
    : undefined;
  if (youtube && YOUTUBE_VIDEO_ID_PATTERN.test(youtube)) return "youtube";
  const metadataRenderer = kindForMimeType(mimeType) || kindForFileName(fileName) || kindForUrlExtension(url);
  if (metadataRenderer) return metadataRenderer;
  if (sourceKind === "web") return "web";
  if (sourceKind === "file" || sourceKind === "youtube") return "unsupported";
  return getSafeHttpUrl(url) ? "web" : "unsupported";
};

export const getContentPreviewKind = (resource: ContentPreviewResource, resolvedMimeType?: string): ContentPreviewRenderer =>
  selectPreviewRenderer({
    sourceKind: resource.sourceKind || (resource.type === "youtube" ? "youtube" : undefined),
    mimeType: resolvedMimeType || resource.mimeType,
    fileName: resource.fileName,
    provider: resource.provider,
    mediaId: resource.mediaId,
    url: resource.url,
    textContent: resource.textContent,
  });

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
  const previewUrl = toAbsolutePreviewUrl(resolved.previewUrl || undefined);
  return {
    url: previewUrl || "",
    originalUrl: resolved.originalUrl || resourceUrl,
    provider: resolved.provider,
    sourceKind: resolved.sourceKind,
    title: resolved.title,
    mimeType: resolved.mimeType,
    fileName: resolved.filename,
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
  const resolvedUrl = source ? sourceUrl : originalUrl;
  const fileName = resource.fileName || source?.fileName;
  const resolvedMimeType = isGenericMimeType(source?.mimeType)
    ? undefined
    : normalizedMimeType(source?.mimeType);
  const mimeType = resolvedMimeType || normalizedMimeType(resource.mimeType) || undefined;
  const candidate: ContentPreviewResource = {
    ...resource,
    url: resolvedUrl || resource.url,
    fileName,
    mimeType,
  };
  const youtubeVideoId = source?.mediaId || getYouTubePreviewVideoId(candidate);
  const explicitProvider = resource.provider?.trim().toLowerCase();
  const normalizedExplicitProvider = isContentPreviewProvider(explicitProvider)
    ? explicitProvider
    : undefined;
  const sourceProvider = isContentPreviewProvider(source?.provider) ? source.provider : undefined;
  const renderer = selectPreviewRenderer({
    sourceKind: source?.sourceKind || resource.sourceKind || (youtubeVideoId ? "youtube" : undefined),
    mimeType,
    fileName,
    provider: source?.provider || resource.provider,
    mediaId: youtubeVideoId || undefined,
    url: resolvedUrl || resource.url,
    textContent: resource.textContent,
  });
  const provider: ContentPreviewProvider = sourceProvider || (
    youtubeVideoId || explicitProvider === "youtube"
      ? "youtube"
      : normalizedExplicitProvider || (
          resource.resolveSource || explicitProvider?.startsWith("worshipsync")
            ? "worshipsync"
            : renderer === "web"
              ? "web"
              : resolvedUrl
                ? "direct"
                : "unknown"
        )
  );
  const normalizedProvider = isContentPreviewProvider(provider) ? provider : "unknown";
  const providerLabel = (sourceProvider ? PROVIDER_LABELS[sourceProvider] : null) ||
    getContentPreviewProviderLabel(provider, originalUrl || resolvedUrl || undefined);
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
    mimeType,
    renderer,
    ...(fileName ? { fileName } : {}),
    ...(youtubeVideoId ? { mediaId: youtubeVideoId } : {}),
    ...(source?.reason ? { reason: source.reason } : {}),
  };
};
