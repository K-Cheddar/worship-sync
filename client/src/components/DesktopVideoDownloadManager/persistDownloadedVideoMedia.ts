import { addItemToMediaList, updateMediaItemFields } from "../../store/mediaSlice";
import type { AppDispatch, RootState } from "../../store/store";
import type { MediaType } from "../../types";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";
import { loadMediaLibrary, readMediaItemForDeletion } from "../../utils/mediaDocUtils";
import type { DesktopVideoDownloadOwner } from "./desktopVideoDownloadController";

const isSameDownloadedMedia = (existing: MediaType, incoming: MediaType) =>
  existing.localVideoFile?.id === incoming.localVideoFile?.id;

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
  if (existing) dispatch(updateMediaItemFields({ id: incoming.id, patch: nextItem }));
  else dispatch(addItemToMediaList(nextItem));
  const current = getState().media;
  const latestState = () => {
    if (!isOwnerCurrent(owner)) return persistedBefore;
    const latest = getState().media;
    return { list: latest.list, folders: latest.folders };
  };
  const flushed = await flushMediaLibraryDocToPouch(
    db,
    current.list,
    current.folders,
    latestState,
    persistedBefore,
    {
      canPersist: () => isOwnerCurrent(owner),
      publishIfCurrent: () => isOwnerCurrent(owner),
    },
  );
  if (!flushed.ok) throw flushed.error instanceof Error ? flushed.error : new Error("Media Library registration could not be saved.");
  const persisted = await readMediaItemForDeletion(db, incoming.id);
  if (!persisted || !isSameDownloadedMedia(persisted.item, incoming)) {
    throw new Error("Media Library registration could not be confirmed. Retry to finish importing the video.");
  }
  if (patch?.providerStorage?.assetId && persisted.item.providerStorage?.assetId !== patch.providerStorage.assetId) {
    throw new Error("The cloud video registration could not be confirmed. Retry to finish the upload.");
  }
};
