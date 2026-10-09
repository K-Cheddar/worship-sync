import type { DBMedia, MediaFolder, MediaType } from "../types";

export const MEDIA_LIBRARY_META_ID = "media-library-meta";
export const MEDIA_FOLDERS_ID = "media-folders";
export const MEDIA_ITEM_PREFIX = "media-item:";
export const MEDIA_LIBRARY_SCHEMA_VERSION = 2;

export type MediaItemDoc = MediaType & {
  _id: string;
  _rev?: string;
  docType: "mediaItem";
};

export type MediaLibraryMeta = {
  _id: typeof MEDIA_LIBRARY_META_ID;
  _rev?: string;
  docType: "mediaLibraryMeta";
  schemaVersion: number;
};

export type MediaFoldersDoc = {
  _id: typeof MEDIA_FOLDERS_ID;
  _rev?: string;
  docType: "mediaFolders";
  folders: MediaFolder[];
};

export type MediaReplicationChange =
  | { kind: "item-upsert"; item: Pick<MediaType, "id"> & Partial<MediaType> }
  | { kind: "item-delete"; id: string }
  | { kind: "folders"; folders: MediaFolder[] };

export const mediaItemDocId = (id: string) => `${MEDIA_ITEM_PREFIX}${id}`;

export function parseMediaReplicationDoc(value: unknown): MediaReplicationChange | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Record<string, unknown>;
  if (doc._id === MEDIA_FOLDERS_ID && Array.isArray(doc.folders)) {
    return { kind: "folders", folders: doc.folders as MediaFolder[] };
  }
  if (typeof doc._id !== "string" || !doc._id.startsWith(MEDIA_ITEM_PREFIX)) return null;
  const id = doc._id.slice(MEDIA_ITEM_PREFIX.length);
  if (doc._deleted === true || doc.deleted === true) return { kind: "item-delete", id };
  if (doc.docType !== "mediaItem" || doc.id !== id) return null;
  const item = { ...doc } as Record<string, unknown>;
  delete item._id;
  delete item._rev;
  delete item.docType;
  return { kind: "item-upsert", item: item as unknown as Pick<MediaType, "id"> & Partial<MediaType> };
}

export const isMediaLibraryV2 = async (db: PouchDB.Database) => {
  try {
    const meta = (await db.get(MEDIA_LIBRARY_META_ID)) as MediaLibraryMeta;
    return Number.isSafeInteger(meta.schemaVersion) &&
      meta.schemaVersion >= MEDIA_LIBRARY_SCHEMA_VERSION;
  } catch (error) {
    if (isPouchNotFound(error)) return false;
    throw error;
  }
};

export async function requireMediaLibraryV2(db: PouchDB.Database): Promise<void> {
  if (!(await isMediaLibraryV2(db))) {
    throw new Error("Media library schema v2 is not initialized in this database.");
  }
}

export async function loadAllMediaItems(
  db: PouchDB.Database,
): Promise<MediaType[]> {
  const result = await db.allDocs<MediaItemDoc>({
    include_docs: true,
    startkey: MEDIA_ITEM_PREFIX,
    endkey: `${MEDIA_ITEM_PREFIX}\uffff`,
  });
  return result.rows.flatMap((row) => {
    const doc = row.doc;
    if (!doc || doc.docType !== "mediaItem" || !doc.id) return [];
    const item = { ...doc } as Partial<MediaItemDoc>;
    delete item._id;
    delete item._rev;
    delete item.docType;
    return [item as MediaType];
  });
}

export async function loadMediaFolders(db: PouchDB.Database): Promise<MediaFolder[]> {
  try {
    const doc = (await db.get(MEDIA_FOLDERS_ID)) as MediaFoldersDoc;
    return Array.isArray(doc.folders) ? doc.folders : [];
  } catch (error) {
    if (isPouchNotFound(error)) return [];
    throw error;
  }
}

export async function loadMediaLibrary(db: PouchDB.Database) {
  await requireMediaLibraryV2(db);
  const [list, folders] = await Promise.all([
    loadAllMediaItems(db),
    loadMediaFolders(db),
  ]);
  return normalizeMediaDoc({ list, folders });
}

export async function addMediaItem(db: PouchDB.Database, item: MediaType) {
  return updateMediaItem(db, item.id, item, () => true, true);
}

export async function updateMediaItem(
  db: PouchDB.Database,
  id: string,
  patch: Partial<MediaType>,
  canCommit: () => boolean = () => true,
  allowCreate = false,
): Promise<PouchDB.Core.Response | undefined> {
  const result = await updateMediaItemWithDocument(db, id, patch, canCommit, allowCreate);
  return result?.response;
}

async function updateMediaItemWithDocument(
  db: PouchDB.Database,
  id: string,
  patch: Partial<MediaType> | ((current: MediaItemDoc | undefined) => Partial<MediaType>),
  canCommit: () => boolean,
  allowCreate: boolean,
): Promise<{ response: PouchDB.Core.Response; doc?: MediaItemDoc } | undefined> {
  if (!canCommit()) return undefined;
  await requireMediaLibraryV2(db);
  const _id = mediaItemDocId(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let current: MediaItemDoc | undefined;
    try {
      current = (await db.get(_id)) as MediaItemDoc;
    } catch (error) {
      if (!isPouchNotFound(error)) throw error;
    }
    if (!canCommit()) return undefined;
    if (!current && !allowCreate) return undefined;
    const patchForCurrent = typeof patch === "function" ? patch(current) : patch;
    const doc = { ...current, ...patchForCurrent, _id, id, docType: "mediaItem" } as MediaItemDoc;
    for (const [key, value] of Object.entries(patchForCurrent)) {
      if (value === undefined) delete (doc as unknown as Record<string, unknown>)[key];
    }
    if (current) {
      const currentItem = { ...current } as Partial<MediaItemDoc>;
      const nextItem = { ...doc } as Partial<MediaItemDoc>;
      delete currentItem._id;
      delete currentItem._rev;
      delete currentItem.docType;
      delete nextItem._id;
      delete nextItem._rev;
      delete nextItem.docType;
      if (JSON.stringify(currentItem) === JSON.stringify(nextItem)) return undefined;
    }
    try {
      const response = await db.put(doc);
      return { response, doc };
    } catch (error) {
      if (!isPouchConflict(error) || attempt === 2) throw error;
    }
  }
  return undefined;
}

export async function removeMediaItem(
  db: PouchDB.Database,
  id: string,
  canCommit: () => boolean = () => true,
): Promise<PouchDB.Core.Response | undefined> {
  if (!canCommit()) return undefined;
  await requireMediaLibraryV2(db);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let doc: MediaItemDoc;
    try {
      doc = (await db.get(mediaItemDocId(id))) as MediaItemDoc;
    } catch (error) {
      if (isPouchNotFound(error)) return undefined;
      throw error;
    }
    if (!canCommit()) return undefined;
    try {
      return await db.remove(doc as MediaItemDoc & { _rev: string });
    } catch (error) {
      // Another controller may have tombstoned this item after our get().
      if (isPouchNotFound(error)) return undefined;
      if (!isPouchConflict(error) || attempt === 2) throw error;
    }
  }
  return undefined;
}

/** Read the persisted v2 revision used to prepare one destructive media operation. */
export async function readMediaItemForDeletion(
  db: PouchDB.Database,
  id: string,
): Promise<{ doc: MediaItemDoc; item: MediaType } | null> {
  await requireMediaLibraryV2(db);
  let doc: MediaItemDoc;
  try {
    doc = (await db.get(mediaItemDocId(id))) as MediaItemDoc;
  } catch (error) {
    if (isPouchNotFound(error)) return null;
    throw error;
  }
  if (doc.docType !== "mediaItem" || doc.id !== id) {
    throw new Error(`Invalid persisted media item document for ${id}.`);
  }
  const item = { ...doc } as Partial<MediaItemDoc>;
  delete item._id;
  delete item._rev;
  delete item.docType;
  return { doc, item: item as MediaType };
}

/** Tombstone only the exact revision whose references were prepared for cleanup. */
export async function removeMediaItemAtRevision(
  db: PouchDB.Database,
  doc: MediaItemDoc,
): Promise<PouchDB.Core.Response | undefined> {
  try {
    return await db.remove(doc as MediaItemDoc & { _rev: string });
  } catch (error) {
    if (isPouchNotFound(error)) return undefined;
    throw error;
  }
}

export async function saveMediaFolders(
  db: PouchDB.Database,
  folders: MediaFolder[],
  canCommit: () => boolean = () => true,
) {
  if (!canCommit()) return undefined;
  await requireMediaLibraryV2(db);
  let existing: Partial<MediaFoldersDoc> = {};
  try {
    existing = (await db.get(MEDIA_FOLDERS_ID)) as MediaFoldersDoc;
  } catch (error) {
    if (!isPouchNotFound(error)) throw error;
  }
  if (!canCommit()) return undefined;
  if (JSON.stringify(existing.folders ?? []) === JSON.stringify(folders)) return undefined;
  return db.put({ ...existing, _id: MEDIA_FOLDERS_ID, docType: "mediaFolders", folders: [...folders] });
}

type FolderParentReconciliation = {
  deletedFolderIds: ReadonlySet<string>;
  originalFolders: MediaFolder[];
};

/** Keep surviving folder parents valid after a deletion, using the deleted tree to find an ancestor. */
function reconcileFolderParentsAfterDeletion(
  folders: MediaFolder[],
  reconciliation: FolderParentReconciliation,
  latestPersistedFolders: MediaFolder[],
): MediaFolder[] {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const latestPersistedFoldersById = new Map(latestPersistedFolders.map((folder) => [folder.id, folder]));
  const originalFoldersById = new Map(reconciliation.originalFolders.map((folder) => [folder.id, folder]));
  const createsCycle = (folderId: string, parentId: string) => {
    const seen = new Set<string>();
    let currentId: string | null = parentId;
    while (currentId) {
      if (currentId === folderId || seen.has(currentId)) return true;
      seen.add(currentId);
      const current = foldersById.get(currentId);
      if (!current) return true;
      currentId = current.parentId;
    }
    return false;
  };
  const findSurvivingAncestor = (removedParentId: string, folderId: string) => {
    const seen = new Set<string>();
    let currentId: string | null = removedParentId;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const latest = latestPersistedFoldersById.get(currentId);
      const original = originalFoldersById.get(currentId);
      const latestParentId = latest?.parentId;
      const candidateId = latestParentId === null ? null : latestParentId || original?.parentId;
      if (!candidateId) return null;
      if (
        reconciliation.deletedFolderIds.has(candidateId) ||
        !foldersById.has(candidateId) ||
        createsCycle(folderId, candidateId)
      ) {
        currentId = candidateId;
        continue;
      }
      return candidateId;
    }
    return null;
  };

  let changed = false;
  const reconciled = folders.map((folder) => {
    const parentId = folder.parentId;
    if (parentId == null) return folder;
    if (!reconciliation.deletedFolderIds.has(parentId) && foldersById.has(parentId)) return folder;
    const nextParentId = findSurvivingAncestor(parentId, folder.id);
    if (nextParentId === parentId) return folder;
    changed = true;
    return { ...folder, parentId: nextParentId };
  });
  return changed ? reconciled : folders;
}

async function saveMediaFolderChanges(
  db: PouchDB.Database,
  before: MediaFolder[],
  after: MediaFolder[],
  canCommit: () => boolean,
  folderParentReconciliation?: FolderParentReconciliation,
) {
  if (!canCommit()) return undefined;
  await requireMediaLibraryV2(db);
  const beforeById = new Map(before.map((folder) => [folder.id, folder]));
  const afterById = new Map(after.map((folder) => [folder.id, folder]));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let existing: Partial<MediaFoldersDoc> = {};
    try {
      existing = (await db.get(MEDIA_FOLDERS_ID)) as MediaFoldersDoc;
    } catch (error) {
      if (!isPouchNotFound(error)) throw error;
    }
    if (!canCommit()) return undefined;
    const persistedFolders = existing.folders || [];
    const currentById = new Map(persistedFolders.map((folder) => [folder.id, folder]));
    for (const [id, folder] of afterById) {
      const previous = beforeById.get(id);
      if (!previous) {
        if (!currentById.has(id)) currentById.set(id, folder);
        continue;
      }
      const current = currentById.get(id);
      if (!current) continue;
      const merged = { ...current } as Record<string, unknown>;
      const keys = new Set([...Object.keys(previous), ...Object.keys(folder)] as (keyof MediaFolder)[]);
      for (const key of keys) {
        const beforeValue = previous[key];
        const afterValue = folder[key];
        if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
        const currentValue = current[key];
        if (JSON.stringify(currentValue) !== JSON.stringify(beforeValue)
          && JSON.stringify(currentValue) !== JSON.stringify(afterValue)) continue;
        if (afterValue === undefined) delete merged[key];
        else merged[key] = afterValue;
      }
      currentById.set(id, merged as unknown as MediaFolder);
    }
    for (const id of beforeById.keys()) {
      if (!afterById.has(id)) currentById.delete(id);
    }
    const mergedFolders = [...currentById.values()];
    const folders = folderParentReconciliation
      ? reconcileFolderParentsAfterDeletion(
          mergedFolders,
          folderParentReconciliation,
          persistedFolders,
        )
      : mergedFolders;
    if (JSON.stringify(existing.folders || []) === JSON.stringify(folders)) return undefined;
    try {
      const response = await db.put({
        ...existing,
        _id: MEDIA_FOLDERS_ID,
        docType: "mediaFolders",
        folders,
      });
      return { response, folders };
    } catch (error) {
      if (!isPouchConflict(error) || attempt === 2) throw error;
    }
  }
  return undefined;
}

/** Persist only rows changed between Redux snapshots using v2 item and folder documents. */
export async function persistMediaStateChanges(
  db: PouchDB.Database,
  before: { list: MediaType[]; folders: MediaFolder[] },
  after: { list: MediaType[]; folders: MediaFolder[] },
  canCommit: () => boolean = () => true,
  rowCommitGuards: {
    canCommitItem?: (id: string) => boolean;
    canCommitFolders?: () => boolean;
  } = {},
  folderParentReconciliation?: FolderParentReconciliation,
) {
  if (!canCommit()) return [];
  await requireMediaLibraryV2(db);
  const beforeById = new Map(before.list.map((item) => [item.id, item]));
  const afterById = new Map(after.list.map((item) => [item.id, item]));
  const changedDocs: unknown[] = [];
  for (const [id, item] of afterById) {
    const previous = beforeById.get(id);
    if (JSON.stringify(previous) !== JSON.stringify(item)) {
      if (!canCommit()) return changedDocs;
      const canCommitItem = () => canCommit() && (rowCommitGuards.canCommitItem?.(id) ?? true);
      if (!canCommitItem()) continue;
      const keys = new Set([...Object.keys(previous || {}), ...Object.keys(item)] as (keyof MediaType)[]);
      const patch = (currentDoc?: MediaItemDoc): Partial<MediaType> => {
        if (!previous) return currentDoc ? {} : item;
        const current = currentDoc as unknown as Partial<MediaType> | undefined;
        const changes: Partial<MediaType> = {};
        for (const key of keys) {
          const beforeValue = previous[key];
          const afterValue = item[key];
          if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
          const currentValue = current?.[key];
          if (JSON.stringify(currentValue) !== JSON.stringify(beforeValue)
            && JSON.stringify(currentValue) !== JSON.stringify(afterValue)) continue;
          (changes as Record<string, unknown>)[key] = afterValue;
        }
        return changes;
      };
      const result = await updateMediaItemWithDocument(
        db,
        id,
        patch,
        canCommitItem,
        !previous,
      );
      if (result) {
        const savedDoc = result.doc;
        if (savedDoc) {
          const replicatedDoc = { ...savedDoc };
          delete replicatedDoc._rev;
          changedDocs.push(replicatedDoc);
        } else {
          changedDocs.push({ ...item, id, _id: mediaItemDocId(id), docType: "mediaItem" });
        }
      }
    }
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) {
      if (!canCommit()) return changedDocs;
      const canCommitItem = () => canCommit() && (rowCommitGuards.canCommitItem?.(id) ?? true);
      if (!canCommitItem()) continue;
      const result = await removeMediaItem(db, id, canCommitItem);
      if (result) changedDocs.push({ _id: mediaItemDocId(id), id, _deleted: true });
    }
  }
  if (JSON.stringify(before.folders) !== JSON.stringify(after.folders)) {
    if (!canCommit()) return changedDocs;
    const canCommitFolders = () => canCommit() && (rowCommitGuards.canCommitFolders?.() ?? true);
    const result = canCommitFolders()
      ? await saveMediaFolderChanges(
          db,
          before.folders,
          after.folders,
          canCommitFolders,
          folderParentReconciliation,
        )
      : undefined;
    if (result) changedDocs.push({ _id: MEDIA_FOLDERS_ID, docType: "mediaFolders", folders: result.folders });
  }
  return changedDocs;
}

/** Reconcile an explicit list-shaped workflow without ever rewriting the v2 item set. */
export async function persistMediaLibrarySnapshot(
  db: PouchDB.Database,
  list: MediaType[],
  folders: MediaFolder[],
  getLatestState?: () => { list: MediaType[]; folders: MediaFolder[] },
  canCommit: () => boolean = () => true,
) {
  if (!canCommit()) return [];
  await requireMediaLibraryV2(db);
  const [existing, existingFolders] = await Promise.all([
    loadAllMediaItems(db),
    loadMediaFolders(db),
  ]);
  if (!canCommit()) return [];
  const latest = getLatestState?.() ?? { list, folders };
  return persistMediaStateChanges(db, { list: existing, folders: existingFolders }, latest, canCommit);
}

/** Apply an explicit local delta to the latest v2 snapshot, preserving rows that arrived after the UI snapshot. */
export async function persistMediaLibraryChanges(
  db: PouchDB.Database,
  before: { list: MediaType[]; folders: MediaFolder[] },
  after: { list: MediaType[]; folders: MediaFolder[] },
  canCommit: () => boolean = () => true,
) {
  if (!canCommit()) return [];
  const latest = await loadMediaLibrary(db);
  if (!canCommit()) return [];

  const list = new Map(latest.list.map((item) => [item.id, item]));
  const beforeItems = new Map(before.list.map((item) => [item.id, item]));
  const afterItems = new Map(after.list.map((item) => [item.id, item]));
  const beforeFolders = new Map(before.folders.map((folder) => [folder.id, folder]));
  const afterFolders = new Map(after.folders.map((folder) => [folder.id, folder]));
  const deletedFolderIds = new Set([...beforeFolders.keys()].filter((id) => !afterFolders.has(id)));
  for (const [id, item] of afterItems) {
    const previous = beforeItems.get(id);
    if (!previous) {
      const current = list.get(id);
      if (!current) list.set(id, item);
      else if (current.folderId && deletedFolderIds.has(current.folderId)) {
        const rehomed = { ...current };
        if (item.folderId) rehomed.folderId = item.folderId;
        else delete rehomed.folderId;
        list.set(id, rehomed);
      }
      continue;
    }
    const current = list.get(id);
    if (!current) continue;
    const merged = { ...current } as Record<string, unknown>;
    const keys = new Set([...Object.keys(previous), ...Object.keys(item)]);
    for (const key of keys) {
        const previousValue = previous[key as keyof MediaType];
        const nextValue = item[key as keyof MediaType];
        if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
          const currentValue = current[key as keyof MediaType];
          if (JSON.stringify(currentValue) !== JSON.stringify(previousValue)
            && JSON.stringify(currentValue) !== JSON.stringify(nextValue)) continue;
          if (nextValue === undefined) delete merged[key];
          else merged[key] = nextValue;
      }
    }
    list.set(id, merged as unknown as MediaType);
  }
  for (const id of beforeItems.keys()) {
    if (!afterItems.has(id)) list.delete(id);
  }

  const folders = new Map(latest.folders.map((folder) => [folder.id, folder]));
  for (const [id, folder] of afterFolders) {
    const previous = beforeFolders.get(id);
    if (!previous) {
      const current = folders.get(id);
      if (!current) folders.set(id, folder);
      continue;
    }
    const current = folders.get(id);
    if (!current) continue;
    const merged = { ...current } as Record<string, unknown>;
    const keys = new Set([...Object.keys(previous), ...Object.keys(folder)]);
    for (const key of keys) {
      const previousValue = previous[key as keyof MediaFolder];
      const nextValue = folder[key as keyof MediaFolder];
      if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
        const currentValue = current[key as keyof MediaFolder];
        if (JSON.stringify(currentValue) !== JSON.stringify(previousValue)
          && JSON.stringify(currentValue) !== JSON.stringify(nextValue)) continue;
        if (nextValue === undefined) delete merged[key];
        else merged[key] = nextValue;
      }
    }
    folders.set(id, merged as unknown as MediaFolder);
  }
  for (const id of beforeFolders.keys()) {
    if (!afterFolders.has(id)) folders.delete(id);
  }

  const folderParentReconciliation = {
    deletedFolderIds,
    originalFolders: before.folders,
  };
  const merged = normalizeMediaDoc({
    list: [...list.values()],
    folders: [...folders.values()],
  });
  return persistMediaStateChanges(
    db,
    latest,
    merged,
    canCommit,
    {},
    folderParentReconciliation,
  );
}

const MEDIA_MAX_FOLDER_DEPTH = 8;

type PouchDocumentError = {
  status?: number;
  name?: string;
};

const isPouchNotFound = (error: unknown) => {
  const pouchError = error as { status?: number | string; name?: string };
  return (
    pouchError?.status === 404 ||
    pouchError?.status === "404" ||
    pouchError?.name === "not_found"
  );
};

const isPouchConflict = (error: unknown) => {
  const pouchError = error as PouchDocumentError;
  return pouchError?.status === 409 || pouchError?.name === "conflict";
};

/** Normalize a media-library snapshot for Redux, keeping folder references valid. */
export function normalizeMediaDoc(
  doc: Pick<DBMedia, "list" | "folders"> | undefined,
): {
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
