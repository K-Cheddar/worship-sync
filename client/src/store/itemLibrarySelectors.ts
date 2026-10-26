import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";

import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";

export const selectItemDocuments = createSelector(
  [(state: RootState) => state.allDocs.allSongDocs,
    (state: RootState) => state.allDocs.allFreeFormDocs,
    (state: RootState) => state.allDocs.allTimerDocs,
    (state: RootState) => state.allDocs.allBibleDocs,
    (state: RootState) => state.allDocs.allHeadingDocs],
  (songs, custom, timers, bibles, headings) => [...(songs ?? []), ...(custom ?? []), ...(timers ?? []), ...(bibles ?? []), ...(headings ?? [])],
);

export const selectItemEntries = createSelector([selectItemDocuments], (docs) =>
  docs.map(itemDocumentToLibraryEntry).sort((a, b) =>
    a.name.localeCompare(b.name, "en", { numeric: true }) || a.type.localeCompare(b.type) || a._id.localeCompare(b._id)),
);

/** Every browsable library category uses the same document metadata adapter. */
export const selectUnifiedItemLibrary = createSelector([selectItemEntries], (items) =>
  items.filter((item) => ["song", "free", "timer"].includes(item.type)),
);
