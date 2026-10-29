import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Read-only audit of a Couch/Pouch allDocs export; never restores tombstones. */
export function auditItemStorage(exported) {
  const rows = Array.isArray(exported.rows) ? exported.rows : [];
  const documents = Array.isArray(exported) ? exported : exported.docs ?? rows.map((row) => row.doc).filter(Boolean);
  if (!Array.isArray(documents)) throw new Error("Expected a document array or an allDocs export.");
  const byId = new Map(documents.map((doc) => [doc._id, doc]));
  const deleted = new Set(rows.filter((row) => row.value?.deleted).map((row) => row.id));
  for (const doc of documents) if (doc._deleted) deleted.add(doc._id);
  const index = byId.get("allItems");
  const entries = Array.isArray(index?.items) ? index.items : [];
  return {
    indexedEntries: entries.length,
    documentBackedEntries: entries.filter((entry) => byId.has(entry._id) && !deleted.has(entry._id)).length,
    indexOnlyEntries: entries.filter((entry) => !byId.has(entry._id) || deleted.has(entry._id)).map((entry) => ({
      ...entry,
      status: deleted.has(entry._id) ? "deleted-document" : "missing-document",
      recovery: entry.type === "service-time" ? "generated-from-service-times"
        : entry.type === "heading" && !deleted.has(entry._id) ? "heading-metadata-can-be-reviewed-for-recovery"
          : "review-original-backup-content-before-restoring",
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error("Usage: node scripts/audit-item-storage.mjs <all-docs-export.json>");
    process.exitCode = 1;
  } else {
    const exported = JSON.parse(await readFile(process.argv[2], "utf8"));
    console.log(JSON.stringify(auditItemStorage(exported), null, 2));
  }
}
