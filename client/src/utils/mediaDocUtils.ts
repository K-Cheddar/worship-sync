import type { DBMedia, MediaFolder, MediaType } from "../types";

const MEDIA_MAX_FOLDER_DEPTH = 8;

/** Normalize legacy `media` docs for Redux and UI. */
export function normalizeMediaDoc(doc: DBMedia | undefined): {
  list: MediaType[];
  folders: MediaFolder[];
} {
  if (!doc) return { list: [], folders: [] };
  const folders = Array.isArray(doc.folders) ? doc.folders : [];
  const validFolderIds = new Set(folders.map((f) => f.id));
  const list = (doc.list || []).map((item) => {
    const fid = item.folderId;
    if (fid != null && fid !== "" && !validFolderIds.has(fid)) {
      return { ...item, folderId: null };
    }
    if (item.folderId === undefined) {
      return { ...item, folderId: null };
    }
    return item;
  });
  return { list, folders };
}

export function normalizeFolderIdForSave(
  folderId: string | null | undefined,
  folders: MediaFolder[],
): string | null {
  if (folderId == null || folderId === "") return null;
  return folders.some((f) => f.id === folderId) ? folderId : null;
}

export function folderDepth(folderId: string, folders: MediaFolder[]): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  let current: string | null = folderId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return Infinity;
    seen.add(current);
    depth += 1;
    const f = byId.get(current);
    if (!f) return depth;
    current = f.parentId;
  }
  return depth;
}

export function wouldExceedMaxFolderDepth(
  parentId: string | null,
  folders: MediaFolder[],
): boolean {
  if (parentId == null) return false;
  const d = folderDepth(parentId, folders);
  return d >= MEDIA_MAX_FOLDER_DEPTH;
}

export function siblingNameExists(
  name: string,
  parentId: string | null,
  folders: MediaFolder[],
  excludeFolderId?: string,
): boolean {
  const t = name.trim().toLowerCase();
  if (!t) return true;
  return folders.some(
    (f) =>
      f.id !== excludeFolderId &&
      (f.parentId ?? null) === (parentId ?? null) &&
      f.name.trim().toLowerCase() === t,
  );
}

export function getMediaMaxFolderDepth(): number {
  return MEDIA_MAX_FOLDER_DEPTH;
}
