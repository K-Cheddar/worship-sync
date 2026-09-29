/**
 * Wraps the outline bridge with the live PouchDB/Redux plumbing it needs
 * (ControllerInfoContext's db, the currently-selected item list). Intended for
 * the presentation Controller's opt-in "apply plan to item list" flow — not
 * the Teams plan editor, which only autosaves the Firestore ServicePlan.
 * Persisting the returned updatedSections back to the ServicePlan
 * (via saveServicePlan) is left to the caller, which already owns that flow.
 */
import { useCallback, useContext, useRef } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { updateItemList } from "../../store/itemListSlice";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import {
  buildServicePlanOutlineItems,
  type ServicePlanOutlinePushResult,
} from "./servicePlanOutlineBridge";
import { useServicePlanSongLibrary } from "./useServicePlanSongLibrary";
import type { ServicePlan } from "../../types/servicePlan";

export const useServicePlanOutlinePush = () => {
  const { db, bibleDb } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const { songs } = useServicePlanSongLibrary();
  const customDocuments = useSelector((state) => state.allDocs.allFreeFormDocs);
  const currentList = useSelector(
    (state) => state.undoable.present.itemList.list,
  );
  const selectedList = useSelector(
    (state) => state.undoable.present.itemLists.selectedList,
  );
  const contextRef = useRef({ currentList, selectedList, db, bibleDb, songs, customDocuments });
  contextRef.current = { currentList, selectedList, db, bibleDb, songs, customDocuments };

  const pushPlanToOutline = useCallback(
    async (
      plan: ServicePlan,
      isSourcePlanCurrent: () => boolean = () => true,
    ): Promise<ServicePlanOutlinePushResult> => {
      if (!selectedList) {
        throw new Error("Open or create an item list in the Controller first.");
      }
      const startingContext = contextRef.current;
      const isContextCurrent = () =>
        isSourcePlanCurrent()
        &&
        contextRef.current.selectedList?._id === startingContext.selectedList?._id
        && contextRef.current.currentList === startingContext.currentList
        && contextRef.current.db === startingContext.db
        && contextRef.current.bibleDb === startingContext.bibleDb
        && contextRef.current.songs === startingContext.songs
        && contextRef.current.customDocuments === startingContext.customDocuments;
      const result = await buildServicePlanOutlineItems({
        plan,
        currentList,
        db,
        bibleDb,
        songs,
        customDocuments,
        isContextCurrent,
      });
      if (!isContextCurrent()) {
        throw new Error("The selected outline changed before the service plan could be imported.");
      }
      const existingCustomDocumentIds = new Set(
        customDocuments.map((document) => document._id),
      );
      if (result.items.length > 0) {
        dispatch(updateItemList([...currentList, ...result.items]));
        for (const item of result.items) {
          if (
            db &&
            (item.type === "bible" ||
              (item.type === "free" && !existingCustomDocumentIds.has(item._id)))
          ) {
            dispatch(upsertItemInAllItemsList({ ...item, listId: "" }));
          }
        }
      }
      return result;
    },
    [currentList, db, bibleDb, customDocuments, dispatch, selectedList, songs],
  );

  return { pushPlanToOutline, selectedListName: selectedList?.name };
};
