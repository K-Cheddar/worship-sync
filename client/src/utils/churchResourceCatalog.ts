import type { DBItem } from "../types";
import type {
  ChurchResource,
  ResourceLibraryEntry,
} from "../types/churchResource";

export const buildChurchResourceLibraryEntries = ({
  resources,
  songs,
}: {
  resources: ChurchResource[];
  songs: DBItem[];
}): ResourceLibraryEntry[] => {
  const churchEntries: ResourceLibraryEntry[] = resources.map((resource) => ({
    source: "church-resource",
    resource,
  }));
  const songEntries: ResourceLibraryEntry[] = songs
    .filter((song) => song.type === "song" && Boolean(song.songAudio))
    .map((song) => ({
      source: "song-audio",
      songId: song._id,
      songName: song.name,
      audio: song.songAudio!,
    }));
  return [...churchEntries, ...songEntries];
};

export const resourceEntryName = (entry: ResourceLibraryEntry): string =>
  entry.source === "church-resource" ? entry.resource.name : entry.audio.fileName;

export const resourceEntryContentType = (
  entry: ResourceLibraryEntry,
): string =>
  entry.source === "church-resource"
    ? entry.resource.sourceType === "external"
      ? entry.resource.external.mimeType || ""
      : entry.resource.storage.contentType
    : entry.audio.contentType;

export const resourceEntrySize = (entry: ResourceLibraryEntry): number | null =>
  entry.source === "song-audio"
    ? entry.audio.sizeBytes
    : entry.resource.sourceType === "external"
      ? null
      : entry.resource.storage.sizeBytes;

export const resourceEntrySource = (entry: ResourceLibraryEntry): string => {
  if (entry.source === "song-audio") return `Song attachment - ${entry.songName}`;
  if (entry.resource.sourceType !== "external") return "WorshipSync";
  const provider = entry.resource.external.provider;
  const labels: Record<string, string> = {
    "google-drive": "Google Drive", dropbox: "Dropbox", onedrive: "OneDrive",
    sharepoint: "SharePoint", box: "Box", youtube: "YouTube",
  };
  return (provider && labels[provider]) || "External link";
};

export const resourceEntryKind = (
  entry: ResourceLibraryEntry,
): "document" | "audio" => {
  if (entry.source === "song-audio") return "audio";
  if (entry.resource.kind === "audio") return "audio";
  return "document";
};

export const resourceEntryDeleteActionLabel = (
  entry: ResourceLibraryEntry,
): string => (entry.source === "song-audio" ? "Remove from song" : "Delete");

export const resourceEntryDeleteConfirmation = (
  entry: ResourceLibraryEntry,
): string =>
  entry.source === "song-audio"
    ? `Remove "${entry.audio.fileName}" from "${entry.songName}"? This removes the audio attachment from the song; it does not delete the song.`
    : `Delete "${entry.resource.name}"?`;
