import { addItemToMediaList, removeItemFromMediaList, updateMediaItemFields } from "../../store/mediaSlice";
import type { AppDispatch, RootState } from "../../store/store";
import type { MediaType } from "../../types";
import type { MuxUploadResult } from "../../containers/Media/MediaUploadInput.types";
import { deleteMuxAsset } from "../../containers/Media/utils/muxUpload";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";
import { loadMediaLibrary, readMediaItemForDeletion } from "../../utils/mediaDocUtils";
import type { DesktopVideoDownloadOwner } from "./desktopVideoDownloadController";

const isSameDownloadedMedia = (existing: MediaType, incoming: MediaType) =>
  Boolean(incoming.localVideoFile?.id && existing.localVideoFile?.id === incoming.localVideoFile.id);

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const hasPatch = (item: MediaType, patch?: Partial<MediaType>) =>
  Object.entries(patch ?? {}).every(([key, value]) =>
    sameValue((item as unknown as Record<string, unknown>)[key], value),
  );

/** Merge only fields owned by this import, preserving edits made while Pouch is writing. */
const mergeOwnedFields = (
  baseline: MediaType | undefined,
  desired: MediaType,
  current: MediaType,
): Partial<MediaType> => {
  const changes: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(baseline ?? {}), ...Object.keys(desired)]);
  for (const key of keys) {
    const before = (baseline as unknown as Record<string, unknown> | undefined)?.[key];
    const saved = (desired as unknown as Record<string, unknown>)[key];
    const live = (current as unknown as Record<string, unknown>)[key];
    if (sameValue(before, saved)) continue;
    if (sameValue(live, before) || sameValue(live, saved)) changes[key] = saved;
  }
  return changes as Partial<MediaType>;
};

const publishPersistedItem = (
  item: MediaType,
  baseline: MediaType | undefined,
  incoming: MediaType,
  dispatch: AppDispatch,
  getState: () => RootState,
  isOwnerCurrent: (owner: DesktopVideoDownloadOwner) => boolean,
  owner: DesktopVideoDownloadOwner,
) => {
  if (!isOwnerCurrent(owner)) return;
  const current = getState().media.list.find((row) => row.id === item.id);
  if (!current) {
    dispatch(addItemToMediaList(item));
    return;
  }
  if (!isSameDownloadedMedia(current, incoming)) return;
  const changes = mergeOwnedFields(baseline, item, current);
  if (Object.keys(changes).length > 0) {
    dispatch(updateMediaItemFields({ id: item.id, patch: changes }));
  }
};

/** Persist a stable downloaded-video row through the Media Library's v2 store and write path. */
export const persistDownloadedVideoMedia = async ({
  incoming,
  owner,
  patch,
  dispatch,
  getState,
  isOwnerCurrent,
}: {
  incoming: MediaType;
  owner: DesktopVideoDownloadOwner;
  patch?: Partial<MediaType>;
  dispatch: AppDispatch;
  getState: () => RootState;
  isOwnerCurrent: (owner: DesktopVideoDownloadOwner) => boolean;
}) => {
  if (!isOwnerCurrent(owner)) throw new Error("The active church changed before the video could be saved.");
  const db = owner.dbAtStart as PouchDB.Database | undefined;
  if (!db) throw new Error("Media Library is not ready. Retry when this controller is connected.");
  const persistedBefore = await loadMediaLibrary(db);
  if (!isOwnerCurrent(owner)) throw new Error("The active church changed before the video could be saved.");
  const persistedExisting = persistedBefore.list.find((item) => item.id === incoming.id);
  if (persistedExisting && !isSameDownloadedMedia(persistedExisting, incoming)) {
    throw new Error("A different Media Library item already uses this downloaded video ID.");
  }
  const beforeState = getState().media;
  const existing = beforeState.list.find((item) => item.id === incoming.id);
  if (existing && !isSameDownloadedMedia(existing, incoming)) {
    throw new Error("A different Media Library item already uses this downloaded video ID.");
  }
  const nextItem: MediaType = { ...(existing ?? incoming), ...incoming, ...patch, id: incoming.id };
  const targetList = [...beforeState.list];
  const existingIndex = targetList.findIndex((item) => item.id === incoming.id);
  if (existingIndex >= 0) targetList[existingIndex] = nextItem;
  else targetList.push(nextItem);
  const latestState = () => {
    if (!isOwnerCurrent(owner)) return persistedBefore;
    const latest = getState().media;
    const list = [...latest.list];
    const index = list.findIndex((item) => item.id === incoming.id);
    if (index < 0) list.push(nextItem);
    else if (isSameDownloadedMedia(list[index], incoming)) {
      list[index] = { ...list[index], ...mergeOwnedFields(existing, nextItem, list[index]) };
    }
    return { list, folders: latest.folders };
  };
  let failure: unknown;
  try {
    const flushed = await flushMediaLibraryDocToPouch(
      db,
      targetList,
      beforeState.folders,
      latestState,
      persistedBefore,
      {
        canPersist: () => isOwnerCurrent(owner),
        publishIfCurrent: () => isOwnerCurrent(owner),
      },
    );
    if (!flushed.ok) throw flushed.error instanceof Error ? flushed.error : new Error("Media Library registration could not be saved.");
    const persisted = await readMediaItemForDeletion(db, incoming.id);
    if (!persisted || !isSameDownloadedMedia(persisted.item, incoming) || !hasPatch(persisted.item, patch)) {
      throw new Error(patch?.providerStorage?.assetId
        ? "The cloud video registration could not be confirmed. Retry to finish the upload."
        : "Media Library registration could not be confirmed. Retry to finish importing the video.");
    }
    publishPersistedItem(persisted.item, existing, incoming, dispatch, getState, isOwnerCurrent, owner);
    return;
  } catch (error) {
    failure = error;
  }

  // A rejected write/confirmation can still have committed. Trust only a fresh
  // read of the captured database; this also handles a lost write acknowledgement.
  let authoritative: Awaited<ReturnType<typeof readMediaItemForDeletion>>;
  try {
    authoritative = await readMediaItemForDeletion(db, incoming.id);
  } catch (reconcileError) {
    throw new Error(`${failure instanceof Error ? failure.message : "Media Library registration failed."} The saved state could not be checked: ${reconcileError instanceof Error ? reconcileError.message : "database read failed."}`);
  }
  if (authoritative && isSameDownloadedMedia(authoritative.item, incoming)) {
    publishPersistedItem(authoritative.item, existing, incoming, dispatch, getState, isOwnerCurrent, owner);
    if (hasPatch(authoritative.item, patch)) return;
    throw failure instanceof Error
      ? failure
      : new Error("The Media Library item exists, but its cloud registration still needs to be retried.");
  }

  if (!authoritative && !persistedExisting && existing && isSameDownloadedMedia(existing, incoming)) {
    const latest = getState().media.list.find((item) => item.id === incoming.id);
    if (latest && sameValue(latest, existing)) dispatch(removeItemFromMediaList(incoming.id));
  }
  if (authoritative && !isSameDownloadedMedia(authoritative.item, incoming)) {
    throw new Error("A different Media Library item already uses this downloaded video ID.");
  }
  throw failure instanceof Error ? failure : new Error("Media Library registration failed.");
};

/**
 * Delete an imported permanent asset only after the captured Media Library has
 * been read successfully and confirms that no item references it. A failed or
 * uncertain registration can already have committed its Pouch write, so an
 * unreadable database or ambiguous reference must preserve the file.
 */
export const removeDownloadedVideoAssetIfUnreferenced = async ({
  media,
  assetId,
  owner,
  deleteAsset,
  getInMemoryMediaItem,
  isOwnerCurrent,
}: {
  media: MediaType | undefined;
  assetId: string | undefined;
  owner: DesktopVideoDownloadOwner;
  deleteAsset: (assetId: string) => Promise<unknown>;
  getInMemoryMediaItem?: (assetId: string) => MediaType | undefined;
  isOwnerCurrent: (owner: DesktopVideoDownloadOwner) => boolean;
}): Promise<MediaType | undefined> => {
  if (!assetId) return undefined;
  const db = owner.dbAtStart as PouchDB.Database | undefined;
  if (!db) throw new Error("Cannot verify Media Library references; the local video was kept.");
  if (!isOwnerCurrent(owner)) {
    throw new Error("The active church changed; the local video was kept until its Media Library reference can be checked.");
  }

  const { list } = await loadMediaLibrary(db);
  if (!isOwnerCurrent(owner)) {
    throw new Error("The active church changed; the local video was kept until its Media Library reference can be checked.");
  }
  const references = list.filter((item) => item.localVideoFile?.id === assetId);
  const matchingItem = references.find((item) => item.id === media?.id);
  if (matchingItem) return matchingItem;
  if (references.length > 0) {
    return references[0];
  }

  if (getInMemoryMediaItem?.(assetId)?.localVideoFile?.id === assetId) {
    throw new Error("The Media Library has an unsaved reference to this local video; retry registration before cleanup.");
  }

  await deleteAsset(assetId);
  return undefined;
};

/** Delete a successful Mux asset only after the captured Media Library confirms it is unreferenced. */
export const removeDownloadedVideoMuxAssetIfUnreferenced = async ({
  result,
  owner,
  deleteAsset = deleteMuxAsset,
  getInMemoryMediaItems,
  isOwnerCurrent,
}: {
  result: MuxUploadResult;
  owner: DesktopVideoDownloadOwner;
  deleteAsset?: (assetId: string, churchId: string) => Promise<unknown>;
  getInMemoryMediaItems?: () => MediaType[];
  isOwnerCurrent: (owner: DesktopVideoDownloadOwner) => boolean;
}): Promise<MediaType | undefined> => {
  const db = owner.dbAtStart as PouchDB.Database | undefined;
  if (!db) throw new Error("Cannot verify Media Library references; the Mux video was kept.");
  if (!isOwnerCurrent(owner)) {
    throw new Error("The active church changed; the Mux video was kept until its Media Library reference can be checked.");
  }
  const { list } = await loadMediaLibrary(db);
  if (!isOwnerCurrent(owner)) {
    throw new Error("The active church changed; the Mux video was kept until its Media Library reference can be checked.");
  }
  const registered = list.find((item) =>
    (item.providerStorage?.provider === "mux" && item.providerStorage.assetId === result.assetId) ||
    item.muxAssetId === result.assetId,
  );
  if (registered) return registered;
  if (getInMemoryMediaItems?.().some((item) =>
    (item.providerStorage?.provider === "mux" && item.providerStorage.assetId === result.assetId) ||
    item.muxAssetId === result.assetId,
  )) {
    throw new Error("The Media Library has an unsaved reference to this Mux video; retry registration before cleanup.");
  }
  await deleteAsset(result.assetId, owner.churchId);
  return undefined;
};
