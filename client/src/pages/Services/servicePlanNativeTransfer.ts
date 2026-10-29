import generateRandomId from "../../utils/generateRandomId";
import { normalizeRichTextDocument, plainTextToRichText } from "../../types/richText";
import {
  getServicePlanElementAssignees,
  getServicePlanElementSongRefs,
  getServicePlanElementType,
} from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanContentResource,
  ServicePlanSection,
  ServicePlanSongReference,
} from "../../types/servicePlan";
import type { PublicServiceFlow } from "../../services/serviceFlowTypes";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";

export const WORSHIPSYNC_PLAN_FORMAT = "worshipsync-service-plan";
export const WORSHIPSYNC_PLAN_VERSION = 1;

export type WorshipSyncPlanFile = {
  format: typeof WORSHIPSYNC_PLAN_FORMAT;
  version: typeof WORSHIPSYNC_PLAN_VERSION;
  churchId?: string;
  sections: ServicePlanSection[];
};

const cloneRichText = (value: unknown) => {
  const normalized = normalizeRichTextDocument(value);
  return {
    blocks: normalized.blocks.map((block) => ({
      ...block,
      id: undefined,
      spans: block.spans.map((span) => ({ ...span })),
    })),
  };
};

const mapSongRefs = (
  element: ServicePlanElement,
  sameChurch: boolean,
  songs: Array<{ _id: string; name: string }>,
): ServicePlanSongReference[] => getServicePlanElementSongRefs(element).map((reference) => {
  if (reference.kind === "pending") return { ...reference, id: generateRandomId() };
  if (sameChurch) return { ...reference, id: generateRandomId() };
  const match = songs.find((song) => song.name.trim().toLocaleLowerCase() === reference.songName.trim().toLocaleLowerCase());
  if (match) return { kind: "library", id: generateRandomId(), songId: match._id, songName: match.name, ...(reference.key ? { key: reference.key } : {}) };
  return { kind: "pending", id: generateRandomId(), title: reference.songName, lyricsText: "", ...(reference.key ? { key: reference.key } : {}) };
});

const cleanSections = (
  sections: ServicePlanSection[],
  { sourceChurchId, targetChurchId, songs }: { sourceChurchId?: string; targetChurchId?: string; songs: Array<{ _id: string; name: string }> },
): ServicePlanSection[] => {
  const sameChurch = Boolean(sourceChurchId && sourceChurchId === targetChurchId);
  return sections.map((section) => ({
    id: generateRandomId(),
    name: section.name,
    ...(section.phase ? { phase: section.phase } : {}),
    elements: section.elements.map((item) => {
      const originalSongRefs = getServicePlanElementSongRefs(item);
      const songRefs = mapSongRefs(item, sameChurch, songs);
      const originalScriptures = item.scriptureRefs || (item.scriptureRef ? [item.scriptureRef] : []);
      const scriptureRefs = originalScriptures.map((reference) => ({ ...reference, id: generateRandomId() }));
      const originalResources = item.resources || [];
      const resources = originalResources.map((resource) => {
        const data = { ...(resource.data || {}) };
        if (!sameChurch) delete data.customDocumentId;
        const storedSong = data.songRef;
        if (storedSong && typeof storedSong === "object") {
          const storedSongId = (storedSong as { songId?: unknown }).songId;
          const index = originalSongRefs.findIndex((reference) => reference.kind === "library" && storedSongId === reference.songId);
          if (index >= 0) data.songRef = songRefs[index];
          else {
            const storedSongName = (storedSong as { songName?: unknown }).songName;
            if (typeof storedSongName !== "string" || !storedSongName.trim()) {
              delete data.songRef;
            } else if (sameChurch && typeof storedSongId === "string" && storedSongId) {
              data.songRef = { kind: "library", id: generateRandomId(), songId: storedSongId, songName: storedSongName };
            } else {
              const match = songs.find((song) => song.name.trim().toLocaleLowerCase() === storedSongName.trim().toLocaleLowerCase());
              data.songRef = match
                ? { kind: "library", id: generateRandomId(), songId: match._id, songName: match.name }
                : { kind: "pending", id: generateRandomId(), title: storedSongName, lyricsText: "" };
            }
          }
        }
        return { ...resource, id: generateRandomId(), ...(Object.keys(data).length ? { data } : { data: undefined }) };
      });
      const contentIdMap = new Map<string, string>();
      originalSongRefs.forEach((reference, index) => contentIdMap.set(reference.id || `legacy-song-${index}-${reference.kind}`, songRefs[index].id!));
      originalScriptures.forEach((reference, index) => contentIdMap.set(reference.id || `legacy-scripture-${index}`, scriptureRefs[index].id!));
      originalResources.forEach((resource, index) => contentIdMap.set(resource.id, resources[index].id));
      const contentOrder = item.contentOrder?.flatMap((id) => contentIdMap.has(id) ? [contentIdMap.get(id)!] : []);
      const element: ServicePlanElement = {
        id: generateRandomId(),
        type: item.type,
        title: cloneRichText(item.title),
        ...(item.notes ? { notes: cloneRichText(item.notes) } : {}),
        ...(item.teamNotes?.length ? { teamNotes: item.teamNotes.map((note) => ({
          ...note, id: generateRandomId(), note: cloneRichText(note.note),
          ...(sameChurch ? {} : { teamId: undefined, teamIds: undefined, positionId: undefined, positionIds: undefined }),
        })) } : {}),
        ...(item.startTime ? { startTime: item.startTime } : {}),
        ...(Number.isFinite(item.durationSeconds) ? { durationSeconds: item.durationSeconds } : {}),
        ...(Number.isFinite(item.durationMinutes) ? { durationMinutes: item.durationMinutes } : {}),
        ...(songRefs.length ? { songRefs } : {}),
        ...(scriptureRefs.length ? { scriptureRefs } : {}),
        ...(resources.length ? { resources } : {}),
        ...(contentOrder?.length ? { contentOrder } : {}),
        ...(getServicePlanElementAssignees(item).length ? { assignees: getServicePlanElementAssignees(item).map((assignee) => ({
          ...assignee, id: generateRandomId(),
          ...(sameChurch ? {} : { memberId: undefined, microphoneIds: undefined, iemIds: undefined }),
        })) } : {}),
        ...(item.participantOverlay ? { participantOverlay: { ...item.participantOverlay } } : {}),
        ...(sameChurch && item.positionId ? { positionId: item.positionId } : {}),
        ...(sameChurch && item.scheduledPositionIds ? { scheduledPositionIds: [...item.scheduledPositionIds] } : {}),
      };
      if (item.microphoneAssignments?.length) {
        element.microphoneAssignments = sameChurch
          ? item.microphoneAssignments.map((assignment) => ({ ...assignment }))
          : undefined;
      }
      element.songRef = undefined;
      element.scriptureRef = undefined;
      element.type = getServicePlanElementType(element);
      return element;
    }),
  }));
};

export const exportWorshipSyncPlan = (sections: ServicePlanSection[], churchId?: string, songs: Array<{ _id: string; name: string }> = []): WorshipSyncPlanFile => {
  const exportSongs = [...songs];
  sections.flatMap((section) => section.elements).forEach((element) => {
    getServicePlanElementSongRefs(element).forEach((reference) => {
      if (reference.kind === "library" && !exportSongs.some((song) => song._id === reference.songId)) {
        exportSongs.push({ _id: reference.songId, name: reference.songName });
      }
    });
  });
  return {
    format: WORSHIPSYNC_PLAN_FORMAT,
    version: WORSHIPSYNC_PLAN_VERSION,
    ...(churchId ? { churchId } : {}),
    sections: cleanSections(sections, { sourceChurchId: churchId, targetChurchId: churchId, songs: exportSongs }),
  };
};

export const importWorshipSyncPlan = (
  raw: unknown,
  options: { targetChurchId?: string; songs?: Array<{ _id: string; name: string }> } = {},
): ServicePlanSection[] => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("This file is not a WorshipSync service plan.");
  const file = raw as Record<string, unknown>;
  if (file.format !== WORSHIPSYNC_PLAN_FORMAT || file.version !== WORSHIPSYNC_PLAN_VERSION || !Array.isArray(file.sections)) {
    throw new Error("This WorshipSync plan file format or version isn't supported.");
  }
  const sections = file.sections as ServicePlanSection[];
  if (sections.some((section) =>
    !section || typeof section.name !== "string"
    || (section.phase !== undefined && !["pre", "main", "post"].includes(section.phase))
    || !Array.isArray(section.elements)
    || section.elements.some((item) => !item || typeof item !== "object"
      || typeof item.type !== "string" || !item.title || typeof item.title !== "object"),
  )) {
    throw new Error("This WorshipSync plan file has invalid sections.");
  }
  return cleanSections(sections, {
    sourceChurchId: typeof file.churchId === "string" ? file.churchId : undefined,
    targetChurchId: options.targetChurchId,
    songs: options.songs || [],
  });
};

export const publicServiceFlowToSections = (
  service: PublicServiceFlow,
  songs: Array<{ _id: string; name: string }> = [],
): ServicePlanSection[] => {
  const sections: ServicePlanSection[] = service.sections.map((section) => ({
    id: generateRandomId(),
    name: section.title,
    elements: section.items.map((item) => {
      const title = plainTextToRichText(item.title || "Untitled");
      const songRefs: ServicePlanSongReference[] = (item.songs || []).map((songName) => {
        const match = songs.find((song) => song.name.trim().toLocaleLowerCase() === songName.trim().toLocaleLowerCase());
        return match
          ? { kind: "library", id: generateRandomId(), songId: match._id, songName: match.name }
          : { kind: "pending", id: generateRandomId(), title: songName, lyricsText: "" };
      });
      const unresolvedScriptures: string[] = [];
      const scriptureRefs = (item.scriptureRefs || []).flatMap((label) => {
        const parsed = parseBibleReference(label);
        if (!parsed) unresolvedScriptures.push(label);
        return parsed ? [{ ...parsed, id: generateRandomId(), label }] : [];
      });
      const resources: ServicePlanContentResource[] = (item.resources || []).map((resource) => ({
        id: generateRandomId(), type: resource.type, title: resource.title,
        ...(resource.url ? { url: resource.url } : {}),
        ...((resource.detail || resource.richTextContent) ? { data: {
          ...(resource.detail ? { detail: resource.detail } : {}),
          ...(resource.richTextContent ? { richTextContent: resource.richTextContent } : {}),
        } } : {}),
      }));
      unresolvedScriptures.forEach((label) => resources.push({ id: generateRandomId(), type: "scripture", title: label, data: { unresolvedReference: true } }));
      const element: ServicePlanElement = {
        id: generateRandomId(), type: "free", title,
        ...(item.durationSeconds > 0 ? { durationSeconds: item.durationSeconds } : {}),
        ...(item.notes?.blocks?.length ? { notes: cloneRichText(item.notes) } : {}),
        ...(songRefs.length ? { songRefs } : {}),
        ...(scriptureRefs.length ? { scriptureRefs } : {}),
        ...(resources.length ? { resources } : {}),
        ...(item.creditName ? { assignees: [{ id: generateRandomId(), name: item.creditName }] } : {}),
        ...(item.teamNotes?.length ? { teamNotes: item.teamNotes.map((note) => ({ id: generateRandomId(), label: note.label, note: cloneRichText(note.notes) })) } : {}),
      };
      element.type = getServicePlanElementType(element);
      return element;
    }),
  }));
  return cleanSections(sections, { songs, targetChurchId: "", sourceChurchId: undefined });
};
