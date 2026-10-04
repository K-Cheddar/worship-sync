/**
 * Wraps the outline bridge with the live PouchDB/Redux plumbing it needs
 * (ControllerInfoContext's db, the currently-selected item list). Intended for
 * the presentation Controller's opt-in "apply plan to item list" flow — not
 * the Teams plan editor, which only autosaves the Firestore ServicePlan.
 * Native pushes do not write outline state back into the saved plan.
 */
import { useCallback, useContext, useRef } from "react";
import { useStore } from "react-redux";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useDispatch, useSelector } from "../../hooks";
import { updateItemList } from "../../store/itemListSlice";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import {
  buildServicePlanOutlineItem,
  insertServicePlanOutlineItem,
  planServicePlanOutlineItems,
  type ServicePlanOutlinePushResult,
} from "./servicePlanOutlineBridge";
import { useServicePlanSongLibrary } from "./useServicePlanSongLibrary";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServiceItem } from "../../types";
import type { RootState } from "../../store/store";

const OUTLINE_STEP_DELAY_MS = 300;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useServicePlanOutlinePush = () => {
  const { db, bibleDb } = useContext(ControllerInfoContext) || {};
  const globalInfo = useContext(GlobalInfoContext);
  const sectionRules = globalInfo?.churchIntegrations?.servicePlanning?.sectionRules;
  const dispatch = useDispatch();
  const store = useStore<RootState>();
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
      onItemAdded?: (item: ServiceItem) => Promise<void> | void,
      shouldContinue: () => boolean = () => true,
    ): Promise<ServicePlanOutlinePushResult> => {
      if (!selectedList) {
        throw new Error("Open or create an item list in the Controller first.");
      }
      const startingContext = contextRef.current;
      // One run uses one mapping configuration even if integrations refresh
      // while the operator is watching the visible per-item progress.
      const sectionRulesSnapshot = (sectionRules ?? []).map((rule) => ({ ...rule }));
      const isContextCurrent = () =>
        isSourcePlanCurrent()
        &&
        contextRef.current.selectedList?._id === startingContext.selectedList?._id
        && contextRef.current.db === startingContext.db
        && contextRef.current.bibleDb === startingContext.bibleDb
        && contextRef.current.songs === startingContext.songs
        && contextRef.current.customDocuments === startingContext.customDocuments;
      const planResult = planServicePlanOutlineItems({
        plan,
        currentList,
        songs,
        customDocuments,
        sectionRules: sectionRulesSnapshot,
      });
      if (!isContextCurrent()) {
        throw new Error("The selected outline changed before the service plan could be imported.");
      }
      const items: ServiceItem[] = [];
      const placementIssues = [...planResult.placementIssues];
      const recordPlacementIssue = (issue: (typeof placementIssues)[number]) => {
        if (!placementIssues.some((existing) =>
          existing.sectionName === issue.sectionName &&
          existing.headingName === issue.headingName &&
          existing.reason === issue.reason,
        )) {
          placementIssues.push(issue);
        }
      };
      for (const step of planResult.steps) {
        if (!shouldContinue()) break;
        if (!isContextCurrent()) {
          throw new Error("The selected outline changed before the service plan could be imported.");
        }
        let latestList = store.getState().undoable.present.itemList.list;
        if (latestList.some((existing) => existing.listId === step.planned.listId)) continue;
        if (!latestList.some((existing) => existing.type === "heading" && existing.listId === step.targetHeading.listId)) {
          recordPlacementIssue({
            sectionName: step.sectionName,
            headingName: step.targetHeading.name,
            reason: "heading-removed",
          });
          continue;
        }
        // Build only the item that is about to be shown. In particular, a stop
        // request must not pre-create Bible documents for later steps.
        // eslint-disable-next-line no-await-in-loop -- order and visible progress are intentional
        const item = await buildServicePlanOutlineItem({ step, list: latestList, db, bibleDb });
        if (!isContextCurrent()) {
          throw new Error("The selected outline changed before the service plan could be imported.");
        }
        latestList = store.getState().undoable.present.itemList.list;
        if (latestList.some((existing) => existing.listId === item.listId)) continue;
        const placedList = insertServicePlanOutlineItem(latestList, item, step.targetHeading);
        if (!placedList) {
          recordPlacementIssue({
            sectionName: step.sectionName,
            headingName: step.targetHeading.name,
            reason: "heading-removed",
          });
          continue;
        }
        dispatch(updateItemList(placedList));
        if (db && item.type === "bible") {
          dispatch(upsertItemInAllItemsList({ ...item, listId: "" }));
        }
        items.push(item);
        await onItemAdded?.(item);
        await delay(OUTLINE_STEP_DELAY_MS);
      }
      return {
        items,
        insertedCount: items.length,
        skippedTitles: planResult.skippedTitles,
        placementIssues,
      };
    },
    [currentList, db, bibleDb, customDocuments, dispatch, selectedList, songs, store, sectionRules],
  );

  return { pushPlanToOutline, selectedListName: selectedList?.name };
};
