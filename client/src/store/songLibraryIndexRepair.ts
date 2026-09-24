import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";
import { reconcileSongLibraryIndex } from "../utils/songLibrary";
import { allDocsSlice } from "./allDocsSlice";
import { allItemsSlice } from "./allItemsSlice";
import { reconcileFreeFormLibraryIndex } from "../utils/freeFormLibrary";

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

  middleware.startListening({
    predicate: isAnyOf(
      allDocsSlice.actions.updateAllSongDocs,
      allDocsSlice.actions.updateAllFreeFormDocs,
      allItemsSlice.actions.initiateAllItemsList,
      allItemsSlice.actions.updateAllItemsListFromRemote,
    ),
    effect: (action, listenerApi) => {
      const state = listenerApi.getState();
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
      const repairedItems = reconcileSongLibraryIndex(
        withCustomItems,
        state.allDocs.allSongDocs,
      );
      if (repairedItems === state.allItems.list) return;

      listenerApi.dispatch(
        allItemsSlice.actions.updateAllItemsList(repairedItems),
      );
    },
  });

  return middleware;
};
