import type { MediaFolder, MediaRouteKey, MediaType } from "../types";
import { MEDIA_ROUTE_KEYS } from "./mediaRouteKey";

/** Virtual route value: show only items with no `folderId` (library root). */
export const MEDIA_LIBRARY_ROOT_VIEW = "__ws_media_root__";

/**
 * When folder rows are removed, any route that remembered one of those folders
 * should fall back to `fallbackFolderId` (deleted folder's parent, or
 * {@link MEDIA_LIBRARY_ROOT_VIEW} when there is no parent).
 */
export function getMediaRouteFolderRepairs(
  mediaRouteFolders: Partial<Record<MediaRouteKey, string | null>>,
  deletedFolderIds: Set<string>,
  fallbackFolderId: string,
): Partial<Record<MediaRouteKey, string | null>> {
  const repairs: Partial<Record<MediaRouteKey, string | null>> = {};
  for (const key of MEDIA_ROUTE_KEYS) {
    const v = mediaRouteFolders[key];
    if (typeof v === "string" && deletedFolderIds.has(v)) {
      repairs[key] = fallbackFolderId;
    }
  }
  return repairs;
}

/** Direct child folders of `parentId` (`null` = library root), sorted by name. */
export function getChildFolders(
  parentId: string | null,
  folders: MediaFolder[],
): MediaFolder[] {
  return folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

/** True when the folder has no child folders and no media assigned to it (safe to delete without a choice modal). */
export function isMediaLibraryFolderEmpty(
  folderId: string,
  folders: MediaFolder[],
  list: MediaType[],
): boolean {
  if (getChildFolders(folderId, folders).length > 0) return false;
  return !list.some((m) => m.folderId === folderId);
}

export function collectSubtreeFolderIds(
  rootId: string,
  folders: MediaFolder[],
): Set<string> {
  const byParent = new Map<string | null, MediaFolder[]>();
  for (const f of folders) {
    const p = f.parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(f);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.add(id);
    const kids = byParent.get(id) || [];
    for (const k of kids) stack.push(k.id);
  }
  return out;
}

export function deleteFolderKeepContents(
  folderId: string,
  folders: MediaFolder[],
  list: MediaType[],
): { folders: MediaFolder[]; list: MediaType[] } {
  const target = folders.find((f) => f.id === folderId);
  if (!target) return { folders, list };
  const parent = target.parentId;
  const nextFolders = folders
    .filter((f) => f.id !== folderId)
    .map((f) => {
      if (f.parentId === folderId) {
        return { ...f, parentId: parent, updatedAt: new Date().toISOString() };
      }
      return f;
    });
  const nextList = list.map((m) => {
    if (m.folderId === folderId) {
      return { ...m, folderId: parent, updatedAt: new Date().toISOString() };
    }
    return m;
  });
  return { folders: nextFolders, list: nextList };
}

export function deleteFolderAndSubtree(
  folderId: string,
  folders: MediaFolder[],
  list: MediaType[],
): { folders: MediaFolder[]; list: MediaType[]; removedMediaIds: string[] } {
  const subtree = collectSubtreeFolderIds(folderId, folders);
  const removedMediaIds = list
    .filter((m) => m.folderId != null && subtree.has(m.folderId))
    .map((m) => m.id);
  const nextFolders = folders.filter((f) => !subtree.has(f.id));
  const nextList = list.filter(
    (m) => !(m.folderId != null && subtree.has(m.folderId)),
  );
  return { folders: nextFolders, list: nextList, removedMediaIds };
}

export function moveMediaToFolder(
  mediaIds: Set<string>,
  targetFolderId: string | null,
  list: MediaType[],
): MediaType[] {
  const t = new Date().toISOString();
  return list.map((m) =>
    mediaIds.has(m.id) ? { ...m, folderId: targetFolderId, updatedAt: t } : m,
  );
}
