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
  | { kind: "legacy"; list: MediaType[]; folders: MediaFolder[] }
  | { kind: "item-upsert"; item: Pick<MediaType, "id"> & Partial<MediaType> }
  | { kind: "item-delete"; id: string }
  | { kind: "folders"; folders: MediaFolder[] };

export const mediaItemDocId = (id: string) => `${MEDIA_ITEM_PREFIX}${id}`;

export function parseMediaReplicationDoc(value: unknown): MediaReplicationChange | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Record<string, unknown>;
  if (doc._id === "media" && Array.isArray(doc.list)) {
    const normalized = normalizeMediaDoc(doc as unknown as DBMedia);
    return { kind: "legacy", ...normalized };
  }
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
    return meta.schemaVersion >= MEDIA_LIBRARY_SCHEMA_VERSION;
  } catch (error) {
    if (isPouchNotFound(error)) return false;
    throw error;
  }
};

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
  if (await isMediaLibraryV2(db)) {
    const [list, folders] = await Promise.all([
      loadAllMediaItems(db),
      loadMediaFolders(db),
    ]);
    return normalizeMediaDoc({ _id: "media", _rev: "", list, folders });
  }
  return normalizeMediaDoc(await loadOrCreateMediaDoc(db));
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
  if (!(await isMediaLibraryV2(db))) {
    return updateLegacyMediaItem(db, id, patch, canCommit);
  }
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
    const doc = { ...current, ...patch, _id, id, docType: "mediaItem" } as MediaItemDoc;
    for (const [key, value] of Object.entries(patch)) {
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
      return await db.put(doc);
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
  if (!(await isMediaLibraryV2(db))) {
    const doc = await loadOrCreateMediaDoc(db);
    if (await isMediaLibraryV2(db)) return removeMediaItem(db, id, canCommit);
    if (!canCommit()) return undefined;
    doc.list = doc.list.filter((item) => item.id !== id);
    doc.updatedAt = new Date().toISOString();
    return db.put(doc);
  }
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
      if (!isPouchConflict(error) || attempt === 2) throw error;
    }
  }
  return undefined;
}

export async function saveMediaFolders(
  db: PouchDB.Database,
  folders: MediaFolder[],
  canCommit: () => boolean = () => true,
) {
  if (!(await isMediaLibraryV2(db))) {
    const doc = await loadOrCreateMediaDoc(db);
    if (await isMediaLibraryV2(db)) return saveMediaFolders(db, folders, canCommit);
    if (!canCommit()) return undefined;
    doc.folders = [...folders];
    doc.updatedAt = new Date().toISOString();
    return db.put(doc);
  }
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

/** Persist only rows changed between Redux snapshots. Legacy databases keep the old format until v2 is activated. */
export async function persistMediaStateChanges(
  db: PouchDB.Database,
  before: { list: MediaType[]; folders: MediaFolder[] },
  after: { list: MediaType[]; folders: MediaFolder[] },
  canCommit: () => boolean = () => true,
) {
  if (!canCommit()) return [];
  if (!(await isMediaLibraryV2(db))) {
    const current = await loadOrCreateMediaDoc(db);
    if (await isMediaLibraryV2(db)) {
      return persistMediaStateChanges(db, before, after, canCommit);
    }
    if (!canCommit()) return [];
    current.list = [...after.list];
    current.folders = [...after.folders];
    current.updatedAt = new Date().toISOString();
    await db.put(current);
    return [current];
  }
  const beforeById = new Map(before.list.map((item) => [item.id, item]));
  const afterById = new Map(after.list.map((item) => [item.id, item]));
  const changedDocs: unknown[] = [];
  for (const [id, item] of afterById) {
    const previous = beforeById.get(id);
    if (JSON.stringify(previous) !== JSON.stringify(item)) {
      if (!canCommit()) return changedDocs;
      const patch: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(previous || {}), ...Object.keys(item)] as (keyof MediaType)[]);
      for (const key of keys) {
        if (JSON.stringify(previous?.[key]) !== JSON.stringify(item[key])) {
          patch[key] = item[key];
        }
      }
      const result = await updateMediaItem(db, id, patch as Partial<MediaType>, canCommit, !previous);
      if (result) {
        changedDocs.push({ ...patch, id, _id: mediaItemDocId(id), docType: "mediaItem" });
      }
    }
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) {
      if (!canCommit()) return changedDocs;
      const result = await removeMediaItem(db, id, canCommit);
      if (result) changedDocs.push({ _id: mediaItemDocId(id), id, _deleted: true });
    }
  }
  if (JSON.stringify(before.folders) !== JSON.stringify(after.folders)) {
    if (!canCommit()) return changedDocs;
    const result = await saveMediaFolders(db, after.folders, canCommit);
    if (result) changedDocs.push({ _id: MEDIA_FOLDERS_ID, docType: "mediaFolders", folders: after.folders });
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
  if (!(await isMediaLibraryV2(db))) {
    const current = await loadOrCreateMediaDoc(db);
    const latest = getLatestState?.() ?? { list, folders };
    if (!canCommit()) return [];
    if (await isMediaLibraryV2(db)) {
      return persistMediaLibrarySnapshot(db, latest.list, latest.folders, getLatestState, canCommit);
    }
    current.list = [...latest.list];
    current.folders = [...latest.folders];
    current.updatedAt = new Date().toISOString();
    await db.put(current);
    return [current];
  }
  const [existing, existingFolders] = await Promise.all([
    loadAllMediaItems(db),
    loadMediaFolders(db),
  ]);
  if (!canCommit()) return [];
  const latest = getLatestState?.() ?? { list, folders };
  return persistMediaStateChanges(db, { list: existing, folders: existingFolders }, latest, canCommit);
}

async function updateLegacyMediaItem(
  db: PouchDB.Database,
  id: string,
  patch: Partial<MediaType>,
  canCommit: () => boolean,
): Promise<PouchDB.Core.Response | undefined> {
  const doc = await loadOrCreateMediaDoc(db);
  if (await isMediaLibraryV2(db)) return updateMediaItem(db, id, patch, canCommit);
  if (!canCommit()) return undefined;
  const index = doc.list.findIndex((item) => item.id === id);
  if (index < 0) doc.list.push({ ...patch, id } as MediaType);
  else doc.list[index] = { ...doc.list[index], ...patch, id };
  doc.updatedAt = new Date().toISOString();
  return db.put(doc);
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

/** Load the media document, creating an authoritative empty document only on a confirmed 404. */
export async function loadOrCreateMediaDoc(
  db: PouchDB.Database,
): Promise<DBMedia> {
  try {
    return (await db.get("media")) as DBMedia;
  } catch (error) {
    if (!isPouchNotFound(error)) throw error;
  }

  const now = new Date().toISOString();
  const emptyMediaDoc = {
    _id: "media",
    list: [],
    folders: [],
    createdAt: now,
    updatedAt: now,
    docType: "media",
  } satisfies Omit<DBMedia, "_rev">;

  try {
    await db.put(emptyMediaDoc);
  } catch (error) {
    // Replication or another tab may have created the document after our 404.
    if (!isPouchConflict(error)) throw error;
  }

  return (await db.get("media")) as DBMedia;
}

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
