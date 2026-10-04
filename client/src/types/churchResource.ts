import type { SongAudio } from "../types";

export type ChurchResourceKind = "document" | "audio" | "other";

export type ChurchResourceExternalSource = {
  url: string;
  provider?: string;
  mimeType?: string;
  fileName?: string;
  mediaType?: string;
  providerResourceId?: string;
  lastResolvedAt?: string;
};

type ChurchResourceBase = {
  id: string;
  churchId: string;
  name: string;
  description?: string;
  kind: ChurchResourceKind;
  tags?: string[];
  folderId?: string;
  access?: { scope: "church" | "services" | "admin" };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  contentVersion?: string;
  contentIndex?: {
    status: "pending" | "processing" | "ready" | "unsupported" | "failed" | "stale";
    version?: string;
    indexedAt?: string;
    sourceModifiedAt?: string;
    textLength?: number;
    chunkCount?: number;
    extractor?: string;
    error?: string;
  };
  deletionStatus?: "deleting";
  deletionRequestedAt?: string;
  deletionStorageDeletedAt?: string;
  deletionError?: string;
};

export type ChurchResourceUploadSource = {
  sourceType?: "upload";
  external?: never;
  storage: {
    key: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
  };
};

export type ChurchResourceExternalSourceRecord = {
  sourceType: "external";
  external: ChurchResourceExternalSource;
  storage?: never;
};

export type ChurchResource = ChurchResourceBase &
  (ChurchResourceUploadSource | ChurchResourceExternalSourceRecord);

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
