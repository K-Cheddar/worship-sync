import type { Dispatch } from "@reduxjs/toolkit";
import type { DBItem, DBHeading } from "../types";
import { applyItemDocumentChange, hydrateItemCache, isItemDocument, resetItemCache, setItemCacheError, updateSongLibraryDiagnostics } from "./allDocsSlice";
import { discoverSongLibrary } from "../utils/songLibraryDiscovery";
export { isItemDocument } from "./allDocsSlice";

/** One owner per database session. Cleanup invalidates every pending continuation. */
export const startItemCacheSync = (db: PouchDB.Database, dispatch: Dispatch) => {
  let active = true;
  let feed: PouchDB.Core.Changes<{}> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let sequence: string | number | undefined;
  dispatch(resetItemCache());

  const recover = (error: unknown) => {
    if (!active) return;
    console.error("Item cache synchronization failed:", error);
    dispatch(setItemCacheError("The item library could not be loaded. Try again."));
    const failedFeed = feed;
    feed = undefined;
    failedFeed?.cancel();
    clearTimeout(retry);
    retry = setTimeout(() => { void connect(); }, 1000);
  };

  const connect = async () => {
    try {
      if (sequence === undefined) {
        const snapshot = await db.allDocs<DBItem | DBHeading>({ include_docs: true, update_seq: true });
        if (!active) return;
        // Replay writes made during loading or before .changes is installed.
        if (snapshot.update_seq === undefined) throw new Error("Missing PouchDB snapshot sequence");
        sequence = snapshot.update_seq;
        const snapshotDocs = snapshot.rows.map((row): unknown => row.doc);
        const songLibrary = discoverSongLibrary(snapshotDocs);
        const otherItems = snapshotDocs.filter((doc): doc is DBItem | DBHeading =>
          isItemDocument(doc) && (doc as DBItem).type !== "song",
        );
        dispatch(hydrateItemCache([...otherItems, ...songLibrary.songs]));
        dispatch(updateSongLibraryDiagnostics(songLibrary.diagnostics));
      }
      if (!active) return;
      dispatch(setItemCacheError(null));
      const nextFeed = db.changes({ since: sequence, live: true, include_docs: true });
      feed = nextFeed;
      nextFeed.on("change", (change) => {
        if (!active || feed !== nextFeed) return;
        sequence = change.seq;
        if ((change.doc as { docType?: string } | undefined)?.docType?.startsWith("song-v2-")) return;
        const doc = isItemDocument(change.doc) ? change.doc : undefined;
        if (!doc && !change.deleted) return;
        dispatch(applyItemDocumentChange({
          id: change.id,
          deleted: change.deleted,
          doc,
        }));
      })
        .on("error", (error) => { if (feed === nextFeed) recover(error); });
    } catch (error) {
      recover(error);
    }
  };
  void connect();

  return () => {
    active = false;
    clearTimeout(retry);
    feed?.cancel();
    dispatch(resetItemCache());
  };
};
