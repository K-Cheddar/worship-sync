import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import { selectSongLibrary } from "./songLibrarySelectors";
import type { ServiceItem } from "../types";

const selectIndexedItems = (state: RootState) => state.allItems.list;

/** Combines the existing library read models without another document load. */
export const selectUnifiedItemLibrary = createSelector(
  [selectIndexedItems, selectSongLibrary],
  (items, { songs }) => {
    const byId = new Map<string, ServiceItem>();

    for (const item of items) {
      if (item.type === "free" || item.type === "timer") {
        byId.set(item._id, item);
      }
    }
    for (const song of songs) byId.set(song._id, song);

    return [...byId.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en", { numeric: true }) ||
        a.type.localeCompare(b.type) ||
        a._id.localeCompare(b._id),
    );
  },
);
