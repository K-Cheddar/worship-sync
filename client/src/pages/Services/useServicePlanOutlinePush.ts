import { selectItemEntries } from "../../store/itemLibrarySelectors";
/**
 * Wraps the outline bridge with the live PouchDB/Redux plumbing it needs
 * (ControllerInfoContext's db, the currently-selected item list). Intended for
 * the presentation Controller's opt-in "apply plan to item list" flow — not
 * the Teams plan editor, which only autosaves the Firestore ServicePlan.
 * Native pushes do not write outline state back into the saved plan.
 */
import { useCallback, useContext, useEffect, useRef } from "react";
import { useStore } from "react-redux";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useDispatch, useSelector } from "../../hooks";
import { updateItemList } from "../../store/itemListSlice";
import {
  buildServicePlanOutlineItem,
  placeServicePlanOutlineItem,
  planServicePlanOutlineItems,
  type ServicePlanOutlinePushResult,
  type ServicePlanOutlinePlacementFallback,
} from "./servicePlanOutlineBridge";
import { useServicePlanSongLibrary } from "./useServicePlanSongLibrary";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServiceItem } from "../../types";
import type { RootState } from "../../store/store";

const OUTLINE_STEP_DELAY_MS = 300;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useServicePlanOutlinePush = () => {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
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
      onItemAdded?: (item: ServiceItem, fallback?: ServicePlanOutlinePlacementFallback) => Promise<void> | void,
      shouldContinue: () => boolean = () => true,
    ): Promise<ServicePlanOutlinePushResult> => {
      const stateAtStart = store.getState().undoable.present;
      const selectedListAtStart = stateAtStart.itemLists.selectedList;
      if (!selectedListAtStart) {
        throw new Error("Open or create an item list in the Controller first.");
      }
      if (selectedList?._id !== selectedListAtStart._id) {
        throw new Error("The selected outline changed before the service plan could be imported.");
      }
      const startingContext = {
        ...contextRef.current,
        selectedList: selectedListAtStart,
        db,
        bibleDb,
        songs,
        customDocuments,
      };
      const startingList = stateAtStart.itemList.list;
      // One run uses one mapping configuration even if integrations refresh
      // while the operator is watching the visible per-item progress.
      const sectionRulesSnapshot = (sectionRules ?? []).map((rule) => ({ ...rule }));
      const isOutlineContextCurrent = () =>
        mounted.current &&
        store.getState().undoable.present.itemLists.selectedList?._id === startingContext.selectedList._id
        &&
        contextRef.current.selectedList?._id === startingContext.selectedList?._id
        && contextRef.current.db === startingContext.db
        && contextRef.current.bibleDb === startingContext.bibleDb;
      const assertCurrent = () => {
        if (!isSourcePlanCurrent()) {
          throw new Error(
            "The selected service plan changed or could not be verified. Refresh it before syncing.",
          );
        }
        if (!isOutlineContextCurrent()) {
          throw new Error("The selected outline changed before the service plan could be imported.");
        }
      };
      const planResult = planServicePlanOutlineItems({
        plan,
        currentList: startingList,
        songs,
        customDocuments,
        sectionRules: sectionRulesSnapshot,
      });
      assertCurrent();
      const items: ServiceItem[] = [];
      const placementFallbacks: ServicePlanOutlinePlacementFallback[] = [];
      for (const step of planResult.steps) {
        if (!shouldContinue()) break;
        assertCurrent();
        let latestList = store.getState().undoable.present.itemList.list;
        if (latestList.some((existing) => existing.listId === step.planned.listId)) continue;
        // Build only the item that is about to be shown. In particular, a stop
        // request must not pre-create Bible documents for later steps.
        // eslint-disable-next-line no-await-in-loop -- order and visible progress are intentional
        const builtItem = await buildServicePlanOutlineItem({
          step,
          list: [...latestList, ...selectItemEntries(store.getState())],
          db,
          bibleDb,
        });
        const currentEntry = selectItemEntries(store.getState()).find((entry) => entry._id === builtItem._id);
        const item = currentEntry ? { ...currentEntry, listId: builtItem.listId } : builtItem;
        assertCurrent();
        latestList = store.getState().undoable.present.itemList.list;
        if (latestList.some((existing) => existing.listId === item.listId)) continue;
        const placed = placeServicePlanOutlineItem(latestList, item, step);
        assertCurrent();
        dispatch(updateItemList(placed.list));
        items.push(item);
        if (placed.fallback) placementFallbacks.push(placed.fallback);
        await onItemAdded?.(item, placed.fallback);
        assertCurrent();
        await delay(OUTLINE_STEP_DELAY_MS);
        assertCurrent();
      }
      return {
        items,
        insertedCount: items.length,
        skippedTitles: planResult.skippedTitles,
        placementFallbacks,
      };
    },
    [db, bibleDb, customDocuments, dispatch, selectedList, songs, store, sectionRules],
  );

  return { pushPlanToOutline, selectedListName: selectedList?.name };
};
