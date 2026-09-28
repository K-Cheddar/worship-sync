import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";
import { reconcileSongLibraryIndex } from "../utils/songLibrary";
import { allDocsSlice } from "./allDocsSlice";
import { allItemsSlice } from "./allItemsSlice";
import { reconcileFreeFormLibraryIndex } from "../utils/freeFormLibrary";
import { reconcileTimerLibraryIndex } from "../utils/timerLibrary";

type SongLibraryIndexState = {
  allItems: ReturnType<typeof allItemsSlice.reducer>;
  allDocs: ReturnType<typeof allDocsSlice.reducer>;
};

/**
 * Keeps lightweight allItems entries complete for durable songs and custom items.
 * A factory keeps listener instances isolated in tests and application startup.
 */
export const createSongLibraryIndexRepairMiddleware = () => {
  const middleware = createListenerMiddleware<SongLibraryIndexState>();
  // An index removal is authoritative while PouchDB replication catches up.
  // Keep stale timer documents from restoring the row until a docs refresh
  // confirms the document itself has been removed.
  const deletedTimerIds = new Set<string>();

  middleware.startListening({
    predicate: isAnyOf(
      allDocsSlice.actions.updateAllSongDocs,
      allDocsSlice.actions.updateAllFreeFormDocs,
      allDocsSlice.actions.updateAllTimerDocs,
      allItemsSlice.actions.initiateAllItemsList,
      allItemsSlice.actions.updateAllItemsListFromRemote,
      allItemsSlice.actions.removeItemFromAllItemsList,
    ),
    effect: (action, listenerApi) => {
      const state = listenerApi.getState();

      if (allItemsSlice.actions.removeItemFromAllItemsList.match(action)) {
        const previousState = listenerApi.getOriginalState();
        const removedItem = previousState.allItems.list.find(
          (item) => item._id === action.payload,
        );
        if (removedItem?.type === "timer") {
          deletedTimerIds.add(removedItem._id);
        }
        return;
      }

      if (allItemsSlice.actions.updateAllItemsListFromRemote.match(action)) {
        const previousState = listenerApi.getOriginalState();
        const incomingTimerIds = new Set(
          state.allItems.list
            .filter((item) => item.type === "timer")
            .map((item) => item._id),
        );
        for (const item of previousState.allItems.list) {
          if (item.type === "timer" && !incomingTimerIds.has(item._id)) {
            deletedTimerIds.add(item._id);
          }
        }
        for (const id of incomingTimerIds) deletedTimerIds.delete(id);
      }

      if (allDocsSlice.actions.updateAllTimerDocs.match(action)) {
        const durableTimerIds = new Set(
          state.allDocs.allTimerDocs.map((doc) => doc._id),
        );
        for (const id of deletedTimerIds) {
          if (!durableTimerIds.has(id)) deletedTimerIds.delete(id);
        }
      }

      if (!state.allItems.isInitialized) return;

      // Remote allItems messages are handled before the controller refreshes
      // allDocs. Do not use that possibly stale custom-doc snapshot here: a
      // deleted custom doc could otherwise be indexed again before its
      // PouchDB tombstone is reflected in allFreeFormDocs.
      const withCustomItems = allItemsSlice.actions.updateAllItemsListFromRemote.match(
        action,
      )
        ? state.allItems.list
        : reconcileFreeFormLibraryIndex(
            state.allItems.list,
            state.allDocs.allFreeFormDocs,
          );
      const withSongs = reconcileSongLibraryIndex(
        withCustomItems,
        state.allDocs.allSongDocs,
      );
      const repairableTimerDocs = state.allDocs.allTimerDocs.filter(
        (doc) => !deletedTimerIds.has(doc._id),
      );
      const repairedItems = reconcileTimerLibraryIndex(
        withSongs,
        repairableTimerDocs,
      );
      if (repairedItems === state.allItems.list) return;

      listenerApi.dispatch(
        allItemsSlice.actions.updateAllItemsList(repairedItems),
      );
    },
  });

  return middleware;
};
