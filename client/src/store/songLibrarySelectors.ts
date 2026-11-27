import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";
import { sortNamesInList } from "../utils/sort";

const selectSongDocuments = (state: RootState) => state.allDocs.allSongDocs;
const selectSongDiagnostics = (state: RootState) => state.allDocs.songLibraryDiagnostics;
const selectSortedSongEntries = createSelector(
  [selectSongDocuments],
  (documents) => sortNamesInList(documents.map(itemDocumentToLibraryEntry)),
);

/** Song-specific view of the shared document cache. */
export const selectSongLibrary = createSelector(
  [
    selectSortedSongEntries,
    selectSongDocuments,
    (state: RootState) => state.allDocs.isInitialized,
    selectSongDiagnostics,
  ],
  (sortedSongs, documents, isInitialized, diagnostics) => {
    const unavailableIds = new Set(diagnostics
      .filter((diagnostic) => diagnostic.code === "incomplete-v2")
      .map((diagnostic) => diagnostic.songId));
    const songs = unavailableIds.size
      ? sortedSongs.filter((song) => !unavailableIds.has(song._id))
      : sortedSongs;
    return {
      songs,
      documents,
      isLoading: !isInitialized && documents.length === 0,
    };
  },
);
