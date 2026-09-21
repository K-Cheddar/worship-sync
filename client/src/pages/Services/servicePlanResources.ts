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
export const createServicePlanDocumentResource = ({
  resourceId,
}: {
  resourceId: string;
}): ServicePlanContentResource => ({
  id: generateRandomId(),
  type: "document",
  title: "Church resource",
  data: { resourceId },
});
