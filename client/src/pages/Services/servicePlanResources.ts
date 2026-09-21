import {
  AudioLines,
  BookOpen,
  FileQuestion,
  FileText,
  Link as LinkIcon,
  Music,
  StickyNote,
  SquarePlay,
  type LucideIcon,
} from "lucide-react";
import generateRandomId from "../../utils/generateRandomId";
import { getYouTubeVideoReference } from "../../utils/youtube";
import type {
  ServicePlanContentResource,
  ServicePlanContentResourceType,
} from "../../types/servicePlan";
import type { ChurchResource } from "../../types/churchResource";
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
  document: { label: "Church file", icon: FileText, toneClassName: "text-cyan-300", canEdit: false },
  url: { label: "Web link", icon: LinkIcon, toneClassName: "text-blue-300", canEdit: true },
  text: { label: "Notes", icon: StickyNote, toneClassName: "text-emerald-300", canEdit: true },
  generic: { label: "Other", icon: FileQuestion, toneClassName: "text-gray-300", canEdit: true },
};

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
): string => getServicePlanResourceDataString(resource, "notes");

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
  textContent: getServicePlanResourceDataString(resource, "text") || undefined,
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
  text: string;
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
  notes: string;
  url: string;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "generic",
  title: title.trim() || "Untitled resource",
  ...(url.trim() ? { url: url.trim() } : {}),
  ...(notes.trim() ? { data: { notes } } : {}),
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
