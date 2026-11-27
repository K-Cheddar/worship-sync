import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptChangeFeedPage,
  createChangeFeedState,
  createInspectorReport,
  isReadOnlyRequestAllowed,
  normalizeDatabaseName,
  parseArgs,
} from "./inspect-couchdb-revisions.mjs";

test("request allowlist permits only reads and the read-only bulk-get endpoint", () => {
  assert.equal(isReadOnlyRequestAllowed("GET", "_all_docs"), true);
  assert.equal(isReadOnlyRequestAllowed("POST", "_bulk_get"), true);
  assert.equal(isReadOnlyRequestAllowed("POST", "_bulk_docs"), false);
  assert.equal(isReadOnlyRequestAllowed("DELETE", "_purge"), false);
});

test("database keys are normalized without accepting URL-like input", () => {
  assert.equal(normalizeDatabaseName("Eliathah"), "worship-sync-eliathah");
  assert.equal(normalizeDatabaseName("worship-sync-eliathah"), "worship-sync-eliathah");
  assert.throws(() => normalizeDatabaseName("https://example.test/db"), /database key/);
});

test("options enforce bounded page sizes and worker concurrency", () => {
  const args = parseArgs([
    "--database", "eliathah",
    "--page-size", "50",
    "--bulk-get-size", "75",
    "--concurrency", "3",
    "--tail-revisions", "350",
  ]);
  assert.equal(args.database, "worship-sync-eliathah");
  assert.equal(args.pageSize, 50);
  assert.equal(args.bulkGetSize, 75);
  assert.equal(args.concurrency, 3);
  assert.throws(() => parseArgs(["--database", "eliathah", "--concurrency", "20"]), /from 1 to 4/);
});

test("feed rows, unique documents and leaf revisions retain distinct counts and sequence order", () => {
  const state = createChangeFeedState(2);
  acceptChangeFeedPage(state, [
    { id: "song-alpha", seq: 10, changes: [{ rev: "1-a" }] },
    { id: "song-beta", seq: 11, changes: [{ rev: "1-b" }] },
  ]);
  acceptChangeFeedPage(state, [
    { id: "song-alpha", seq: { shard: 12 }, changes: [{ rev: "2-c" }, { rev: "1-a" }] },
    { id: "media", seq: 13, changes: [{ rev: "1-media" }] },
  ]);

  assert.equal(state.feedRowCount, 4);
  assert.equal(state.latestLeafRevisionsById.size, 2);
  assert.equal(state.latestLeafRevisionsById.get("song-alpha").length, 2);
  assert.equal(state.uniqueRevisionCount, 3);
  assert.deepEqual(state.lastRevisionWindow.map(({ id, rev }) => [id, rev]), [
    ["song-beta", "1-b"],
    ["song-alpha", "2-c"],
  ]);
  assert.equal(state.lastRevisionWindow[1].sequence, '{"shard":12}');
});

test("reports hash document IDs by default and never emits document bodies", () => {
  const changes = createChangeFeedState(2);
  acceptChangeFeedPage(changes, [
    { id: "song-secret-title", seq: 10, changes: [{ rev: "1-a" }] },
  ]);
  const report = createInspectorReport({
    database: "worship-sync-eliathah",
    databaseInfo: { doc_count: 1, update_seq: 10, compact_running: false },
    changes,
    activeRevisionsById: new Map([["song-secret-title", "1-a"]]),
    summaries: new Map([["song-secret-title", {
      id: "song-secret-title",
      type: "song",
      leafRevisionCount: 1,
      fetchedRevisionBodies: 1,
      missingRevisionBodies: 0,
      activeLeafRevisions: 1,
      deletedLeafRevisions: 0,
      maxRevisionGeneration: 1,
      maxRevisionHistoryDepth: 1,
      maxRevisionHistoryBytes: 20,
      totalRevisionHistoryBytes: 20,
      largestRevisionPayloadBytes: 100,
      totalLeafPayloadBytes: 100,
      attachmentCount: 0,
      attachmentBytes: 0,
      embeddedMediaCount: 0,
      embeddedMediaBytes: 0,
      activeDocument: true,
      firstSeenFeedRow: 0,
      lastSeenFeedRow: 0,
      _seenRevisions: new Set(["1-a"]),
    }]]),
    requestedTailCount: 350,
    topCount: 15,
    includeDocumentIds: false,
    missingBodies: 0,
    bulkGetCalls: 1,
    elapsedMs: 20,
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.documentIdsIncluded, false);
  assert.equal(serialized.includes("song-secret-title"), false);
  assert.equal(serialized.includes("lyrics"), false);
  assert.equal(report.changesFeed.feedRows, 1);
  assert.equal(report.changesFeed.currentLeafRevisions, 1);
  assert.equal(report.payloads.largestSerializedRevisionBodies[0].type, "song");
});

test("exact document IDs are opt-in for local correlation", () => {
  const changes = createChangeFeedState(1);
  acceptChangeFeedPage(changes, [
    { id: "song-local-title", seq: 1, changes: [{ rev: "1-a" }] },
  ]);
  const report = createInspectorReport({
    database: "worship-sync-eliathah",
    databaseInfo: {},
    changes,
    activeRevisionsById: new Map(),
    summaries: new Map(),
    requestedTailCount: 1,
    topCount: 1,
    includeDocumentIds: true,
    missingBodies: 0,
    bulkGetCalls: 0,
    elapsedMs: 1,
  });
  assert.equal(report.documentIdsIncluded, true);
  assert.equal(JSON.stringify(report).includes("song-local-title"), true);
});
