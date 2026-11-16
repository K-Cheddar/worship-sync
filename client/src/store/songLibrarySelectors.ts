import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";
import { sortNamesInList } from "../utils/sort";

/** Song-specific view of the shared document cache. */
export const selectSongLibrary = createSelector(
  [
    (state: RootState) => state.allDocs.allSongDocs,
    (state: RootState) => state.allDocs.isInitialized,
    (state: RootState) => state.allDocs.songLibraryDiagnostics,
  ],
  (documents, isInitialized, diagnostics) => {
    const unavailableIds = new Set(diagnostics.map((diagnostic) => diagnostic.songId));
    const songs = sortNamesInList(documents.map(itemDocumentToLibraryEntry))
      .filter((song) => !unavailableIds.has(song._id));
    return {
      songs,
      documents,
      isLoading: !isInitialized && documents.length === 0,
    };
  },
);
