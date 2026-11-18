import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import PouchDB from "pouchdb-browser";
import memoryAdapter from "pouchdb-adapter-memory";
import cordovaSqliteAdapter from "pouchdb-adapter-cordova-sqlite";
import type { DBItem } from "@worshipsync/types";
import { discoverSongLibrary } from "@worshipsync/utils/songLibraryDiscovery";
import { serializeSongToV2Documents } from "@worshipsync/utils/songPersistence";
import { filterAndSortSongsForSearchWithEnrichment } from "@worshipsync/utils/songSearchUtils";
import { libraryServicePlanSongRef } from "@worshipsync/integrations/servicePlanning/formatSongTitleWithKey";
import { requireNativeSqliteRuntime } from "../src/db/platformChecks";
import { hydrateSongFromLocalDatabase, readSongLibrary } from "../src/db/library";
import {
  assertSafeOutboundTestIds,
  BOARD_REMOTE_DB,
  CONTENT_REMOTE_DB,
  DEMO_TENANT,
  MOBILE_TEST_DOCUMENT_PREFIX,
  establishCouchSession,
  outboundTestReplicationOptions,
  readOnlyReplicationOptions,
} from "../src/db/remote";
import { assertRegisteredTestDocument, createRemoteTestDocument, inspectRemoteTestDocumentConflicts, saveLocalPersistenceSample } from "../src/db/testDocuments";

PouchDB.plugin(memoryAdapter);
PouchDB.plugin(cordovaSqliteAdapter);

const databases: PouchDB.Database[] = [];
const createMemoryDb = () => {
  const db = new PouchDB(`mobile-poc-test-${crypto.randomUUID()}`, { adapter: "memory" });
  databases.push(db);
  return db;
};

before(() => assert.equal(PouchDB.version.split(".")[0], "9"));
after(async () => Promise.all(databases.map((db) => db.destroy())));

test("native runtime selection fails clearly without Capacitor and SQLite plugin APIs", () => {
  assert.throws(() => requireNativeSqliteRuntime({ platform: "web", isNative: false, sqlitePluginAvailable: false }), /Native SQLite is unavailable/);
  assert.throws(() => requireNativeSqliteRuntime({ platform: "android", isNative: true, sqlitePluginAvailable: false }), /Refusing to use WebSQL or IndexedDB/);
  assert.doesNotThrow(() => requireNativeSqliteRuntime({ platform: "android", isNative: true, sqlitePluginAvailable: true }));
  assert.doesNotThrow(() => requireNativeSqliteRuntime({ platform: "ios", isNative: true, sqlitePluginAvailable: true }));
});

test("Cordova SQLite adapter registers with PouchDB 9 and calls the native plugin API", async () => {
  const originalCapacitor = (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;
  const originalSqlitePlugin = (globalThis as typeof globalThis & { sqlitePlugin?: unknown }).sqlitePlugin;
  let receivedOptions: Record<string, unknown> | null = null;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  Object.assign(globalThis, {
    Capacitor: { isNativePlatform: () => true },
    sqlitePlugin: {
      openDatabase: (options: Record<string, unknown>) => {
        receivedOptions = options;
        throw new Error("native plugin probe");
      },
    },
  });
  try {
    const db = new PouchDB(`native-adapter-probe-${crypto.randomUUID()}.db`, {
      adapter: "cordova-sqlite",
      iosDatabaseLocation: "Library",
    });
    await assert.rejects(db.info(), /native plugin probe/);
    assert.ok(receivedOptions);
    assert.equal((receivedOptions as Record<string, unknown> | null)?.iosDatabaseLocation, "Library");
  } finally {
    console.error = originalConsoleError;
    if (originalCapacitor === undefined) delete (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;
    else Object.assign(globalThis, { Capacitor: originalCapacitor });
    if (originalSqlitePlugin === undefined) delete (globalThis as typeof globalThis & { sqlitePlugin?: unknown }).sqlitePlugin;
    else Object.assign(globalThis, { sqlitePlugin: originalSqlitePlugin });
  }
});

test("remote database names and board selector are locked to demo", () => {
  assert.equal(DEMO_TENANT, "demo");
  assert.equal(CONTENT_REMOTE_DB, "worship-sync-demo");
  assert.equal(BOARD_REMOTE_DB, "worship-sync-boards");
  assert.deepEqual(readOnlyReplicationOptions("boards").selector, { database: "demo" });
  assert.deepEqual(readOnlyReplicationOptions("content").selector, { _id: { $ne: "media" } });
  assert.equal(readOnlyReplicationOptions("content").live, true);
  assert.equal(readOnlyReplicationOptions("content").retry, true);
});

test("CouchDB session creation requires an authenticated demo tenant first", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, credentials: init?.credentials });
    return Response.json(url.endsWith("api/auth/me")
      ? { authenticated: true, database: "another-tenant" }
      : { success: true });
  };
  try {
    await assert.rejects(establishCouchSession("https://api.example.test/"), /locked to the demo tenant/);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /api\/auth\/me$/);
    assert.equal(requests[0].credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CouchDB session is established only after the signed-in tenant is verified as demo", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, credentials: init?.credentials });
    return Response.json(url.endsWith("api/auth/me")
      ? { authenticated: true, database: "demo" }
      : { success: true });
  };
  try {
    await establishCouchSession("https://api.example.test/");
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /api\/auth\/me$/);
    assert.match(requests[1].url, /api\/getDbSession$/);
    assert.ok(requests.every((request) => request.credentials === "include"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("outbound replication permits only exact, namespaced test document IDs", () => {
  const id = `${MOBILE_TEST_DOCUMENT_PREFIX}test-123`;
  assert.deepEqual(outboundTestReplicationOptions([id]), { doc_ids: [id], retry: false });
  assert.deepEqual(assertSafeOutboundTestIds([id]), [id]);
  assert.throws(() => outboundTestReplicationOptions(["existing-demo-song"]), /restricted to IDs/);
  assert.throws(() => outboundTestReplicationOptions([]), /Select a mobile POC test document/);
  assert.throws(() => outboundTestReplicationOptions([id, id]), /unique/);
});

test("local sample supports SQLite-style create, read, update and delete calls", async () => {
  const db = createMemoryDb();
  const first = await saveLocalPersistenceSample(db) as PouchDB.Core.ExistingDocument<{ saveNumber: number }>;
  assert.equal(first.saveNumber, 1);
  assert.equal((await db.get(first._id))._rev, first._rev);
  const second = await saveLocalPersistenceSample(db) as PouchDB.Core.ExistingDocument<{ saveNumber: number }>;
  assert.equal(second.saveNumber, 2);
  await db.remove(second);
  await assert.rejects(db.get(second._id), (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 404));
});

test("existing song-v2 discovery, projection, lyrics search and service-plan reference work", () => {
  const v2Documents = serializeSongToV2Documents({
    _id: "mobile-poc-song-v2",
    type: "song",
    name: "Living Hope",
    selectedArrangement: 0,
    songMetadata: { artistName: "Phil Wickham", key: "A" },
    arrangements: [{
      id: "main",
      name: "Main",
      formattedLyrics: [{ words: "How great the chasm that lay between us" }],
      songOrder: [],
      slides: [{ id: "verse-1", type: "Verse", name: "Verse 1", boxes: [] }],
    }],
    slides: [],
  } as unknown as DBItem);
  const legacySong = { _id: "mobile-poc-legacy-song", type: "song", name: "Old Hymn", arrangements: [{ formattedLyrics: [{ words: "Be thou my vision" }] }] } as DBItem;
  const result = discoverSongLibrary([legacySong, v2Documents.root, ...v2Documents.arrangements]);
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.songs.map((song) => song._id).sort(), [legacySong._id, v2Documents.root.songId].sort());
  assert.equal(result.songs.find((song) => song._id === v2Documents.root.songId)?.arrangements?.[0]?.slides?.length, 0);
  assert.equal(filterAndSortSongsForSearchWithEnrichment(result.songs, "great the chasm")[0]?.song._id, v2Documents.root.songId);
  assert.equal(filterAndSortSongsForSearchWithEnrichment(result.songs, "be thou my vision")[0]?.song._id, legacySong._id);
  assert.deepEqual(libraryServicePlanSongRef(result.songs.find((song) => song._id === v2Documents.root.songId)!), {
    kind: "library",
    songId: "mobile-poc-song-v2",
    songName: "Living Hope",
    key: "A",
  });
});

test("the local library reader pages legacy and song-v2 rows, then hydrates the selected song", async () => {
  const db = createMemoryDb();
  const v2Documents = serializeSongToV2Documents({
    _id: "mobile-poc-hydration-song",
    type: "song",
    name: "Hydrated Hope",
    selectedArrangement: 0,
    arrangements: [{
      id: "main",
      name: "Main",
      formattedLyrics: [{ words: "Hope has a name" }],
      songOrder: [],
      slides: [{ id: "slide-one", type: "Verse", name: "Verse 1", boxes: [] }],
    }],
    slides: [],
  } as unknown as DBItem);
  const legacySong = { _id: "mobile-poc-hydration-legacy", type: "song", name: "Legacy Grace" } as DBItem;
  await db.bulkDocs([legacySong, v2Documents.root, ...v2Documents.arrangements, ...v2Documents.slides]);
  const snapshot = await readSongLibrary(db);
  assert.equal(snapshot.sourceDocumentCount, 1 + 1 + v2Documents.arrangements.length + v2Documents.slides.length);
  assert.deepEqual(snapshot.songs.map((song) => song._id).sort(), [legacySong._id, v2Documents.root.songId].sort());
  const hydrated = await hydrateSongFromLocalDatabase(db, v2Documents.root.songId);
  assert.equal(hydrated.arrangements?.[0]?.formattedLyrics?.[0]?.words, "Hope has a name");
  assert.equal(hydrated.arrangements?.[0]?.slides?.[0]?.name, "Verse 1");
});

test("legacy fallback remains available when a v2 activation root is rolled back", () => {
  const v2Documents = serializeSongToV2Documents({
    _id: "mobile-poc-rollback-song",
    type: "song",
    name: "Rollback Song",
    arrangements: [{ id: "main", name: "Main", formattedLyrics: [], songOrder: [], slides: [] }],
    slides: [],
  } as unknown as DBItem);
  const legacySong = { _id: v2Documents.root.songId, type: "song", name: "Legacy Rollback Song" } as DBItem;
  const whileV2Incomplete = discoverSongLibrary([legacySong, v2Documents.root]);
  assert.deepEqual(whileV2Incomplete.songs, []);
  assert.equal(whileV2Incomplete.diagnostics.length, 1);
  const afterRootRollback = discoverSongLibrary([legacySong]);
  assert.deepEqual(afterRootRollback, { songs: [legacySong], diagnostics: [] });
});

test("song-v2 deletion tombstone suppresses stale legacy fallback", () => {
  const v2Documents = serializeSongToV2Documents({
    _id: "mobile-poc-deleted-song",
    type: "song",
    name: "Removed Song",
    selectedArrangement: 0,
    arrangements: [{ id: "main", name: "Main", formattedLyrics: [], songOrder: [], slides: [] }],
    slides: [],
  } as unknown as DBItem);
  v2Documents.root.deletedAt = "2026-11-01T00:00:00.000Z";
  const result = discoverSongLibrary([
    { _id: v2Documents.root.songId, type: "song", name: "Stale legacy copy" },
    v2Documents.root,
    ...v2Documents.arrangements,
  ]);
  assert.deepEqual(result, { songs: [], diagnostics: [] });
});

test("PouchDB leaves concurrent test-document revisions available for conflict inspection", async () => {
  const db = createMemoryDb();
  const id = await createRemoteTestDocument(db);
  const original = await db.get(id);
  const rootRevisionId = original._rev.split("-")[1];
  await db.bulkDocs([
    { _id: id, _rev: `2-mobile`, _revisions: { start: 2, ids: ["mobile", rootRevisionId] }, type: "worshipsync-mobile-poc-test", tenant: "demo", mobileText: "mobile" },
    { _id: id, _rev: `2-desktop`, _revisions: { start: 2, ids: ["desktop", rootRevisionId] }, type: "worshipsync-mobile-poc-test", tenant: "demo", desktopText: "desktop" },
  ], { new_edits: false });
  const inspected = await inspectRemoteTestDocumentConflicts(db, id);
  assert.equal(inspected.id, id);
  assert.equal(inspected.conflicts.length, 1);
  assert.ok(inspected.conflicts[0].startsWith("2-"));
});

test("a desktop-created namespaced demo document can be received and inspected without enabling mobile push", async () => {
  const db = createMemoryDb();
  const id = `${MOBILE_TEST_DOCUMENT_PREFIX}desktop-${crypto.randomUUID()}`;
  await db.put({ _id: id, type: "worshipsync-mobile-poc-test", tenant: "demo", desktopText: "Desktop-created test." });
  const inspected = await inspectRemoteTestDocumentConflicts(db, id);
  assert.equal(inspected.id, id);
  assert.throws(() => assertRegisteredTestDocument(id), /created on this device/);
});
