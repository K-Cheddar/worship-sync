import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { mergeSongLibraryItems } from "../utils/songLibrary";

const selectAllItems = (state: RootState) => state.allItems.list;
const selectAllSongDocs = (state: RootState) => state.allDocs.allSongDocs;
const selectDiagnostics = (state: RootState) => state.allDocs.songLibraryDiagnostics;
const selectAllItemsLoading = (state: RootState) =>
  state.allItems.isAllItemsLoading;

/** Canonical read model for every surface that lists library songs. */
export const selectSongLibrary = createSelector(
  [selectAllItems, selectAllSongDocs, selectAllItemsLoading, selectDiagnostics],
  (allItems, documents, isAllItemsLoading, diagnostics) => {
    const unavailableIds = new Set(diagnostics?.map((diagnostic) => diagnostic.songId));
    const songs = mergeSongLibraryItems(allItems, documents).filter((song) => !unavailableIds.has(song._id));

    return {
      songs,
      documents,
      isLoading: isAllItemsLoading && songs.length === 0,
    };
  },
);
