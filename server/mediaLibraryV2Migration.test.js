import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_LIBRARY_META_ID,
  MEDIA_MIGRATION_BATCH_SIZE,
  migrateMediaLibraryV2,
} from "./mediaLibraryV2Migration.js";

const notFound = () => Object.assign(new Error("missing"), { response: { status: 404 } });

const fixture = (count = 3) => {
  const docs = new Map();
  const list = Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    name: `Media ${index}`,
    background: `https://assets.invalid/${index}`,
    type: "image",
  }));
  const folders = [{ id: "folder-1", name: "Worship", parentId: null }];
  const legacy = { _id: "media", list, folders };
  const calls = [];
  let failBatch = false;
  let failVerification = false;
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
          .map((doc) => ({ doc }));
        if (failVerification && rows.length) rows[0].doc = { ...rows[0].doc, name: "unexpected" };
        return { data: { rows } };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
    post: async (url, body) => {
      calls.push(["post", url, body.docs]);
      if (failBatch) return { data: [{ error: "forbidden" }] };
      body.docs.forEach((doc) => docs.set(doc._id, { ...doc, _rev: "1-test" }));
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
  data.calls.length = 0;
  const report = await migrateMediaLibraryV2({ client: data.client, database: "church" });
  assert.equal(report.schemaVersionResult, "already_v2");
  assert.equal(data.calls.some(([kind]) => kind === "post"), false);
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

test("dry run reports counts without creating v2 documents", async () => {
  const data = fixture(MEDIA_MIGRATION_BATCH_SIZE + 1);
  const report = await migrateMediaLibraryV2({ client: data.client, database: "church", dryRun: true });
  assert.equal(report.legacyCount, MEDIA_MIGRATION_BATCH_SIZE + 1);
  assert.equal(report.verificationResult, "skipped_dry_run");
  assert.equal(data.docs.size, 0);
  assert.equal(data.calls.some(([kind]) => kind === "post" || kind === "put"), false);
});
