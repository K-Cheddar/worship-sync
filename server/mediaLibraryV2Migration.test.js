import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_LIBRARY_META_ID,
  MEDIA_MIGRATION_BATCH_SIZE,
  migrateMediaLibraryV2,
  resolveMediaMigrationDatabases,
} from "./mediaLibraryV2Migration.js";

const notFound = () => Object.assign(new Error("missing"), { response: { status: 404 } });

test("resolves all migration targets from each church content database key", () => {
  const result = resolveMediaMigrationDatabases([
    { id: "church_1", data: () => ({ contentDatabaseKey: "legacy-name" }) },
    { id: "church_2", data: () => ({ contentDatabaseKey: "Eliathah" }) },
    { id: "church_duplicate", data: () => ({ contentDatabaseKey: "legacy-name" }) },
    { id: "church_prefixed", data: () => ({ contentDatabaseKey: "worship-sync-Already-Named" }) },
  ]);

  assert.deepEqual(result.databases, [
    "worship-sync-legacy-name",
    "worship-sync-eliathah",
    "worship-sync-already-named",
  ]);
  assert.deepEqual(result.skippedChurches, []);
  assert.equal(result.databases.includes("worship-sync-church_1"), false);
});

test("reports churches with missing or invalid content database keys without targeting their IDs", () => {
  const result = resolveMediaMigrationDatabases([
    { id: "church_valid", data: () => ({ contentDatabaseKey: "valid" }) },
    { id: "church_missing", data: () => ({ name: "No database key" }) },
    { id: "church_invalid", data: () => ({ contentDatabaseKey: "../unsafe" }) },
  ]);

  assert.deepEqual(result.databases, ["worship-sync-valid"]);
  assert.deepEqual(result.skippedChurches.map(({ churchId }) => churchId), ["church_missing", "church_invalid"]);
  assert.equal(result.databases.includes("worship-sync-church_missing"), false);
});

const fixture = (count = 3) => {
  const docs = new Map();
  const list = Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    name: `Media ${index}`,
    background: `https://assets.invalid/${index}`,
    type: "image",
  }));
  const folders = [{ id: "folder-1", name: "Worship", parentId: null }];
  let legacy = { _id: "media", list, folders };
  const calls = [];
  let failBatch = false;
  let failVerification = false;
  let failSecondBatch = false;
  let rejectOversizedBatches = false;
  let rejectSingleDocument = false;
  const client = {
    get: async (url) => {
      calls.push(["get", url]);
      if (url.endsWith("/media")) return { data: legacy };
      if (url.endsWith("/media-folders")) {
        const value = docs.get("media-folders");
        if (!value) throw notFound();
        return { data: value };
      }
      if (url.endsWith(`/${MEDIA_LIBRARY_META_ID}`)) {
        const value = docs.get(MEDIA_LIBRARY_META_ID);
        if (!value) throw notFound();
        return { data: value };
      }
      if (url.includes("/_all_docs")) {
        const rows = [...docs.values()]
          .filter((doc) => doc.docType === "mediaItem")
          .map((doc) => ({ id: doc._id, doc }));
        if (failVerification && rows.length) rows[0].doc = { ...rows[0].doc, name: "unexpected" };
        return { data: { rows } };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
    post: async (url, body) => {
      calls.push(["post", url, body.docs]);
      if (failBatch) return { data: [{ error: "forbidden" }] };
      if (rejectOversizedBatches && body.docs.length > 1) {
        throw Object.assign(new Error("too large"), { response: { status: 413 } });
      }
      if (rejectSingleDocument && body.docs.length === 1) {
        throw Object.assign(new Error("too large"), { response: { status: 413 } });
      }
      if (failSecondBatch && calls.filter(([kind]) => kind === "post").length === 2) {
        return { data: [{ error: "forbidden" }] };
      }
      body.docs.forEach((doc) => {
        if (doc._deleted) docs.delete(doc._id);
        else docs.set(doc._id, { ...doc, _rev: "1-test" });
      });
      return { data: body.docs.map((doc) => ({ ok: true, id: doc._id })) };
    },
    put: async (url, doc) => {
      calls.push(["put", url, doc]);
      const id = url.split("/").at(-1);
      docs.set(id, { ...doc, _rev: "1-test" });
      return { data: { ok: true, id } };
    },
  };
  return {
    client,
    docs,
    list,
    folders,
    calls,
    fail: () => { failBatch = true; },
    succeed: () => { failBatch = false; },
    failVerification: () => { failVerification = true; },
    allowVerification: () => { failVerification = false; },
    setLegacyList: (nextList) => { legacy = { ...legacy, list: nextList }; },
    failSecondBatch: () => { failSecondBatch = true; },
    rejectOversizedBatches: () => { rejectOversizedBatches = true; },
    rejectSingleDocument: () => { rejectSingleDocument = true; },
  };
};

test("migrates IDs and folders in bounded batches and marks v2 after verification", async () => {
  const data = fixture(123);
  const report = await migrateMediaLibraryV2({ client: data.client, database: "church", batchSize: 50 });
  assert.equal(report.legacyCount, 123);
  assert.equal(report.docsCreated, 123);
  assert.equal(report.migratedFolderCount, 1);
  assert.equal(report.verificationResult, "passed");
  assert.equal(report.schemaVersionResult, "set_v2");
  assert.deepEqual(data.docs.get("media-item:id-18").id, "id-18");
  assert.deepEqual(data.docs.get("media-folders").folders, data.folders);
  const bulkCalls = data.calls.filter(([kind]) => kind === "post");
  assert.deepEqual(bulkCalls.map(([, , docs]) => docs.length), [50, 50, 23]);
  const lastVerify = data.calls.findLastIndex(([kind, url]) => kind === "get" && url.includes("/_all_docs"));
  const markerWrite = data.calls.findIndex(([kind, url]) => kind === "put" && url.endsWith(`/${MEDIA_LIBRARY_META_ID}`));
  assert.ok(markerWrite > lastVerify);
});

test("completed migration reruns do not rewrite active v2 documents", async () => {
  const data = fixture(2);
  await migrateMediaLibraryV2({ client: data.client, database: "church" });
  data.docs.set(MEDIA_LIBRARY_META_ID, { _id: MEDIA_LIBRARY_META_ID, schemaVersion: 2 });
  data.docs.set("media-item:id-0", {
    ...data.docs.get("media-item:id-0"),
    name: "A newer v2 edit",
  });
  data.calls.length = 0;
  const report = await migrateMediaLibraryV2({ client: data.client, database: "church" });
  assert.equal(report.schemaVersionResult, "already_v2");
  assert.equal(data.calls.some(([kind]) => kind === "post"), false);
  assert.equal(data.docs.get("media-item:id-0").name, "A newer v2 edit");
});

test("failed batch never activates the schema marker and can be safely retried", async () => {
  const data = fixture(2);
  data.fail();
  const failed = await migrateMediaLibraryV2({ client: data.client, database: "church" });
  assert.equal(failed.schemaVersionResult, "not_set");
  assert.equal(data.docs.has(MEDIA_LIBRARY_META_ID), false);
  data.succeed();
  const retry = await migrateMediaLibraryV2({ client: data.client, database: "church" });
  assert.equal(retry.schemaVersionResult, "set_v2");
  assert.equal(data.docs.size, 4);
});

test("failed content verification leaves schema v1 active for a safe rerun", async () => {
  const data = fixture(2);
  data.failVerification();
  const failed = await migrateMediaLibraryV2({ client: data.client, database: "church" });
  assert.equal(failed.verificationResult, "failed");
  assert.equal(failed.schemaVersionResult, "not_set");
  assert.equal(data.docs.has(MEDIA_LIBRARY_META_ID), false);
  data.allowVerification();
  const retry = await migrateMediaLibraryV2({ client: data.client, database: "church" });
  assert.equal(retry.verificationResult, "passed");
  assert.equal(retry.schemaVersionResult, "set_v2");
});

test("partial reruns converge to the exact changed legacy item set and fields", async () => {
  const data = fixture(0);
  data.setLegacyList([
    { id: "a", name: "A", type: "image", optional: "remove on retry" },
    { id: "b", name: "B", type: "image" },
    { id: "c", name: "C", type: "image" },
  ]);
  data.failSecondBatch();
  const partial = await migrateMediaLibraryV2({ client: data.client, database: "church", batchSize: 2 });
  assert.equal(partial.schemaVersionResult, "not_set");
  assert.equal(data.docs.has("media-item:a"), true);
  assert.equal(data.docs.has("media-item:b"), true);

  data.setLegacyList([
    { id: "a", name: "A current", type: "image" },
    { id: "c", name: "C current", type: "image" },
    { id: "d", name: "D new", type: "image" },
  ]);
  const retry = await migrateMediaLibraryV2({ client: data.client, database: "church" });

  assert.equal(retry.verificationResult, "passed");
  assert.equal(retry.docsDeleted, 1);
  assert.equal(data.docs.has("media-item:b"), false);
  assert.deepEqual(
    [...data.docs.values()]
      .filter((doc) => doc.docType === "mediaItem")
      .map(({ id, name, optional }) => ({ id, name, optional }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "a", name: "A current", optional: undefined },
      { id: "c", name: "C current", optional: undefined },
      { id: "d", name: "D new", optional: undefined },
    ],
  );
  assert.equal(retry.schemaVersionResult, "set_v2");
});

test("splits HTTP 413 batches down to individual documents", async () => {
  const data = fixture(5);
  data.rejectOversizedBatches();

  const report = await migrateMediaLibraryV2({ client: data.client, database: "church", batchSize: 4 });

  assert.equal(report.schemaVersionResult, "set_v2");
  assert.equal(report.blocked, false);
  assert.ok(data.calls.filter(([kind]) => kind === "post").some(([, , docs]) => docs.length === 1));
});

test("marks the migration blocked when CouchDB rejects a single item with HTTP 413", async () => {
  const data = fixture(1);
  data.rejectSingleDocument();

  const report = await migrateMediaLibraryV2({ client: data.client, database: "church" });

  assert.equal(report.blocked, true);
  assert.match(report.blockedReason, /HTTP 413/);
  assert.equal(report.schemaVersionResult, "not_set");
  assert.equal(data.docs.has(MEDIA_LIBRARY_META_ID), false);
});

test("dry run reports counts without creating v2 documents", async () => {
  const data = fixture(MEDIA_MIGRATION_BATCH_SIZE + 1);
  const report = await migrateMediaLibraryV2({ client: data.client, database: "church", dryRun: true });
  assert.equal(report.legacyCount, MEDIA_MIGRATION_BATCH_SIZE + 1);
  assert.equal(report.verificationResult, "skipped_dry_run");
  assert.equal(data.docs.size, 0);
  assert.equal(data.calls.some(([kind]) => kind === "post" || kind === "put"), false);
});
