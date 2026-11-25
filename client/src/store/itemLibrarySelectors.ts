import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";

import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";
import type { DBHeading, DBItem, ServiceItem } from "../types";
import { recordStartupAggregate } from "../utils/startupDiagnostics";

const itemLibraryNameCollator = new Intl.Collator("en", { numeric: true });
const itemLibraryTieBreakCollator = new Intl.Collator();
const projectedEntries = new WeakMap<object, ServiceItem>();
const emptyItemDocuments: readonly DBItem[] = [];
const emptyHeadingDocuments: readonly DBHeading[] = [];

const sameEntry = (left: ServiceItem, right: ServiceItem) =>
  left._id === right._id &&
  left.name === right.name &&
  left.type === right.type &&
  left.listId === right.listId &&
  left.background === right.background &&
  left.localImage === right.localImage &&
  left.localVideoFile === right.localVideoFile;

const compareEntries = (left: ServiceItem, right: ServiceItem) =>
  itemLibraryNameCollator.compare(left.name, right.name) ||
  itemLibraryTieBreakCollator.compare(left.type, right.type) ||
  itemLibraryTieBreakCollator.compare(left._id, right._id);

const createItemEntrySelector = (
  inputs: Array<(state: RootState) => readonly (DBItem | DBHeading)[]>,
) => {
  let previousEntriesById = new Map<string, ServiceItem>();
  let previousResult: ServiceItem[] | undefined;

  return createSelector(inputs, (...categories: (readonly (DBItem | DBHeading)[])[]) => {
    const startedAt = performance.now();
    const entries: ServiceItem[] = [];
    let mappedDocuments = 0;

    for (const category of categories) {
      for (const document of category) {
        let entry = projectedEntries.get(document as object);
        if (!entry) {
          entry = itemDocumentToLibraryEntry(document as never);
          projectedEntries.set(document as object, entry);
          mappedDocuments += 1;
        }
        const previous = previousEntriesById.get(entry._id);
        entries.push(previous && sameEntry(previous, entry) ? previous : entry);
      }
    }

    const mappingDurationMs = performance.now() - startedAt;
    const unchanged = previousResult !== undefined &&
      previousResult.length === entries.length &&
      entries.every((entry, index) => entry === previousResult?.[index]);
    let sortingDurationMs = 0;
    let result = previousResult;
    if (!unchanged) {
      const sortingStartedAt = performance.now();
      result = entries.sort(compareEntries);
      sortingDurationMs = performance.now() - sortingStartedAt;
    }

    previousEntriesById = new Map(entries.map((entry) => [entry._id, entry]));
    previousResult = result!;
    recordStartupAggregate("item-library-selector", {
      recomputations: 1,
      documentsVisited: entries.length,
      documentsMapped: mappedDocuments,
      collectionsSorted: unchanged ? 0 : 1,
      mappingDurationMs,
      sortingDurationMs,
    });
    return previousResult;
  });
};

const selectSongs = (state: RootState) => state.allDocs.allSongDocs ?? emptyItemDocuments;
const selectCustomItems = (state: RootState) => state.allDocs.allFreeFormDocs ?? emptyItemDocuments;
const selectTimers = (state: RootState) => state.allDocs.allTimerDocs ?? emptyItemDocuments;
const selectBibleItems = (state: RootState) => state.allDocs.allBibleDocs ?? emptyItemDocuments;
const selectHeadings = (state: RootState) => state.allDocs.allHeadingDocs ?? emptyHeadingDocuments;
const selectServiceTimes = (state: RootState) => state.allDocs.allServiceTimeDocs ?? emptyItemDocuments;

export const selectItemDocuments = createSelector(
  [selectSongs, selectCustomItems, selectTimers, selectBibleItems, selectHeadings, selectServiceTimes],
  (songs, custom, timers, bibles, headings, serviceTimes) => [
    ...songs, ...custom, ...timers, ...bibles, ...headings, ...serviceTimes,
  ],
);

/** Complete metadata view for consumers that browse every cached document category. */
export const selectItemEntries = createItemEntrySelector([
  selectSongs,
  selectCustomItems,
  selectTimers,
  selectBibleItems,
  selectHeadings,
  selectServiceTimes,
]);

/** The standard library excludes Bible, heading, and service-time documents. */
export const selectUnifiedItemLibrary = createItemEntrySelector([
  selectSongs,
  selectCustomItems,
  selectTimers,
]);
