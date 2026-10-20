import type { ResourceLibraryEntry } from "../types/churchResource";
import { resourceEntryFileVisual, resourceEntrySize, resourceEntrySource } from "./churchResourceCatalog";

export type ResourceSortKey = "name" | "type" | "size" | "updated" | "source";
export type SortDirection = "asc" | "desc";

export const formatBytes = (sizeBytes: number) => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};
export const formatEntrySize = (entry: ResourceLibraryEntry) => {
  const size = entrySize(entry);
  return size === null ? "External" : formatBytes(size);
};

export const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString();
};

export const entryUpdatedAt = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource"
    ? entry.resource.updatedAt || (entry.resource.sourceType === "external" ? "" : entry.resource.storage.uploadedAt)
    : entry.audio.uploadedAt;

export const typeLabel = (entry: ResourceLibraryEntry) => resourceEntryFileVisual(entry).label;

export const entryKey = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource"
    ? `resource:${entry.resource.id}`
    : `song-audio:${entry.songId}:${entry.audio.id}`;

export const entrySize = (entry: ResourceLibraryEntry) =>
  resourceEntrySize(entry);

export const entrySource = (entry: ResourceLibraryEntry) =>
  resourceEntrySource(entry);

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
