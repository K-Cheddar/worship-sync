import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";
import { reconcileSongLibraryIndex } from "../utils/songLibrary";
import { allDocsSlice } from "./allDocsSlice";
import { allItemsSlice } from "./allItemsSlice";

type SongLibraryIndexState = {
  allItems: ReturnType<typeof allItemsSlice.reducer>;
  allDocs: ReturnType<typeof allDocsSlice.reducer>;
};

/**
 * Keeps the lightweight allItems song index complete for older clients.
 * A factory keeps listener instances isolated in tests and application startup.
 */
export const createSongLibraryIndexRepairMiddleware = () => {
  const middleware = createListenerMiddleware<SongLibraryIndexState>();

  middleware.startListening({
    predicate: isAnyOf(
      allDocsSlice.actions.updateAllSongDocs,
      allItemsSlice.actions.initiateAllItemsList,
      allItemsSlice.actions.updateAllItemsListFromRemote,
    ),
    effect: (_action, listenerApi) => {
      const state = listenerApi.getState();
      if (!state.allItems.isInitialized) return;

      const repairedItems = reconcileSongLibraryIndex(
        state.allItems.list,
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
