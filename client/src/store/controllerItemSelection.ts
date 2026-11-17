import type PouchDB from "pouchdb-browser";
import type { AppDispatch, RootState } from "./store";
import type { DBItem, ItemState, ServiceItem } from "../types";
import { selectItemDocuments } from "./itemLibrarySelectors";
import { bufferSongV2RevisionConflict, setActiveItem, setActiveItemOccurrence, setItemIsLoading, setSelectedSlide } from "./itemSlice";
import { setActiveItemInList } from "./itemListSlice";
import { prepareItemForEditor } from "../utils/outlineSlideSections";
import { normalizeItemSlides } from "../utils/activeItemSlides";
import { readCurrentItemDocuments } from "../utils/readCurrentItemDocuments";
import { SERVICE_TIME_COUNTDOWN_ID } from "../constants/nextServiceTimer";
import { buildServiceTimeItem } from "../utils/itemUtil";
import { applyPouchAudit } from "../utils/pouchAudit";
import { getActiveContentDatabaseOwner, getContentDatabaseForOwner } from "./deferredItemMutations";
import { applyItemDocumentChange } from "./allDocsSlice";
import {
  loadItemWithSongHydration,
  loadSongV2Snapshot,
} from "../utils/songPersistence";
import {
  loadReconciledSongV2Snapshot,
  SongV2ReplicationConflictError,
} from "../utils/songV2ReplicationConflicts";
import { SongV2MutationNotAuthorizedError } from "../utils/songV2Writer";
import { globalFireDbInfo } from "../context/globalInfo";
import { getContentDatabaseSessionToken } from "../utils/contentReplicationActivity";

// Request ownership is per store, never shared between independent controllers.
const selections = new WeakMap<() => RootState, object>();

export const selectControllerItem = (
  target: Pick<ServiceItem, "_id" | "listId"> & Partial<Pick<ServiceItem, "type">>,
  db?: PouchDB.Database,
  selectedSlide?: number,
) => (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
  const request = {};
  selections.set(getState, request);
  const session = getState().allDocs.session;
  const contentOwner = getActiveContentDatabaseOwner();
  const churchId = globalFireDbInfo.churchId;
  const sessionToken = db ? getContentDatabaseSessionToken(db.name) : null;
  const isOriginalOwnerCurrent = () =>
    getState().allDocs.session === session &&
    getActiveContentDatabaseOwner() === contentOwner &&
    globalFireDbInfo.churchId === churchId &&
    (!db || getContentDatabaseSessionToken(db.name) === sessionToken) &&
    (contentOwner
      ? getContentDatabaseForOwner(contentOwner) === db
      : !getActiveContentDatabaseOwner());
  const isCurrent = () => selections.get(getState) === request &&
    isOriginalOwnerCurrent() &&
    getState().undoable.present.itemList.selectedItemListId === target.listId;
  const activate = (doc: DBItem) => {
    // Preserve the middleware that flushes editors and restores pending autosaves.
    dispatch(setActiveItem({
      ...prepareItemForEditor(doc, target.listId),
      ...(contentOwner ? { contentOwner } : {}),
      ...(selectedSlide == null ? {} : { selectedSlide }),
    }));
  };
  const activateLoadedSong = (doc: DBItem, conflicts: NonNullable<ItemState["pendingSongV2Conflicts"]> = []) => {
    // V2 snapshots are structurally hydrated for conflict inspection. Restore
    // client-derived monitor sizing before the editor/display model is cached.
    const normalizedDoc = normalizeItemSlides(doc);
    const occurrence = { ...normalizedDoc, listId: target.listId };
    dispatch(applyItemDocumentChange({ id: normalizedDoc._id, doc: normalizedDoc }));
    activate(occurrence);
    if (conflicts.length) {
      dispatch(bufferSongV2RevisionConflict({ item: occurrence, conflicts }));
    }
  };
  const loadAndActivateSong = async () => {
    if (!db) return false;
    let loaded: DBItem | undefined;
    let conflicts: NonNullable<ItemState["pendingSongV2Conflicts"]> = [];
    try {
      const snapshot = await loadSongV2Snapshot(db, target._id, true);
      loaded = snapshot.hydrated;
      conflicts = snapshot.conflicts ?? [];
      if (conflicts.length && globalFireDbInfo.canWriteSongContent) {
        // A later selection suppresses activation, not an already durable merge.
        let hasCommittedWrite = false;
        const mutationGuard = Object.assign(
          () => globalFireDbInfo.canWriteSongContent === true &&
            isOriginalOwnerCurrent() &&
            (hasCommittedWrite || isCurrent()),
          { onWriteCommitted: () => { hasCommittedWrite = true; } },
        );
        try {
          const reconciled = await loadReconciledSongV2Snapshot(
            db,
            target._id,
            snapshot,
            mutationGuard,
          );
          loaded = reconciled.hydrated;
          conflicts = reconciled.conflicts ?? [];
        } catch (error) {
          if (error instanceof SongV2ReplicationConflictError) {
            loaded = error.snapshot.hydrated;
            conflicts = error.snapshot.conflicts ?? [];
          } else if (error instanceof SongV2MutationNotAuthorizedError) {
            const latest = await loadSongV2Snapshot(db, target._id, true);
            loaded = latest.hydrated;
            conflicts = latest.conflicts ?? [];
          } else throw error;
        }
      }
    } catch (error) {
      if (error instanceof SongV2ReplicationConflictError) {
        loaded = error.snapshot.hydrated;
        conflicts = error.snapshot.conflicts ?? [];
      } else if ((error as { status?: number })?.status === 404) {
        loaded = await loadItemWithSongHydration(db, target._id);
      } else throw error;
    }
    if (!isCurrent() || !loaded) return false;
    activateLoadedSong(loaded, conflicts);
    return true;
  };
  dispatch(setActiveItemInList(target.listId));
  const active = getState().undoable.present.item;
  if (active._id === target._id && active.type) {
    if (active.listId !== target.listId) {
      dispatch(setActiveItemOccurrence(target.listId));
      dispatch(setSelectedSlide(selectedSlide ?? 0));
    } else if (selectedSlide != null) dispatch(setSelectedSlide(selectedSlide));
    dispatch(setItemIsLoading(false));
    return Promise.resolve();
  }
  const cached = selectItemDocuments(getState()).find((doc) => doc._id === target._id);
  if (cached && cached.type !== "heading") {
    if (cached.type === "song" && cached.docType === "song-v2-root" && db) {
      dispatch(setItemIsLoading(true));
      return (async () => {
        try {
          await loadAndActivateSong();
        } catch (error) {
          if (isCurrent()) console.error(error);
        } finally {
          if (isCurrent()) dispatch(setItemIsLoading(false));
        }
      })();
    }
    activate(cached);
    return Promise.resolve();
  }
  if (!db) return Promise.resolve();
  const activateServiceTime = () => {
    const doc = buildServiceTimeItem() as DBItem;
    dispatch(applyItemDocumentChange({ id: doc._id, doc }));
    activate(doc);
    // The captured database owns this write even if the operator moves on.
    void db.put(applyPouchAudit(null, doc, { isNew: true })).catch((error: { status?: number }) => {
      if (error.status !== 409) console.error(error);
    });
  };
  dispatch(setItemIsLoading(true));
  return (async () => {
    try {
      const documents = await readCurrentItemDocuments(db, [target._id]);
      if (!isCurrent()) return;
      const doc = selectItemDocuments(getState()).find((item) => item._id === target._id) ?? documents.get(target._id);
      if (!doc && target._id === SERVICE_TIME_COUNTDOWN_ID) {
        activateServiceTime();
        return;
      }
      if (doc && doc.type !== "heading") {
        if (doc.type === "song") {
          await loadAndActivateSong();
        } else {
          dispatch(applyItemDocumentChange({ id: doc._id, doc }));
          activate(doc as DBItem);
        }
      } else if (target.type === "song") {
        // A migrated song may only have song-v2:* physical documents, which do
        // not pass the regular item-document cache filter.
        const activated = await loadAndActivateSong();
        if (!activated && isCurrent()) dispatch(setActiveItem({ ...target, type: "", name: "" }));
      } else dispatch(setActiveItem({ ...target, type: "", name: "" }));
    } catch (error) {
      if (isCurrent()) {
        if (target._id === SERVICE_TIME_COUNTDOWN_ID) { activateServiceTime(); return; }
        console.error(error);
        dispatch(setActiveItem({ ...target, type: "", name: "" }));
      }
    } finally {
      if (isCurrent()) dispatch(setItemIsLoading(false));
    }
  })();
};
