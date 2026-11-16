import type { Dispatch } from "@reduxjs/toolkit";
import type { DBItem, DBHeading } from "../types";
import { applyItemDocumentChange, applySongLibraryRefresh, hydrateItemCache, invalidateSongContent, isItemDocument, markSongV2Activated, resetItemCache, setItemCacheError, updateSongLibraryDiagnostics } from "./allDocsSlice";
import { discoverSongLibrary, type SongLibraryDiagnostic } from "../utils/songLibraryDiscovery";
import { getSongV2DocumentIdentity, getSongV2RootDocId, loadSongV2LibraryProjection } from "../utils/songPersistence";
import type { SongV2RootDocument } from "../types";
export { isItemDocument } from "./allDocsSlice";

/** One owner per database session. Cleanup invalidates every pending continuation. */
export const startItemCacheSync = (db: PouchDB.Database, dispatch: Dispatch) => {
  let active = true;
  let feed: PouchDB.Core.Changes<{}> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let sequence: string | number | undefined;
  const activatedSongIds = new Set<string>();
  const projectionGenerations = new Map<string, number>();

  const refreshSongProjection = async (songId: string) => {
    const generation = (projectionGenerations.get(songId) ?? 0) + 1;
    projectionGenerations.set(songId, generation);
    let projection: DBItem | undefined;
    let diagnostic: SongLibraryDiagnostic | undefined;
    try {
      const root = await db.get<SongV2RootDocument>(getSongV2RootDocId(songId));
      if (root.songId !== songId || root._id !== getSongV2RootDocId(songId)) {
        throw new Error("Invalid Song V2 root identity");
      }
      if (!root.deletedAt) projection = await loadSongV2LibraryProjection(db, root);
    } catch (error) {
      const missing = typeof error === "object" && error !== null &&
        (("status" in error && error.status === 404) || ("name" in error && error.name === "not_found"));
      const deleted = error instanceof Error && error.name === "SongV2DeletedError";
      if (!missing && !deleted) {
        diagnostic = {
          songId,
          rootId: getSongV2RootDocId(songId),
          code: "incomplete-v2",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (!active || projectionGenerations.get(songId) !== generation) return;
    dispatch(applySongLibraryRefresh({ songId, projection, diagnostic }));
  };
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
        // An empty IndexedDB database can omit the sequence; replay from zero.
        sequence = snapshot.update_seq ?? 0;
        const snapshotDocs = snapshot.rows.map((row): unknown => row.doc);
        const songLibrary = discoverSongLibrary(snapshotDocs);
        songLibrary.activatedSongIds.forEach(songId => activatedSongIds.add(songId));
        const otherItems = snapshotDocs.filter((doc): doc is DBItem | DBHeading =>
          isItemDocument(doc) && (doc as DBItem).type !== "song",
        );
        dispatch(hydrateItemCache([...otherItems, ...songLibrary.songs]));
        dispatch(markSongV2Activated(songLibrary.activatedSongIds));
        dispatch(updateSongLibraryDiagnostics(songLibrary.diagnostics));
      }
      if (!active) return;
      dispatch(setItemCacheError(null));
      const nextFeed = db.changes({ since: sequence, live: true, include_docs: true });
      feed = nextFeed;
      nextFeed.on("change", (change) => {
        if (!active || feed !== nextFeed) return;
        sequence = change.seq;
        const songV2Identity = getSongV2DocumentIdentity(change.id);
        if (songV2Identity) {
          const { songId, kind } = songV2Identity;
          if (kind === "root") {
            activatedSongIds.add(songId);
            dispatch(markSongV2Activated([songId]));
          }
          if (kind === "slide") {
            dispatch(invalidateSongContent(songId));
            return;
          }
          if (kind === "arrangement") dispatch(invalidateSongContent(songId));
          if (activatedSongIds.has(songId)) void refreshSongProjection(songId);
          return;
        }
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
