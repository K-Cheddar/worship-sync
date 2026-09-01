import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { mergeSongLibraryItems } from "../utils/songLibrary";

const selectAllItems = (state: RootState) => state.allItems.list;
const selectAllSongDocs = (state: RootState) => state.allDocs.allSongDocs;
const selectAllItemsLoading = (state: RootState) =>
  state.allItems.isAllItemsLoading;

/** Canonical read model for every surface that lists library songs. */
export const selectSongLibrary = createSelector(
  [selectAllItems, selectAllSongDocs, selectAllItemsLoading],
  (allItems, documents, isAllItemsLoading) => {
    const songs = mergeSongLibraryItems(allItems, documents);

    return {
      songs,
      documents,
      isLoading: isAllItemsLoading && songs.length === 0,
    };
  },
);
