import {
  AudioLines,
  BookOpen,
  FileQuestion,
  FileText,
  Files,
  Link as LinkIcon,
  Music,
  StickyNote,
  SquarePlay,
  type LucideIcon,
} from "lucide-react";
import generateRandomId from "../../utils/generateRandomId";
import { getYouTubeVideoReference } from "../../utils/youtube";
import { getServicePlanCustomDocumentId } from "../../types/servicePlan";
import type {
  ServicePlanContentResource,
  ServicePlanContentResourceType,
} from "../../types/servicePlan";
import type { ChurchResource } from "../../types/churchResource";
import {
  multilineTextToRichText,
  isRichTextEmpty,
  normalizeRichTextDocument,
  richTextToFormattedPlainText,
  type RichTextDocument,
} from "../../types/richText";
import type {
  ContentPreviewResource,
  ContentPreviewResolvedSource,
} from "../../components/ContentPreview/contentPreview";

export type ServicePlanResourceDefinition = {
  label: string;
  icon: LucideIcon;
  toneClassName: string;
  canEdit: boolean;
};

/**
 * The single registry used by resource cards and the add-content menu. An
 * unknown persisted type intentionally resolves to the generic definition.
 */
export const SERVICE_PLAN_RESOURCE_REGISTRY: Record<
  ServicePlanContentResourceType,
  ServicePlanResourceDefinition
> = {
  song: { label: "Song", icon: Music, toneClassName: "text-cyan-300", canEdit: false },
  scripture: { label: "Scripture", icon: BookOpen, toneClassName: "text-violet-300", canEdit: false },
  youtube: { label: "YouTube", icon: SquarePlay, toneClassName: "text-red-300", canEdit: false },
  audio: { label: "Audio", icon: AudioLines, toneClassName: "text-amber-300", canEdit: false },
  document: { label: "File", icon: FileText, toneClassName: "text-cyan-300", canEdit: false },
  "custom-document": { label: "Custom document", icon: Files, toneClassName: "text-indigo-300", canEdit: false },
  url: { label: "Web link", icon: LinkIcon, toneClassName: "text-blue-300", canEdit: true },
  text: { label: "Notes", icon: StickyNote, toneClassName: "text-emerald-300", canEdit: true },
  generic: { label: "Other", icon: FileQuestion, toneClassName: "text-gray-300", canEdit: true },
};

/** Store a PouchDB custom-item id and its current name, never its slide data. */
export const createServicePlanCustomDocumentReference = ({
  documentId,
  title,
}: {
  documentId: string;
  title: string;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "custom-document",
  title: title.trim() || "Untitled custom document",
  data: { customDocumentId: documentId },
});

export const getServicePlanCustomDocumentDisplayLabel = (
  resource: ServicePlanContentResource,
  document?: { _id: string; name: string },
): string =>
  (document?._id === getServicePlanCustomDocumentId(resource)
    ? document.name.trim()
    : "") || resource.title.trim() || "Untitled custom document";

export const getServicePlanResourceDefinition = (
  type: string,
): ServicePlanResourceDefinition =>
  SERVICE_PLAN_RESOURCE_REGISTRY[type as ServicePlanContentResourceType] ||
  SERVICE_PLAN_RESOURCE_REGISTRY.generic;

export const getServicePlanResourceTypeLabel = (type: string): string =>
  getServicePlanResourceDefinition(type).label;

export const getServicePlanResourceDataString = (
  resource: ServicePlanContentResource,
  key: string,
): string => {
  const value = resource.data?.[key];
  return typeof value === "string" ? value : "";
};

export const getServicePlanResourceNotes = (
  resource: ServicePlanContentResource,
): string => richTextToFormattedPlainText(getServicePlanResourceRichNotes(resource));

/** Read rich and legacy plain-text resource notes through one compatible path. */
export const getServicePlanResourceText = (
  resource: ServicePlanContentResource,
): RichTextDocument => {
  const value = resource.data?.text;
  return typeof value === "string"
    ? multilineTextToRichText(value)
    : normalizeRichTextDocument(value);
};

/** Read rich and legacy plain-text optional notes through one compatible path. */
export const getServicePlanResourceRichNotes = (
  resource: ServicePlanContentResource,
): RichTextDocument => {
  const value = resource.data?.notes;
  return typeof value === "string"
    ? multilineTextToRichText(value)
    : normalizeRichTextDocument(value);
};

const getExplicitServicePlanResourceTitle = (
  resource: ServicePlanContentResource,
): string => {
  const title = resource.title?.trim() || "";
  const url = resource.url?.trim() || "";
  const normalizedTitle = title.toLowerCase();
  const isPlaceholder = ["untitled resource", "church resource"].includes(normalizedTitle);
  return title && title !== url && !isPlaceholder ? title : "";
};

export const getServicePlanResourceDisplayLabel = (
  resource: ServicePlanContentResource,
  churchResource?: ChurchResource,
): string =>
  churchResource?.name?.trim() ||
  getExplicitServicePlanResourceTitle(resource) ||
  resource.url?.trim() ||
  "Untitled resource";

type ContentPreviewNormalizerOptions = {
  churchResource?: ChurchResource;
  resolveSource?: () => Promise<ContentPreviewResolvedSource>;
};

/** Convert current and future Service Plan records into the shared preview shape. */
export const normalizeServicePlanResourceForPreview = (
  resource: ServicePlanContentResource,
  options: ContentPreviewNormalizerOptions = {},
): ContentPreviewResource => ({
  id: resource.id,
  title: options.churchResource?.name?.trim() || getExplicitServicePlanResourceTitle(resource) || undefined,
  url: resource.url,
  type: resource.type,
  provider: resource.provider,
  mediaId: resource.mediaId,
  mimeType: resource.metadata?.mimeType || options.churchResource?.storage.contentType,
  fileName: options.churchResource?.storage.fileName,
  textContent: richTextToFormattedPlainText(getServicePlanResourceText(resource)) || undefined,
  ...(options.resolveSource ? { resolveSource: options.resolveSource } : {}),
});

/**
 * ChurchResource references retain the historical `document` wire type for
 * persisted-plan compatibility. Their effective file/audio behavior comes
 * from the referenced ChurchResource metadata, never from a copied URL/key.
 */
export const getServicePlanChurchResourceId = (
  resource: ServicePlanContentResource,
): string => {
  if (resource.type !== "document" && resource.type !== "church-resource") {
    return "";
  }
  return getServicePlanResourceDataString(resource, "resourceId");
};

export const isServicePlanChurchResourceReference = (
  resource: ServicePlanContentResource,
): boolean => Boolean(getServicePlanChurchResourceId(resource));

export const getEffectiveServicePlanResourceDefinition = (
  resource: ServicePlanContentResource,
  churchResource?: ChurchResource,
): ServicePlanResourceDefinition => {
  if (getServicePlanChurchResourceId(resource)) {
    return churchResource?.kind === "audio"
      ? SERVICE_PLAN_RESOURCE_REGISTRY.audio
      : SERVICE_PLAN_RESOURCE_REGISTRY.document;
  }
  return getServicePlanResourceDefinition(resource.type);
};

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** Public snapshots may link to public web resources, never church files or signed storage URLs. */
export const getSafePublicServicePlanResourceUrl = (
  resource: ServicePlanContentResource,
): string | undefined => {
  if (["document", "church-resource", "custom-document", "audio"].includes(resource.type)) {
    return undefined;
  }
  const rawUrl = resource.url?.trim();
  if (!rawUrl || !isHttpUrl(rawUrl)) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return undefined;
    const sensitiveParameter = /^(?:x-amz-|x-goog-|awsaccesskeyid$|googleaccessid$|key-pair-id$|credential$|signature$|sig$|token$|access_token$|auth$|key$|expires$|policy$|code$)/i;
    if ([...url.searchParams.keys()].some((key) => sensitiveParameter.test(key))) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

export const getPublicServicePlanResourceTitle = (
  resource: ServicePlanContentResource,
): string => {
  const title = resource.title?.trim() || "";
  const safeUrl = getSafePublicServicePlanResourceUrl(resource);
  const isPlaceholder = ["untitled resource", "church resource"].includes(title.toLowerCase());
  return title && title !== resource.url?.trim() && !isPlaceholder
    ? title
    : safeUrl
      ? new URL(safeUrl).hostname.replace(/^www\./i, "")
      : "Untitled resource";
};

export const createServicePlanLinkResource = ({
  title,
  url,
}: {
  title: string;
  url: string;
}): ServicePlanContentResource => {
  const trimmedUrl = url.trim();
  const youtube = getYouTubeVideoReference(trimmedUrl);
  return {
    id: generateRandomId(),
    type: youtube ? "youtube" : "url",
    title: title.trim() || trimmedUrl,
    url: youtube?.watchUrl || trimmedUrl,
    ...(youtube
      ? { provider: "youtube", mediaId: youtube.videoId }
      : {}),
    ...(youtube?.thumbnailUrl
      ? { metadata: { thumbnailUrl: youtube.thumbnailUrl } }
      : {}),
  };
};

export const createServicePlanTextResource = ({
  title,
  text,
}: {
  title: string;
  text: RichTextDocument;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "text",
  title: title.trim() || "Notes",
  data: { text },
});

export const createServicePlanGenericResource = ({
  title,
  notes,
  url,
}: {
  title: string;
  notes: RichTextDocument;
  url: string;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "generic",
  title: title.trim() || "Untitled resource",
  ...(url.trim() ? { url: url.trim() } : {}),
  ...(!isRichTextEmpty(notes) ? { data: { notes } } : {}),
});

export const createServicePlanAudioResource = ({
  title,
  songId,
  audioId,
}: {
  title: string;
  songId: string;
  audioId: string;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "audio",
  title: title.trim() || "Reference audio",
  mediaId: audioId,
  provider: "worshipsync-song-audio",
  data: { songId, audioId },
});

/** Persist only the stable ChurchResource reference; metadata and URLs stay server-owned. */
export const createServicePlanChurchResourceReference = ({
  resourceId,
}: {
  resourceId: string;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "document",
  title: "Church resource",
  data: { resourceId },
});

// Keep the original creator name for callers and saved-plan tooling that
// already describe this compatible wire shape as a document reference.
export const createServicePlanDocumentResource =
  createServicePlanChurchResourceReference;
