import type PouchDB from "pouchdb-browser";
import type { DBHeading, DBItem } from "../types";
import { isItemDocument } from "../store/allDocsSlice";

/**
 * Read requested items from one allDocs snapshot, then validate only those IDs
 * against writes made after the snapshot. Unrelated database writes are ignored.
 */
export const readCurrentItemDocuments = async (
  db: PouchDB.Database,
  ids: string[],
): Promise<Map<string, DBItem | DBHeading>> => {
  const requestedIds = [...new Set(ids)];
  if (requestedIds.length === 0) return new Map();

  const snapshot = await db.allDocs<DBItem | DBHeading>({
    keys: requestedIds,
    include_docs: true,
    update_seq: true,
  });
  if (snapshot.update_seq === undefined) {
    throw new Error("Missing PouchDB snapshot sequence");
  }

  const documents = new Map<string, DBItem | DBHeading>();
  for (const row of snapshot.rows) {
    if ("doc" in row && isItemDocument(row.doc)) documents.set(row.doc._id, row.doc);
  }

  const changes = await db.changes<DBItem | DBHeading>({
    since: snapshot.update_seq,
    doc_ids: requestedIds,
    include_docs: true,
  });
  for (const change of changes.results) {
    if (change.deleted || (change.doc as (DBItem | DBHeading) & { _deleted?: boolean } | undefined)?._deleted) {
      documents.delete(change.id);
    } else if (isItemDocument(change.doc)) {
      documents.set(change.id, change.doc);
    } else {
      documents.delete(change.id);
    }
  }

  return documents;
};
