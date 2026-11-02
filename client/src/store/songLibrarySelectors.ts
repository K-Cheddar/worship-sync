import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";
import { sortNamesInList } from "../utils/sort";

/** Song-specific view of the shared document cache. */
export const selectSongLibrary = createSelector(
  [(state: RootState) => state.allDocs.allSongDocs,
    (state: RootState) => state.allDocs.isInitialized],
  (documents, isInitialized) => ({
    songs: sortNamesInList(documents.map(itemDocumentToLibraryEntry)),
    documents,
    isLoading: !isInitialized && documents.length === 0,
  }),
);
