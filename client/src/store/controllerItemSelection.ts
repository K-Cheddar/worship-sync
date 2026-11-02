import type PouchDB from "pouchdb-browser";
import type { AppDispatch, RootState } from "./store";
import type { DBItem, ServiceItem } from "../types";
import { selectItemDocuments } from "./itemLibrarySelectors";
import { setActiveItem, setActiveItemOccurrence, setItemIsLoading, setSelectedSlide } from "./itemSlice";
import { setActiveItemInList } from "./itemListSlice";
import { prepareItemForEditor } from "../utils/outlineSlideSections";
import { readCurrentItemDocuments } from "../utils/readCurrentItemDocuments";
import { SERVICE_TIME_COUNTDOWN_ID } from "../constants/nextServiceTimer";
import { buildServiceTimeItem } from "../utils/itemUtil";
import { applyPouchAudit } from "../utils/pouchAudit";
import { getActiveContentDatabaseOwner } from "./deferredItemMutations";
import { applyItemDocumentChange } from "./allDocsSlice";

// Request ownership is per store, never shared between independent controllers.
const selections = new WeakMap<() => RootState, object>();

export const selectControllerItem = (
  target: Pick<ServiceItem, "_id" | "listId">,
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
        dispatch(applyItemDocumentChange({ id: doc._id, doc }));
        activate(doc as DBItem);
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
