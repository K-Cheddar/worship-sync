import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditDocuments, exportedDocuments, auditManifest } from "./audit-item-content-integrity.mjs";

const lyrics = "Alpha sings unique words beside quiet rivers while distant bells ring across the valley each evening";
const song = (id, name = id) => ({
  _id: id, name, type: "song", docType: "item", selectedArrangement: 0,
  slides: [], shouldSendTo: {}, arrangements: [{
    id: "shared-arr", name: "Master",
    formattedLyrics: [{ id: "shared-section", words: lyrics }],
    songOrder: [{ id: "shared-order", name: "Verse" }], slides: [],
  }],
});
test("ranks differing titles with substantial complete overlap and reused IDs high without leaking lyrics", () => {
  const docs = [song("hymn"), song("praise"), { _id: "allItems", items: [] }];
  const before = JSON.stringify(docs);
  const report = auditDocuments(docs);
  const pair = report.findings.find(f => f.code === "shared-substantial-content");
  assert.equal(pair.severity, "high");
  assert.equal(pair.evidence.sharedIdCount, 3);
  assert.equal(JSON.stringify(report).includes(lyrics), false);
  assert.equal(JSON.stringify(docs), before);
  assert.equal(report.flaggedDocumentCount, 2);
});
test("short common verses and nested ID reuse alone stay medium", () => {
  const docs = [song("a"), song("b")];
  for (const doc of docs) doc.arrangements[0].formattedLyrics[0].words = "Amen";
  const report = auditDocuments(docs);
  assert.equal(report.findings.some(f => f.severity === "high"), false);
  assert.equal(report.findings.find(f => f.code === "shared-nested-identifiers").severity, "medium");
});
test("a medley with an additional substantial arrangement is not complete overlap", () => {
  const a = song("a"), b = song("b");
  b.arrangements.push({ ...b.arrangements[0], id: "other-arr",
    formattedLyrics: [{ id: "other-section", words: lyrics.replace("Alpha", "Entirely different") }] });
  const pair = auditDocuments([a, b]).findings.find(f => f.code === "shared-substantial-content");
  assert.equal(pair.severity, "medium");
  assert.equal(pair.evidence.completeSubstantialOverlap, false);
});
test("normalizes punctuation for review only and checks index, outline, conflicts and custom sections", () => {
  const a = song("183 - Hymn", "183 - Hymn"), b = song("183 – Hymn ", "183 – Hymn ");
  a._conflicts = ["2-losing-leaf"];
  const custom = { _id: "free", type: "free", name: "Custom", slides: [{ boxes: [{}, { words: "Actual" }] }],
    arrangements: [], selectedArrangement: 0, shouldSendTo: {}, formattedSections: [{ words: "Stale" }] };
  const report = auditDocuments([a, b, custom, { _id: "allItems", items: [{ _id: a._id, name: "Incorrect", type: "free" }] },
    { _id: "outline", docType: "itemListDetails", items: [{ _id: "missing", type: "song" }] }]);
  const codes = new Set(report.findings.map(f => f.code));
  for (const code of ["near-identical-titles", "reference-metadata-mismatch", "orphan-reference",
    "custom-section-slide-disagreement", "replication-conflict-leaves", "unindexed-item"]) assert.ok(codes.has(code), code);
  assert.deepEqual(report.findings.find(f => f.code === "near-identical-titles").documentIds, [a._id, b._id]);
});
test("accepts documented export shapes and rejects unsupported input", () => {
  const doc = song("a");
  assert.deepEqual(exportedDocuments({ rows: [{ doc }, { id: "deleted" }] }), [doc]);
  assert.deepEqual(exportedDocuments({ docs: [doc] }), [doc]);
  assert.deepEqual(exportedDocuments(doc), [doc]);
  assert.throws(() => exportedDocuments({}), /Expected/);
});
test("detects substantial shared slides without reused IDs and reports invalid types", () => {
  const docs = ["a", "b"].map(id => ({ _id: id, type: "free", name: id, arrangements: [],
    slides: [{ id: id + "-slide", type: "Section", boxes: [{}, { words: lyrics }] }] }));
  const report = auditDocuments([...docs, { _id: "bad", docType: "item", type: "unexpected" }]);
  const pair = report.findings.find(f => f.code === "shared-substantial-content");
  assert.equal(pair.evidence.sharedIdCount, 0);
  assert.equal(pair.severity, "medium");
  assert.ok(report.findings.some(f => f.code === "invalid-item-type"));
  assert.ok(report.findings.some(f => f.code === "legacy-missing-fields"));
});
test("manifest uses actual contentDatabaseKey and deduplicates shared databases without modifying exports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worship-integrity-"));
  const exportPath = join(dir, "export.json"), manifestPath = join(dir, "manifest.json");
  const data = JSON.stringify([song("a")]);
  await writeFile(exportPath, data);
  await writeFile(manifestPath, JSON.stringify({ churches: [
    { churchId: "opaque-id-1", contentDatabaseKey: "Legacy-Key", exportPath: "export.json" },
    { churchId: "opaque-id-2", contentDatabaseKey: "legacy-key", exportPath: "export.json" },
  ] }));
  const result = await auditManifest(manifestPath);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].scope.database, "worship-sync-legacy-key");
  assert.deepEqual(result.reports[0].scope.churchIds, ["opaque-id-1", "opaque-id-2"]);
  assert.equal(await readFile(exportPath, "utf8"), data);
  await writeFile(manifestPath, JSON.stringify({ churches: [
    { churchId: "church", contentDatabaseKey: "../unsafe", exportPath: "export.json" },
  ] }));
  await assert.rejects(auditManifest(manifestPath), /Invalid/);
});
