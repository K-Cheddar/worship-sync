/**
 * Wraps the outline bridge with the live PouchDB/Redux plumbing it needs
 * (ControllerInfoContext's db, the currently-selected item list). Intended for
 * the presentation Controller's opt-in "apply plan to item list" flow — not
 * the Teams plan editor, which only autosaves the Firestore ServicePlan.
 * Persisting the returned updatedSections back to the ServicePlan
 * (via saveServicePlan) is left to the caller, which already owns that flow.
 */
import { useCallback, useContext } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { updateItemList } from "../../store/itemListSlice";
import {
  buildServicePlanOutlineItems,
  type ServicePlanOutlinePushResult,
} from "./servicePlanOutlineBridge";
import type { ServicePlan } from "../../types/servicePlan";

export const useServicePlanOutlinePush = () => {
  const { db, bibleDb } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const currentList = useSelector(
    (state) => state.undoable.present.itemList.list,
  );
  const selectedList = useSelector(
    (state) => state.undoable.present.itemLists.selectedList,
  );

  const pushPlanToOutline = useCallback(
    async (plan: ServicePlan): Promise<ServicePlanOutlinePushResult> => {
      if (!selectedList) {
        throw new Error("Open or create an item list in the Controller first.");
      }
      const result = await buildServicePlanOutlineItems({
        plan,
        currentList,
        db,
        bibleDb,
      });
      if (result.items.length > 0) {
        dispatch(updateItemList([...currentList, ...result.items]));
      }
      return result;
    },
    [currentList, db, bibleDb, dispatch, selectedList],
  );

  return { pushPlanToOutline, selectedListName: selectedList?.name };
};
