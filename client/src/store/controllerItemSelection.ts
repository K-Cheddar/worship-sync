import type PouchDB from "pouchdb-browser";
import type { AppDispatch, RootState } from "./store";
import type { DBItem, ItemState, ServiceItem } from "../types";
import { selectItemDocuments } from "./itemLibrarySelectors";
import { bufferSongV2RevisionConflict, setActiveItem, setActiveItemOccurrence, setItemIsLoading, setSelectedSlide } from "./itemSlice";
import { setActiveItemInList } from "./itemListSlice";
import { prepareItemForEditor } from "../utils/outlineSlideSections";
import { readCurrentItemDocuments } from "../utils/readCurrentItemDocuments";
import { SERVICE_TIME_COUNTDOWN_ID } from "../constants/nextServiceTimer";
import { buildServiceTimeItem } from "../utils/itemUtil";
import { applyPouchAudit } from "../utils/pouchAudit";
import { getActiveContentDatabaseOwner } from "./deferredItemMutations";
import { applyItemDocumentChange } from "./allDocsSlice";
import { loadItemWithSongHydration } from "../utils/songPersistence";
import { SongV2ReplicationConflictError } from "../utils/songV2ReplicationConflicts";

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
  const isCurrent = () => selections.get(getState) === request &&
    getState().allDocs.session === session &&
    getActiveContentDatabaseOwner() === contentOwner &&
    getState().undoable.present.itemList.selectedItemListId === target.listId;
  const activate = (doc: DBItem) => {
    // Preserve the middleware that flushes editors and restores pending autosaves.
    dispatch(setActiveItem({
      ...prepareItemForEditor(doc, target.listId),
      ...(selectedSlide == null ? {} : { selectedSlide }),
    }));
  };
  const activateLoadedSong = (doc: DBItem, conflicts: NonNullable<ItemState["pendingSongV2Conflicts"]> = []) => {
    const occurrence = { ...doc, listId: target.listId };
    dispatch(applyItemDocumentChange({ id: doc._id, doc }));
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
      loaded = await loadItemWithSongHydration(db, target._id);
    } catch (error) {
      if (!(error instanceof SongV2ReplicationConflictError)) throw error;
      loaded = error.snapshot.hydrated;
      conflicts = error.snapshot.conflicts ?? [];
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
        if (doc.type === "song" && doc.docType === "song-v2-root") {
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
