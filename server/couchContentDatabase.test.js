import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureWorshipSyncContentDatabase,
  toWorshipSyncContentDbName,
} from "./couchContentDatabase.js";

test("toWorshipSyncContentDbName prefixes worship-sync-", () => {
  assert.equal(
    toWorshipSyncContentDbName("church_abc"),
    "worship-sync-church_abc",
  );
});

test("toWorshipSyncContentDbName leaves an already-prefixed name alone", () => {
  assert.equal(
    toWorshipSyncContentDbName("worship-sync-eliathah"),
    "worship-sync-eliathah",
  );
});

test("toWorshipSyncContentDbName rejects unsafe keys", () => {
  assert.throws(() => toWorshipSyncContentDbName("../evil"), /Invalid/);
  assert.throws(() => toWorshipSyncContentDbName(""), /Invalid/);
  assert.throws(() => toWorshipSyncContentDbName("has space"), /Invalid/);
});

test("ensureWorshipSyncContentDatabase PUTs the remote database", async () => {
  const calls = [];
  const request = async (options) => {
    calls.push(options);
    return { status: 201, data: { ok: true } };
  };

  const result = await ensureWorshipSyncContentDatabase("church_new", {
    host: "db.example.com",
    user: "admin",
    password: "secret",
    request,
  });

  assert.equal(result.dbName, "worship-sync-church_new");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, "https://db.example.com/worship-sync-church_new");
  assert.match(calls[0].headers.Authorization, /^Basic /);
});

test("ensureWorshipSyncContentDatabase treats 412 as already present", async () => {
  const request = async () => {
    const error = new Error("Precondition Failed");
    error.response = { status: 412, data: { error: "file_exists" } };
    throw error;
  };

  const result = await ensureWorshipSyncContentDatabase("church_existing", {
    host: "db.example.com",
    user: "admin",
    password: "secret",
    request,
  });

  assert.equal(result.dbName, "worship-sync-church_existing");
  assert.equal(result.created, false);
});

test("ensureWorshipSyncContentDatabase fails closed when CouchDB is unset", async () => {
  await assert.rejects(
    () =>
      ensureWorshipSyncContentDatabase("church_x", {
        host: "",
        user: "admin",
        password: "secret",
        request: async () => {
          throw new Error("should not call");
        },
      }),
    /not configured/i,
  );
});
