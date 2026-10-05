import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateSongDatabaseToV2,
  migrateSongToV2,
} from "./songSchemaV2Migration.js";
import { resolveContentMigrationDatabases } from "./contentDatabaseMigration.js";
import { getSongV2RootDocId, serializeSongToV2Documents } from "../client/src/utils/songV2Codec.ts";

const notFound = () => Object.assign(new Error("missing"), { response: { status: 404 } });
const baseSong = (id = "song-1") => ({
  _id: id,
  _rev: "1-legacy",
  type: "song",
  name: "Come, Thou Fount",
  selectedArrangement: 0,
  songMetadata: { author: "Robert Robinson" },
  songLinks: [{ url: "https://example.test" }],
  songAudio: { id: "audio-1" },
  background: { url: "image" },
  shouldSendTo: ["projector"],
  shouldSkipTitle: true,
  slides: [],
  arrangements: [{
    id: "modern",
    name: "Modern",
    formattedLyrics: [{ words: "Verse one" }],
    songOrder: ["verse"],
    monitorLayout: { currentFontSizePx: 26, nextFontSizePx: 24 },
    slides: [{ id: "s1", boxes: [{ words: "Verse one" }], monitorCurrentBandBoxes: [{ fontSize: 20 }] }],
  }],
});

const memoryClient = (legacySongs = []) => {
  const docs = new Map(legacySongs.map((song) => [song._id, structuredClone(song)]));
  const calls = [];
  const behavior = { failChildren: false, failSecondBulk: false, failVerification: false, failActiveVerification: false, activeVerificationFailed: false, changeSourceAfterChild: false, changeSourceAfterRoot: false, changeRootRevisionAfterPublish: false, concurrentRootOnPut: null, omitRootRevision: false, failRootRevisionFetch: false, failRoot: false, rejectLargeBatch: false, rejectSingle: false };
  const decodeUrl = (url) => decodeURIComponent(url.split("?")[0].split("/").at(-1));
  const client = {
    get: async (url) => {
      calls.push(["get", url]);
      if (url.includes("/_all_docs")) {
        const query = new URLSearchParams(url.split("?")[1]);
        const start = query.get("startkey");
        const end = query.get("endkey");
        const prefix = start ? JSON.parse(start) : "";
        const endKey = end ? JSON.parse(end) : "\uffff";
        const rows = [...docs.entries()].sort(([a], [b]) => a.localeCompare(b))
          .filter(([id]) => id >= prefix && id <= endKey)
          .map(([id, doc]) => ({ id, doc: structuredClone(doc) }));
        if (behavior.failVerification && rows.some((row) => row.doc.docType === "song-v2-slide")) {
          const row = rows.find((entry) => entry.doc.docType === "song-v2-slide");
          row.doc.boxes = [];
        }
        return { data: { rows } };
      }
      const doc = docs.get(decodeUrl(url));
      if (behavior.failRootRevisionFetch && doc?.docType === "song-v2-root") throw new Error("root revision fetch failed");
      if (!doc) throw notFound();
      if ((behavior.failVerification || (behavior.activeVerificationFailed && behavior.failActiveVerification)) && doc.docType === "song-v2-slide") return { data: { ...doc, boxes: [] } };
      return { data: structuredClone(doc) };
    },
    post: async (_url, { docs: batch }) => {
      calls.push(["bulk", batch.map((doc) => doc._id)]);
      if (behavior.failChildren) return { data: batch.map((doc) => ({ id: doc._id, error: "forbidden", status: 403 })) };
      if (behavior.failSecondBulk && calls.filter(([kind]) => kind === "bulk").length === 2) {
        return { data: batch.map((doc) => ({ id: doc._id, error: "forbidden", status: 403 })) };
      }
      if (behavior.rejectLargeBatch && batch.length > 1) throw Object.assign(new Error("too large"), { response: { status: 413 } });
      if (behavior.rejectSingle && batch.length === 1) throw Object.assign(new Error("too large"), { response: { status: 413 } });
      const result = [];
      for (const doc of batch) {
        const current = docs.get(doc._id);
        if (doc._rev && current?._rev !== doc._rev) {
          result.push({ id: doc._id, error: "conflict", status: 409 });
          continue;
        }
        if (doc._deleted) docs.delete(doc._id);
        else docs.set(doc._id, { ...structuredClone(doc), _rev: `${Number(current?._rev?.split("-")[0] || 0) + 1}-child` });
        result.push({ id: doc._id, ok: true });
      }
      if (behavior.changeSourceAfterChild) {
        const source = docs.get("song-1");
        docs.set("song-1", { ...source, name: "Changed while migrating", _rev: "2-changed" });
      }
      return { data: result };
    },
    put: async (url, doc) => {
      calls.push(["root", decodeUrl(url)]);
      if (behavior.failRoot) throw new Error("root PUT rejected");
      if (behavior.concurrentRootOnPut) {
        docs.set(decodeUrl(url), structuredClone(behavior.concurrentRootOnPut));
        throw Object.assign(new Error("conflict"), { response: { status: 409 } });
      }
      if (docs.has(decodeUrl(url))) throw Object.assign(new Error("conflict"), { response: { status: 409 } });
      docs.set(decodeUrl(url), { ...structuredClone(doc), _rev: "1-root" });
      if (behavior.changeSourceAfterRoot) {
        const source = docs.get("song-1");
        docs.set("song-1", { ...source, name: "Changed after publication", _rev: "2-changed" });
      }
      if (behavior.changeRootRevisionAfterPublish) {
        const root = docs.get(decodeUrl(url));
        docs.set(decodeUrl(url), { ...root, _rev: "2-root" });
      }
      behavior.activeVerificationFailed = true;
      return { data: behavior.omitRootRevision ? { ok: true } : { ok: true, rev: "1-root" } };
    },
    delete: async (url) => {
      calls.push(["delete", url]);
      const [path, query = ""] = url.split("?");
      const id = decodeUrl(path);
      const current = docs.get(id);
      const rev = new URLSearchParams(query).get("rev");
      if (!current) throw notFound();
      if (current._rev !== rev) throw Object.assign(new Error("conflict"), { response: { status: 409 } });
      docs.delete(id);
      return { data: { ok: true } };
    },
  };
  return { client, docs, calls, behavior };
};

test("content database migration targets normalize, deduplicate, and report invalid keys", () => {
  const result = resolveContentMigrationDatabases([
    { id: "a", data: () => ({ contentDatabaseKey: "Demo" }) },
    { id: "b", data: () => ({ contentDatabaseKey: "worship-sync-DEMO" }) },
    { id: "missing", data: () => ({}) },
    { id: "invalid", data: () => ({ contentDatabaseKey: "../unsafe" }) },
  ]);
  assert.deepEqual(result.databases, ["worship-sync-demo"]);
  assert.deepEqual(result.skippedChurches.map((entry) => entry.churchId), ["missing", "invalid"]);
});

test("the canonical serializer imports and runs in Node without DOM globals", () => {
  assert.equal(typeof globalThis.document, "undefined");
  const docs = serializeSongToV2Documents(baseSong());
  assert.equal(docs.root._id, getSongV2RootDocId("song-1"));
  assert.deepEqual(docs.arrangements[0].monitorLayout, { currentFontSizePx: 26, nextFontSizePx: 24 });
  assert.equal("monitorCurrentBandBoxes" in docs.slides[0], false);
});

test("legacy root slides fill only the selected empty arrangement and preserve multi-arrangement order", async () => {
  const source = baseSong();
  source.arrangements.push({
    id: "acoustic",
    name: "Acoustic",
    formattedLyrics: [{ words: "Acoustic lyric" }],
    songOrder: ["chorus"],
    slides: [],
  });
  source.selectedArrangement = 1;
  source.slides = [{ id: "legacy-slide", boxes: [{ words: "Legacy root" }], monitorNextBandBoxes: [{ fontSize: 22 }] }];
  source.monitorLayout = { currentFontSizePx: 99, nextFontSizePx: 99 };
  source.monitorCurrentBandBoxes = [{ fontSize: 100 }];
  source.monitorNextBandBoxes = [{ fontSize: 101 }];
  const docs = serializeSongToV2Documents(source);
  assert.deepEqual(docs.root.arrangementIds, ["modern", "acoustic"]);
  assert.equal("slides" in docs.root, false);
  assert.equal("monitorLayout" in docs.root, false);
  assert.deepEqual(docs.arrangements[0].formattedLyrics, [{ words: "Verse one" }]);
  assert.deepEqual(docs.arrangements[1].slideIds, ["legacy-slide"]);
  assert.deepEqual(docs.arrangements[1].monitorLayout, { currentFontSizePx: 22, nextFontSizePx: 22 });
  const data = memoryClient([source]);
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: source });
  assert.equal(report.status, "migrated");
  const active = data.docs.get(getSongV2RootDocId(source._id));
  assert.deepEqual(active.songMetadata, source.songMetadata);
  assert.deepEqual(active.songLinks, source.songLinks);
  assert.deepEqual(active.songAudio, source.songAudio);
  assert.deepEqual(active.background, source.background);
  assert.deepEqual(active.shouldSendTo, source.shouldSendTo);
  assert.equal(active.shouldSkipTitle, true);
  assert.deepEqual(data.docs.get("song-1").slides, source.slides);
});

test("dry run reports expected counts and performs no writes", async () => {
  const data = memoryClient([baseSong()]);
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1"), dryRun: true });
  assert.equal(report.status, "dry_run_ready");
  assert.equal(report.arrangementCount, 1);
  assert.equal(report.slideCount, 1);
  assert.deepEqual(report.expectedWrites, { slides: 1, arrangements: 1, staleChildren: 0 });
  assert.equal(data.calls.some(([kind]) => kind === "bulk" || kind === "root"), false);
});

test("single-song targeting reads the exact logical ID and reports a missing target", async () => {
  const data = memoryClient([baseSong()]);
  const report = await migrateSongDatabaseToV2({
    client: data.client,
    database: "worship-sync-demo",
    songId: "song-1",
    dryRun: true,
  });
  assert.equal(report.legacySongCount, 1);
  assert.equal(report.songs[0].songId, "song-1");
  assert.equal(data.calls.some(([, url]) => url.includes("/_all_docs") && !url.includes("startkey=")), false);
  await assert.rejects(
    migrateSongDatabaseToV2({ client: data.client, database: "worship-sync-demo", songId: "missing-song", dryRun: true }),
    /Song missing-song was not found/,
  );
});

test("writes slides and arrangements before root, verifies full output, and leaves v1 unchanged", async () => {
  const source = baseSong();
  const data = memoryClient([source]);
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
  assert.equal(report.status, "migrated");
  assert.equal(report.verificationResult, "passed");
  const rootIndex = data.calls.findIndex(([kind]) => kind === "root");
  const slideWriteIndex = data.calls.findIndex(([kind, ids]) => kind === "bulk" && ids.some((id) => id.startsWith("song-v2:slide:")));
  const arrangementWriteIndex = data.calls.findIndex(([kind, ids]) => kind === "bulk" && ids.some((id) => id.startsWith("song-v2:arrangement:")));
  assert.ok(slideWriteIndex >= 0 && slideWriteIndex < arrangementWriteIndex && arrangementWriteIndex < rootIndex);
  assert.deepEqual(data.docs.get("song-1"), source);
});

test("empty content databases are complete successful no-ops", async () => {
  const data = memoryClient();
  const report = await migrateSongDatabaseToV2({ client: data.client, database: "worship-sync-empty" });
  assert.deepEqual({
    legacySongCount: report.legacySongCount,
    alreadyV2Count: report.alreadyV2Count,
    migratedCount: report.migratedCount,
    blockedCount: report.blockedCount,
    failedCount: report.failedCount,
    complete: report.complete,
  }, { legacySongCount: 0, alreadyV2Count: 0, migratedCount: 0, blockedCount: 0, failedCount: 0, complete: true });
});

test("source changes after root publication roll back activation and rerun from the newest source", async () => {
  const original = baseSong();
  const data = memoryClient([original]);
  const source = structuredClone(data.docs.get("song-1"));
  data.behavior.changeSourceAfterRoot = true;
  const failed = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: source });
  assert.equal(failed.status, "source_changed");
  assert.equal(failed.activationResult, "rolled_back_source_changed");
  assert.equal(data.docs.has(getSongV2RootDocId("song-1")), false);
  assert.deepEqual(data.docs.get("song-1"), { ...source, _rev: "2-changed", name: "Changed after publication" });
  assert.ok(data.docs.has("song-v2:slide:song-1:modern:s1"));

  data.behavior.changeSourceAfterRoot = false;
  const newest = data.docs.get("song-1");
  const rerun = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: newest });
  assert.equal(rerun.status, "migrated");
  assert.equal(data.docs.get(getSongV2RootDocId("song-1")).name, newest.name);
  assert.deepEqual(data.docs.get("song-1"), newest);
});

test("post-publication verification failure deletes only the exact root revision", async () => {
  const data = memoryClient([baseSong()]);
  const source = structuredClone(data.docs.get("song-1"));
  data.behavior.failActiveVerification = true;
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: source });
  assert.equal(report.status, "verification_failed");
  assert.equal(report.activationResult, "rolled_back_verification_failed");
  assert.equal(data.docs.has(getSongV2RootDocId("song-1")), false);
  assert.deepEqual(data.docs.get("song-1"), source);
  assert.ok(data.docs.has("song-v2:slide:song-1:modern:s1"));
});

test("fetches the root revision immediately when CouchDB omits it from the PUT response", async () => {
  const data = memoryClient([baseSong()]);
  data.behavior.omitRootRevision = true;
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
  assert.equal(report.status, "migrated");
  const rootIndex = data.calls.findIndex(([kind]) => kind === "root");
  assert.equal(data.calls[rootIndex + 1][0], "get");
  assert.equal(data.calls[rootIndex + 1][1].endsWith(encodeURIComponent(getSongV2RootDocId("song-1"))), true);
});

test("reports uncertain activation when a published root revision cannot be fetched", async () => {
  const data = memoryClient([baseSong()]);
  data.behavior.omitRootRevision = true;
  data.behavior.failRootRevisionFetch = true;
  const source = structuredClone(data.docs.get("song-1"));
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: source });
  assert.equal(report.status, "activation_uncertain");
  assert.equal(report.activationResult, "activation_uncertain");
  assert.match(report.failures.join(" "), /manual inspection is required/i);
  assert.ok(data.docs.has(getSongV2RootDocId("song-1")));
  assert.deepEqual(data.docs.get("song-1"), source);
});

test("rollback leaves a root changed by another actor and reports activation uncertainty", async () => {
  const data = memoryClient([baseSong()]);
  data.behavior.failActiveVerification = true;
  data.behavior.changeRootRevisionAfterPublish = true;
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
  assert.equal(report.status, "rollback_blocked");
  assert.equal(report.activationResult, "rollback_blocked");
  assert.match(report.failures.join(" "), /Manual inspection is required/);
  assert.equal(data.docs.get(getSongV2RootDocId("song-1"))._rev, "2-root");
  assert.equal(data.calls.some(([kind]) => kind === "delete"), false);
});

test("root PUT conflict accepts a valid concurrently activated root without changing it", async (t) => {
  await t.test("valid concurrent activation", async () => {
    const data = memoryClient([baseSong()]);
    const v2 = serializeSongToV2Documents(baseSong());
    for (const child of [...v2.slides, ...v2.arrangements]) data.docs.set(child._id, { ...child, _rev: "1-child" });
    const concurrentRoot = { ...v2.root, _rev: "1-concurrent" };
    data.behavior.concurrentRootOnPut = concurrentRoot;
    const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
    assert.equal(report.status, "already_v2");
    assert.equal(report.activationResult, "activated_concurrently");
    assert.equal(report.verificationResult, "passed");
    assert.deepEqual(data.docs.get(v2.root._id), concurrentRoot);
    assert.equal(data.calls.some(([kind]) => kind === "delete"), false);
  });
  await t.test("invalid concurrent activation", async () => {
    const data = memoryClient([baseSong()]);
    const invalidRoot = { _id: getSongV2RootDocId("song-1"), docType: "song-v2-root", songId: "song-1", _rev: "1-concurrent" };
    data.behavior.concurrentRootOnPut = invalidRoot;
    const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
    assert.equal(report.status, "verification_failed");
    assert.equal(report.activationResult, "concurrent_root_invalid");
    assert.deepEqual(data.docs.get(invalidRoot._id), invalidRoot);
    assert.equal(data.calls.some(([kind]) => kind === "delete"), false);
  });
});

test("child write, child verification, and source revision failures never publish the root", async (t) => {
  for (const [name, setting] of [["slide write", "failChildren"], ["arrangement write", "failSecondBulk"], ["verification", "failVerification"], ["source revision", "changeSourceAfterChild"]]) {
    await t.test(name, async () => {
      const source = baseSong();
      const data = memoryClient([source]);
      data.behavior[setting] = true;
      const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
      assert.equal(data.docs.has(getSongV2RootDocId("song-1")), false);
      assert.notEqual(report.status, "migrated");
      if (setting !== "changeSourceAfterChild") assert.deepEqual(data.docs.get("song-1"), source);
      else {
        assert.equal(data.docs.get("song-1")._rev, "2-changed");
        assert.equal(data.docs.get("song-1").name, "Changed while migrating");
      }
    });
  }
});

test("root failure leaves verified children and a rerun reconciles current legacy data", async () => {
  const data = memoryClient([baseSong()]);
  data.behavior.failRoot = true;
  const first = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
  assert.equal(first.status, "failed");
  assert.equal(data.docs.has(getSongV2RootDocId("song-1")), false);
  data.behavior.failRoot = false;
  const source = data.docs.get("song-1");
  const changed = { ...source, _rev: "2-legacy", arrangements: [{ ...source.arrangements[0], slides: [{ id: "s2", boxes: [{ words: "Changed" }] }] }] };
  data.docs.set("song-1", changed);
  const oldSlideId = "song-v2:slide:song-1:modern:s1";
  data.docs.set(oldSlideId, { ...(data.docs.get(oldSlideId)), _rev: "2-child", boxes: [{ words: "stale partial" }] });
  const obsoleteId = "song-v2:slide:song-1:modern:obsolete";
  data.docs.set(obsoleteId, { _id: obsoleteId, docType: "song-v2-slide", songId: "song-1", arrangementId: "modern", id: "obsolete", _rev: "1-child" });
  const obsoleteArrangementId = "song-v2:arrangement:song-1:obsolete";
  data.docs.set(obsoleteArrangementId, { _id: obsoleteArrangementId, docType: "song-v2-arrangement", songId: "song-1", arrangementId: "obsolete", slideIds: [], _rev: "1-child" });
  const beforeBulkCount = data.calls.filter(([kind]) => kind === "bulk").length;
  const second = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: changed });
  assert.equal(second.status, "migrated");
  assert.equal(data.docs.has(oldSlideId), false);
  assert.equal(data.docs.has(obsoleteId), false);
  assert.equal(data.docs.has(obsoleteArrangementId), false);
  assert.ok(data.calls.filter(([kind]) => kind === "bulk").length > beforeBulkCount);
});

test("matching partial children are reused on retry after root publication failed", async () => {
  const data = memoryClient([baseSong()]);
  data.behavior.failRoot = true;
  await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
  const writesAfterFirstAttempt = data.calls.filter(([kind]) => kind === "bulk").length;
  data.behavior.failRoot = false;
  const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
  assert.equal(report.status, "migrated");
  assert.equal(data.calls.filter(([kind]) => kind === "bulk").length, writesAfterFirstAttempt);
  assert.deepEqual(report.childrenCreated, { slides: 0, arrangements: 0 });
  assert.deepEqual(report.childrenUpdated, { slides: 0, arrangements: 0 });
});

test("already-v2 roots win over stale legacy and invalid active roots are not rebuilt", async (t) => {
  await t.test("already v2", async () => {
    const data = memoryClient([baseSong()]);
    const docs = serializeSongToV2Documents({ ...baseSong(), name: "Current v2" });
    for (const child of [...docs.slides, ...docs.arrangements]) data.docs.set(child._id, { ...child, _rev: "1-child" });
    data.docs.set(docs.root._id, { ...docs.root, _rev: "1-root" });
    const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
    assert.equal(report.status, "already_v2");
    assert.equal(data.docs.get(docs.root._id).name, "Current v2");
    assert.equal(data.calls.some(([kind]) => kind === "bulk" || kind === "root"), false);
  });
  await t.test("invalid existing root", async () => {
    const data = memoryClient([baseSong()]);
    const docs = serializeSongToV2Documents(baseSong());
    data.docs.set(docs.root._id, { ...docs.root, _rev: "1-root" });
    const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
    assert.equal(report.status, "verification_failed");
    assert.equal(data.calls.some(([kind]) => kind === "bulk" || kind === "root"), false);
  });
});

test("413 batches split and a single oversized document blocks root publication", async (t) => {
  await t.test("batch split", async () => {
    const source = baseSong();
    source.arrangements[0].slides.push({ id: "s2", boxes: [] });
    const data = memoryClient([source]);
    data.behavior.rejectLargeBatch = true;
    const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1"), batchSize: 50 });
    assert.equal(report.status, "migrated");
    assert.ok(data.calls.filter(([kind]) => kind === "bulk").length > 2);
  });
  await t.test("single document", async () => {
    const data = memoryClient([baseSong()]);
    data.behavior.rejectSingle = true;
    const report = await migrateSongToV2({ client: data.client, database: "worship-sync-demo", legacySong: data.docs.get("song-1") });
    assert.equal(report.status, "blocked_oversized_document");
    assert.equal(data.docs.has(getSongV2RootDocId("song-1")), false);
  });
});

test("database migration discovers only legacy type=song and reports invalid identities individually", async () => {
  const duplicate = baseSong("bad-duplicate");
  duplicate.arrangements.push({ ...duplicate.arrangements[0] });
  const data = memoryClient([baseSong(), duplicate]);
  data.docs.set("song-v2:slide:infra", { _id: "song-v2:slide:infra", docType: "song-v2-slide" });
  const report = await migrateSongDatabaseToV2({ client: data.client, database: "worship-sync-demo", dryRun: true });
  assert.equal(report.legacySongCount, 2);
  assert.equal(report.songs.filter((song) => song.status === "dry_run_ready").length, 1);
  assert.equal(report.songs.find((song) => song.songId === "bad-duplicate").status, "blocked_invalid_ids");
  assert.equal(data.calls.some(([kind]) => kind === "bulk" || kind === "root"), false);
});

test("invalid arrangement and slide identities block only their own songs", async () => {
  const cases = [
    ["duplicate-arrangement", (song) => song.arrangements.push({ ...song.arrangements[0] })],
    ["missing-arrangement", (song) => { song.arrangements[0].id = ""; }],
    ["duplicate-slide", (song) => song.arrangements[0].slides.push({ ...song.arrangements[0].slides[0] })],
    ["missing-slide", (song) => { song.arrangements[0].slides[0].id = ""; }],
  ];
  for (const [id, mutate] of cases) {
    const invalid = baseSong(id);
    mutate(invalid);
    const data = memoryClient([invalid, baseSong(`${id}-valid`)]);
    const report = await migrateSongDatabaseToV2({ client: data.client, database: "worship-sync-demo", dryRun: true });
    assert.equal(report.songs.find((song) => song.songId === id).status, "blocked_invalid_ids");
    assert.equal(report.songs.find((song) => song.songId === `${id}-valid`).status, "dry_run_ready");
  }
});
