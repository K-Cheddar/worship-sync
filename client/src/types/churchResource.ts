import type { SongAudio } from "../types";

export type ChurchResourceKind = "document" | "audio" | "other";

export type ChurchResource = {
  id: string;
  churchId: string;
  name: string;
  description?: string;
  kind: ChurchResourceKind;
  storage: {
    key: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
  };
  tags?: string[];
  folderId?: string;
  access?: { scope: "church" | "services" | "admin" };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  contentVersion?: string;
};

export type ResourceLibrarySongAudioEntry = {
  source: "song-audio";
  songId: string;
  songName: string;
  audio: SongAudio;
};

export type ResourceLibraryChurchEntry = {
  source: "church-resource";
  resource: ChurchResource;
};

export type ResourceLibraryEntry =
  | ResourceLibraryChurchEntry
  | ResourceLibrarySongAudioEntry;

