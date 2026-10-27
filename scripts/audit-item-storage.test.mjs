import test from "node:test";
import assert from "node:assert/strict";
import { auditItemStorage } from "./audit-item-storage.mjs";

test("reports historical metadata without restoring deleted or missing content", () => {
  const exported = { rows: [
    { doc: { _id: "allItems", items: [
      { _id: "song", type: "song", name: "Old name", background: "old" },
      { _id: "deleted", type: "song", name: "Deleted" },
      { _id: "heading", type: "heading", name: "Historic heading" },
      { _id: "missing", type: "free", name: "Missing content" },
      { _id: "countdown", type: "service-time", name: "Upcoming" },
    ] } },
    { doc: { _id: "song", type: "song", name: "Current name", background: "current" } },
    { id: "deleted", value: { deleted: true }, doc: { _id: "deleted", _deleted: true } },
  ] };
  const before = JSON.stringify(exported);
  const result = auditItemStorage(exported);
  assert.equal(result.documentBackedEntries, 1);
  assert.equal(result.indexOnlyEntries.length, 4);
  assert.equal(result.indexOnlyEntries[0].status, "deleted-document");
  assert.equal(result.indexOnlyEntries[1].recovery, "heading-metadata-can-be-reviewed-for-recovery");
  assert.equal(result.indexOnlyEntries[3].recovery, "generated-from-service-times");
  assert.equal(JSON.stringify(exported), before);
});
