import type { Dispatch } from "@reduxjs/toolkit";
import type { DBItem, DBHeading } from "../types";
import { applyItemDocumentChange, hydrateItemCache, resetItemCache, setItemCacheError } from "./allDocsSlice";

/** Legacy items may lack docType; explicit non-item discriminators win. */
export const isItemDocument = (value: unknown): value is DBItem | DBHeading => {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return typeof doc._id === "string" && typeof doc.name === "string" && !doc._id.startsWith("_") && !doc._deleted &&
    (doc.docType === undefined || doc.docType === "item" || doc.docType === "heading") &&
    ["song", "free", "timer", "bible", "heading"].includes(String(doc.type));
};

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
        dispatch(hydrateItemCache(snapshot.rows.map((row): unknown => row.doc).filter(isItemDocument)));
      }
      if (!active) return;
      dispatch(setItemCacheError(null));
      const nextFeed = db.changes({ since: sequence, live: true, include_docs: true });
      feed = nextFeed;
      nextFeed.on("change", (change) => {
        if (!active || feed !== nextFeed) return;
        sequence = change.seq;
        dispatch(applyItemDocumentChange({
          id: change.id,
          deleted: change.deleted,
          doc: isItemDocument(change.doc) ? change.doc : undefined,
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
