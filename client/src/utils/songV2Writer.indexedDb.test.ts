import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItem } from "../types";
import { createSong, deleteSong, loadSong, loadSongV2Snapshot, saveSong, songToLibraryProjection, SongV2DeletedError } from "./songPersistence";
import { createSongV2, persistSongV2CleanupErrors, reconcilePendingSongV2Cleanup, reconcileSongV2Orphans, saveSongV2, saveSongV2FromBaseline } from "./songV2Writer";
import { persistLocalImageCloudCopy } from "./localImageAssets";

const source = (): DBItem => ({
  _id: "real-song", name: "Song", type: "song", selectedArrangement: 0, slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  arrangements: [{
    id: "a", name: "A", formattedLyrics: [], songOrder: [],
    slides: [1, 2, 3].map(n => ({
      id: `s${n}`, name: `Verse ${n}`, type: "Verse",
      boxes: [{ id: `box${n}`, words: `Words ${n}`, width: 1920, height: 1080 }],
    })),
  }],
});
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let sequence = 0;

describe("Song v2 writer with real PouchDB over IndexedDB", () => {
  let db: PouchDB.Database;
  beforeEach(() => {
    sequence += 1;
    db = new PouchDB(`song-v2-writer-${sequence}`, { adapter: "idb" });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.destroy();
  });

  it("independent slide writes survive the same stale baseline, but same-slide writes get a real 409", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const first = copy(baseline.hydrated);
    const second = copy(baseline.hydrated);
    first.arrangements[0].slides[0].boxes[0].words = "First editor";
    second.arrangements[0].slides[1].boxes[0].words = "Second editor";
    await saveSongV2(db, baseline, first);
    await saveSongV2(db, baseline, second);
    const loaded = await loadSongV2Snapshot(db, "real-song");
    expect(loaded.hydrated.arrangements[0].slides.map(doc => doc.boxes[0].words))
      .toEqual(["First editor", "Second editor", "Words 3"]);
    expect(loaded.root._rev).toBe(baseline.root._rev);
    expect(loaded.arrangements[0]._rev).toBe(baseline.arrangements[0]._rev);
    expect(loaded.slides[2]._rev).toBe(baseline.slides[2]._rev);
    const conflicting = copy(baseline.hydrated);
    conflicting.arrangements[0].slides[0].boxes[0].words = "Stale edit";
    await expect(saveSongV2(db, baseline, conflicting)).rejects.toMatchObject({
      status: 409, documentId: baseline.slides[0]._id,
    });
    expect((await loadSongV2Snapshot(db, "real-song")).hydrated.arrangements[0].slides[0].boxes[0].words).toBe("First editor");
  });

  it("rebases only the active editor's changed slide and preserves a remote edit to another slide", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const remote = copy(baseline.hydrated);
    remote.arrangements[0].slides[1].boxes[0].words = "Remote B";
    await saveSongV2(db, baseline, remote);
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides[0].boxes[0].words = "Local A";
    const put = jest.spyOn(db, "put");
    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(result.written).toEqual(["song-v2:slide:real-song:a:s1"]);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual(["song-v2:slide:real-song:a:s1"]);
    expect(result.song.arrangements[0].slides.map(slide => slide.boxes[0].words))
      .toEqual(["Local A", "Remote B", "Words 3"]);
  });

  it("retries a partial slide update against the original baseline without rewriting committed slides", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides.forEach((slide, index) => { slide.boxes[0].words = `Local ${index + 1}`; });
    const originalPut = db.put.bind(db);
    const put = jest.spyOn(db, "put");
    let failed = false;
    put.mockImplementation(async doc => {
      if (doc._id === baseline.slides[1]._id && !failed) {
        failed = true;
        throw new Error("temporary offline failure");
      }
      return originalPut(doc);
    });
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2WriteError", progress: { written: [baseline.slides[0]._id] },
    });
    put.mockClear();

    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([baseline.slides[1]._id, baseline.slides[2]._id]);
    expect(result.song.arrangements[0].slides.map(slide => slide.boxes[0].words)).toEqual(["Local 1", "Local 2", "Local 3"]);
    expect(result.snapshot.slides[0]._rev).not.toBe(baseline.slides[0]._rev);
  });

  it("converges when a slide write commits but its acknowledgement is lost", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides[0].boxes[0].words = "Local A";
    const originalPut = db.put.bind(db);
    const put = jest.spyOn(db, "put");
    let lostAcknowledgement = false;
    put.mockImplementation(async doc => {
      const response = await originalPut(doc);
      if (doc._id === baseline.slides[0]._id && !lostAcknowledgement) {
        lostAcknowledgement = true;
        throw new Error("connection lost after commit");
      }
      return response;
    });
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2WriteError", progress: { written: [] }, documentId: baseline.slides[0]._id,
    });
    put.mockClear();

    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(put).not.toHaveBeenCalled();
    expect(result.snapshot.slides[0]._rev).not.toBe(baseline.slides[0]._rev);
    expect(result.song.arrangements[0].slides[0].boxes[0].words).toBe("Local A");
  });

  it("skips already-applied root and arrangement updates and returns their current revisions", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const local = copy(baseline.hydrated);
    local.name = "Local title";
    local.arrangements[0].formattedLyrics = [{ type: "Verse", name: "Verse 1", words: "Local lyrics", slideSpan: 1, id: "lyric-1" }];
    const put = jest.spyOn(db, "put");
    // Model a prior interactive attempt that durably wrote both authored documents.
    await saveSongV2FromBaseline(db, baseline.hydrated, local);
    const root = await db.get(baseline.root._id);
    const arrangement = await db.get(baseline.arrangements[0]._id);
    put.mockClear();

    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(put).not.toHaveBeenCalled();
    expect(result.snapshot.root._rev).toBe(root._rev);
    expect(result.snapshot.arrangements[0]._rev).toBe(arrangement._rev);
  });

  it("resumes an exact-match orphan slide and still conflicts on a different orphan", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides.push({ id: "new", name: "New", type: "Verse", boxes: [] } as never);
    const originalPut = db.put.bind(db);
    const put = jest.spyOn(db, "put");
    const orphanDocs = (await import("./songPersistence")).serializeSongToV2Documents(local);
    const orphan = orphanDocs.slides[orphanDocs.slides.length - 1];
    const other = copy(baseline.hydrated);
    other.arrangements[0].slides.push({ id: "different", name: "Different", type: "Verse", boxes: [] } as never);
    const differentDocs = (await import("./songPersistence")).serializeSongToV2Documents(other);
    const differentOrphan = differentDocs.slides[differentDocs.slides.length - 1];
    await db.put({ ...differentOrphan, name: "Someone else's content" } as never);
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, other)).rejects.toMatchObject({
      name: "SongV2ConcurrentEditError", documentId: differentOrphan._id, reason: "already-exists",
    });
    let failManifest = true;
    put.mockImplementation(async doc => {
      if (doc._id === baseline.arrangements[0]._id && failManifest) {
        failManifest = false;
        throw new Error("manifest temporarily offline");
      }
      return originalPut(doc);
    });
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2WriteError", progress: { created: [orphan._id] },
    });
    put.mockClear();
    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([orphan._id, baseline.arrangements[0]._id]);
    expect(result.snapshot.slides.some(slide => slide._id === orphan._id)).toBe(true);

  });

  it("resumes an exact-match orphan arrangement and its slides after root publication fails", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const local = copy(baseline.hydrated);
    local.arrangements.push({ id: "new", name: "New", formattedLyrics: [], songOrder: [], slides: [
      { id: "new-slide", name: "New slide", type: "Verse", boxes: [] },
    ] });
    const originalPut = db.put.bind(db);
    const put = jest.spyOn(db, "put");
    let failed = false;
    put.mockImplementation(async doc => {
      if (doc._id === baseline.root._id && !failed) {
        failed = true;
        throw new Error("root publication failed");
      }
      return originalPut(doc);
    });
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2WriteError", progress: { created: ["song-v2:slide:real-song:new:new-slide", "song-v2:arrangement:real-song:new"] },
    });
    put.mockClear();

    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([
      "song-v2:slide:real-song:new:new-slide",
      "song-v2:arrangement:real-song:new",
      baseline.root._id,
    ]);
    expect(result.song.arrangements.map(arrangement => arrangement.id)).toEqual(["a", "new"]);
    expect(result.song.arrangements[1].slides[0].id).toBe("new-slide");
  });

  it("recognizes completed manifest-backed deletes and rejects a missing referenced slide", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const removedArrangement = copy(baseline.hydrated);
    removedArrangement.arrangements = [];
    const put = jest.spyOn(db, "put");
    await saveSongV2(db, baseline, removedArrangement);
    put.mockClear();
    const retry = await saveSongV2FromBaseline(db, baseline.hydrated, removedArrangement);
    expect(put).not.toHaveBeenCalled();
    expect(retry.snapshot.root._rev).not.toBe(baseline.root._rev);
    expect(retry.snapshot.arrangements).toEqual([]);
    expect(retry.snapshot.slides).toEqual([]);

    const secondSong = source();
    secondSong._id = "other-song";
    await createSongV2(db, secondSong);
    const secondBaseline = await loadSongV2Snapshot(db, "other-song");
    const removeFirstSlide = copy(secondBaseline.hydrated);
    removeFirstSlide.arrangements[0].slides.shift();
    await db.remove(secondBaseline.slides[0]._id, secondBaseline.slides[0]._rev!);
    put.mockClear();
    await expect(saveSongV2FromBaseline(db, secondBaseline.hydrated, removeFirstSlide)).rejects.toMatchObject({
      name: "SongV2DocumentError",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("retries cleanup of an unchanged physical child after its manifest was removed", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const desired = copy(baseline.hydrated);
    desired.arrangements = [];
    const originalRemove = db.remove.bind(db);
    const remove = jest.spyOn(db, "remove");
    let failArrangementCleanup = true;
    remove.mockImplementation(async (id, rev) => {
      if (id === baseline.arrangements[0]._id && failArrangementCleanup) {
        failArrangementCleanup = false;
        throw new Error("temporary cleanup failure");
      }
      return originalRemove(id, rev);
    });
    const first = await saveSongV2(db, baseline, desired);
    expect(first.cleanupErrors.map(error => error.documentId)).toContain(baseline.arrangements[0]._id);
    expect(first.snapshot.root.arrangementIds).toEqual([]);
    expect(await db.get(baseline.root._id)).toMatchObject({ arrangementIds: [] });
    expect(await db.get(baseline.arrangements[0]._id)).toMatchObject({ _rev: baseline.arrangements[0]._rev });
    remove.mockClear();

    const retry = await saveSongV2FromBaseline(db, baseline.hydrated, desired);
    expect(remove.mock.calls.map(([id]) => id)).toEqual([baseline.arrangements[0]._id]);
    expect(retry.snapshot.arrangements).toEqual([]);
    await expect(db.get(baseline.arrangements[0]._id)).rejects.toMatchObject({ status: 404 });
  });

  it("routes the normal repository save API through the baseline-aware writer", async () => {
    await createSongV2(db, source());
    const baseline = await loadSong(db, "real-song");
    const desired = copy(baseline);
    desired.name = "Renamed";
    const result = await saveSong(db, desired, baseline);
    expect(result.name).toBe("Renamed");
    expect((await db.get("song-v2:root:real-song") as any).name).toBe("Renamed");
    const projection = songToLibraryProjection(result);
    expect(projection.arrangements[0].slides).toEqual([]);
    expect(projection.slides).toEqual([]);
    await expect(db.get("real-song")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a same-slide remote edit without overwriting it", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const remote = copy(baseline.hydrated);
    remote.arrangements[0].slides[0].boxes[0].words = "Remote A";
    await saveSongV2(db, baseline, remote);
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides[0].boxes[0].words = "Local A";
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2ConcurrentEditError", status: 409,
      songId: "real-song", documentId: "song-v2:slide:real-song:a:s1", documentKind: "slide",
    });
    expect((await loadSongV2Snapshot(db, "real-song")).hydrated.arrangements[0].slides[0].boxes[0].words)
      .toBe("Remote A");
  });

  it.each(["root", "arrangement"] as const)("still conflicts when the same %s unit differs from both baseline and desired", async unit => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const remote = copy(baseline.hydrated);
    const local = copy(baseline.hydrated);
    let documentId: string;
    if (unit === "root") {
      remote.name = "Remote title";
      local.name = "Local title";
      documentId = baseline.root._id;
    } else {
      remote.arrangements[0].formattedLyrics = [{ type: "Verse", name: "Remote", words: "Remote lyrics", slideSpan: 1, id: "remote" }];
      local.arrangements[0].formattedLyrics = [{ type: "Verse", name: "Local", words: "Local lyrics", slideSpan: 1, id: "local" }];
      documentId = baseline.arrangements[0]._id;
    }
    await saveSongV2(db, baseline, remote);
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2ConcurrentEditError", documentId, reason: "changed", documentKind: unit,
    });
  });

  it("keeps root, slide, and separate arrangement conflicts independent", async () => {
    const song = source();
    song.arrangements.push({
      id: "b", name: "B", formattedLyrics: [], songOrder: [],
      slides: [{ id: "b1", name: "B1", type: "Verse", boxes: [{ id: "b-box", words: "B old", width: 1920, height: 1080 }] }],
    });
    await createSongV2(db, song);
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const remote = copy(baseline.hydrated);
    remote.name = "Remote title";
    remote.arrangements[1].name = "Remote B";
    await saveSongV2(db, baseline, remote);
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides[0].boxes[0].words = "Local slide";
    local.arrangements[0].name = "Local A";
    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(result.written).toEqual([
      "song-v2:slide:real-song:a:s1",
      "song-v2:arrangement:real-song:a",
    ]);
    expect(result.song.name).toBe("Remote title");
    expect(result.song.arrangements.map(arrangement => arrangement.name)).toEqual(["Local A", "Remote B"]);
  });

  it("allows a root metadata edit when another editor changed a slide", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const remote = copy(baseline.hydrated);
    remote.arrangements[0].slides[1].boxes[0].words = "Remote slide";
    await saveSongV2(db, baseline, remote);
    const local = copy(baseline.hydrated);
    local.songMetadata = { source: "manual", trackName: "Local metadata", importedAt: "test", artistName: "Local metadata" };
    const result = await saveSongV2FromBaseline(db, baseline.hydrated, local);
    expect(result.written).toEqual(["song-v2:root:real-song"]);
    expect(result.song.arrangements[0].slides[1].boxes[0].words).toBe("Remote slide");
    expect(result.song.songMetadata?.artistName).toBe("Local metadata");
  });

  it("conflicts before deleting a slide that changed remotely", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const remote = copy(baseline.hydrated);
    remote.arrangements[0].slides[0].boxes[0].words = "Remote work";
    await saveSongV2(db, baseline, remote);
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides.shift();
    const put = jest.spyOn(db, "put");
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2ConcurrentEditError", documentId: "song-v2:slide:real-song:a:s1", documentKind: "slide",
    });
    expect(put).not.toHaveBeenCalled();
    expect((await loadSongV2Snapshot(db, "real-song")).hydrated.arrangements[0].slides[0].boxes[0].words).toBe("Remote work");
  });

  it("does not adopt an orphan that collides with an intended deterministic create", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const orphan = {
      _id: "song-v2:slide:real-song:a:new", docType: "song-v2-slide",
      songId: "real-song", arrangementId: "a", id: "new", name: "Different content",
      type: "Verse", boxes: [],
    };
    await db.put(orphan as never);
    const local = copy(baseline.hydrated);
    local.arrangements[0].slides.push({ id: "new", name: "New", type: "Verse", boxes: [] } as never);
    await expect(saveSongV2FromBaseline(db, baseline.hydrated, local)).rejects.toMatchObject({
      name: "SongV2ConcurrentEditError", documentId: orphan._id, reason: "already-exists",
    });
  });

  it("no-op save changes neither update sequence nor any revisions", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const before = await db.info();
    const result = await saveSongV2(db, baseline, copy(baseline.hydrated));
    expect(result.written).toEqual([]);
    expect((await db.info()).update_seq).toBe(before.update_seq);
    expect(await loadSongV2Snapshot(db, "real-song")).toEqual(baseline);
  });

  it("manifested additions load correctly and removal tombstones only the removed child", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const draft = copy(baseline.hydrated);
    draft.arrangements[0].slides.push({
      id: "new", type: "Verse", name: "New", boxes: [{ id: "new-box", words: "New", width: 1920, height: 1080 }],
    });
    const added = await saveSongV2(db, baseline, draft);
    const afterAdd = await loadSongV2Snapshot(db, "real-song");
    expect(afterAdd.slides).toHaveLength(4);
    const removedDraft = copy(afterAdd.hydrated);
    removedDraft.arrangements[0].slides.pop();
    const removed = await saveSongV2(db, afterAdd, removedDraft);
    expect(removed.deleted).toEqual(added.created);
    await expect(db.get(added.created[0])).rejects.toMatchObject({ status: 404 });
    const rows = await db.allDocs({ keys: added.created });
    expect(rows.rows).toEqual([expect.objectContaining({ value: expect.objectContaining({ deleted: true }) })]);
    const final = await loadSongV2Snapshot(db, "real-song");
    expect(final.slides).toHaveLength(3);
    expect(final.root._rev).toBe(baseline.root._rev);
    expect(final.slides.map(doc => doc._rev)).toEqual(baseline.slides.map(doc => doc._rev));
  });

  it("failed root publication leaves legacy reads intact despite persisted orphan children", async () => {
    const legacy = source();
    legacy.name = "Legacy song";
    const persisted = await createSong(db, legacy);
    const put = db.put.bind(db);
    jest.spyOn(db, "put").mockImplementation(async doc => {
      if (doc._id === "song-v2:root:real-song") throw new Error("root publication failed");
      return put(doc);
    });
    await expect(createSongV2(db, source())).rejects.toMatchObject({
      documentId: "song-v2:root:real-song",
      progress: { written: [
        "song-v2:slide:real-song:a:s1", "song-v2:slide:real-song:a:s2",
        "song-v2:slide:real-song:a:s3", "song-v2:arrangement:real-song:a",
      ] },
    });
    expect((await loadSong(db, "real-song")).name).toBe("Legacy song");
    expect((await db.get("real-song"))._rev).toBe(persisted._rev);
    await expect(loadSongV2Snapshot(db, "real-song")).rejects.toMatchObject({ status: 404 });
    expect(await db.get("song-v2:slide:real-song:a:s1")).toEqual(expect.objectContaining({ id: "s1" }));
  });

  it("finalizes a local image cloud copy in the authoritative v2 slide without a legacy document", async () => {
    const legacy = source();
    legacy.arrangements[0].slides[0].boxes[0].mediaInfo = {
      id: "asset-1", type: "image", background: "local-image://asset-1",
      localImage: { id: "asset-1", storagePolicy: "local-only" },
    } as never;
    const persisted = await createSong(db, legacy);
    await createSongV2(db, persisted);
    await db.remove(persisted._id, persisted._rev!);

    await persistLocalImageCloudCopy({
      db, itemId: persisted._id, assetId: "asset-1", mediaId: "media-1",
      url: "https://res.cloudinary.com/example/image/upload/asset-1.png",
    });

    const snapshot = await loadSongV2Snapshot(db, persisted._id);
    expect(snapshot.slides[0].boxes[0].mediaInfo?.localImage).toEqual(expect.objectContaining({
      id: "asset-1", storagePolicy: "local-and-cloud", cloudMediaId: "media-1",
      cloudUrl: "https://res.cloudinary.com/example/image/upload/asset-1.png",
    }));
    await expect(db.get(persisted._id)).rejects.toMatchObject({ status: 404 });
  });

  it("persists failed cleanup and retries it through the bounded durable queue", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const removedDraft = {
      ...baseline.hydrated,
      arrangements: [{ ...baseline.hydrated.arrangements[0], slides: baseline.hydrated.arrangements[0].slides.slice(1) }],
    };
    const candidate = baseline.slides[0]._id;
    const remove = db.remove.bind(db);
    let failCleanup = true;
    jest.spyOn(db, "remove").mockImplementation(async (id, rev) => {
      if (id === candidate && failCleanup) throw new Error("temporary cleanup failure");
      return remove(id, rev);
    });
    const onCleanupErrors = jest.fn();
    await expect(saveSong(db, removedDraft, baseline.hydrated, { onCleanupErrors })).resolves.toEqual(expect.objectContaining({
      docType: "song-v2-root",
    }));
    expect(onCleanupErrors.mock.calls[0][0].map((error: { documentId: string }) => error.documentId)).toContain(candidate);
    expect((await db.allDocs({ include_docs: true })).rows.some(row => (row.doc as any)?.docType === "song-v2-cleanup")).toBe(true);
    failCleanup = false;

    await reconcilePendingSongV2Cleanup(db, 20);
    await expect(db.get(candidate)).rejects.toMatchObject({ status: 404 });
    expect((await db.allDocs({ include_docs: true })).rows.some(row => (row.doc as any)?.docType === "song-v2-cleanup")).toBe(false);
  });

  it("quarantines stale entries so a bounded queue can reach later cleanup work", async () => {
    await createSongV2(db, source());
    const errors: { documentId: string; revision: string; cause: Error }[] = [];
    for (let index = 0; index < 21; index += 1) {
      const documentId = `song-v2:slide:real-song:a:orphan-${index}`;
      await db.put({
        _id: documentId, docType: "song-v2-slide", songId: "real-song",
        arrangementId: "a", id: `orphan-${index}`, boxes: [],
      } as never);
      errors.push({ documentId, revision: "stale-revision", cause: new Error("prior cleanup failed") });
    }
    await persistSongV2CleanupErrors(db, "real-song", errors);

    const first = await reconcilePendingSongV2Cleanup(db, 20);
    expect(first.quarantined).toHaveLength(20);
    expect((await db.allDocs({
      startkey: "song-v2:cleanup:", endkey: "song-v2:cleanup:\uffff", include_docs: true,
    })).rows.filter(row => (row.doc as any)?.docType === "song-v2-cleanup")).toHaveLength(1);

    const second = await reconcilePendingSongV2Cleanup(db, 20);
    expect(second.quarantined).toHaveLength(1);
    expect((await db.allDocs({
      startkey: "song-v2:cleanup:", endkey: "song-v2:cleanup:\uffff", include_docs: true,
    })).rows.filter(row => (row.doc as any)?.docType === "song-v2-cleanup")).toHaveLength(0);
    expect((await db.allDocs({ include_docs: true })).rows.filter(row => (row.doc as any)?.docType === "song-v2-cleanup-quarantine")).toHaveLength(21);
  });

  it("prevents reconciliation from deleting an orphan adopted during its manifest check", async () => {
    await createSongV2(db, source());
    const baseline = await loadSongV2Snapshot(db, "real-song");
    const removedDraft = copy(baseline.hydrated);
    removedDraft.arrangements[0].slides.shift();
    const candidate = baseline.slides[0]._id;
    const originalRemove = db.remove.bind(db);
    jest.spyOn(db, "remove").mockImplementation(async (id, rev) => {
      if (id === candidate) throw new Error("temporary cleanup failure");
      return originalRemove(id, rev);
    });
    const removed = await saveSongV2(db, baseline, removedDraft);
    const failedRevision = removed.cleanupErrors.find(error => error.documentId === candidate)?.revision;
    expect(failedRevision).toBe(baseline.slides[0]._rev);
    jest.spyOn(db, "remove").mockImplementation(originalRemove);

    const afterRemoval = await loadSongV2Snapshot(db, "real-song");
    const republish = copy(afterRemoval.hydrated);
    republish.arrangements[0].slides.unshift(copy(baseline.hydrated.arrangements[0].slides[0]));
    const originalGet = db.get.bind(db);
    let adopted = false;
    jest.spyOn(db, "get").mockImplementation((async (id: string) => {
      if (id === candidate && !adopted) {
        adopted = true;
        const staleRevision = await originalGet(id);
        await saveSongV2FromBaseline(db, afterRemoval.hydrated, republish);
        return staleRevision;
      }
      return originalGet(id);
    }) as any);

    await expect(reconcileSongV2Orphans(db, "real-song", [{ documentId: candidate, revision: failedRevision }])).resolves.toEqual({
      deleted: [], skipped: [], cleanupErrors: [expect.objectContaining({ documentId: candidate })],
    });
    expect((await loadSongV2Snapshot(db, "real-song")).slides.map(doc => doc._id)).toContain(candidate);
  });

  it("deletes v2 songs with a retained root tombstone before child cleanup", async () => {
    const legacy = await createSong(db, source());
    await createSongV2(db, legacy);

    const deleted = await deleteSong(db, legacy._id);

    expect(deleted._id).toBe(legacy._id);
    const tombstone = await db.get("song-v2:root:real-song");
    expect(tombstone).toEqual(expect.objectContaining({ docType: "song-v2-root", deletedAt: expect.any(String), arrangementIds: [] }));
    await expect(loadSong(db, legacy._id)).rejects.toBeInstanceOf(SongV2DeletedError);
    await expect(db.get(legacy._id)).rejects.toMatchObject({ status: 404 });
    await expect(db.get("song-v2:arrangement:real-song:a")).rejects.toMatchObject({ status: 404 });
  });

  it("resumes failed tombstone cleanup without opening the deleted song", async () => {
    const legacy = await createSong(db, source());
    await createSongV2(db, legacy);
    const childIds = new Set([
      "song-v2:arrangement:real-song:a",
      "song-v2:slide:real-song:a:s1",
      "song-v2:slide:real-song:a:s2",
      "song-v2:slide:real-song:a:s3",
    ]);
    const remove = db.remove.bind(db);
    let failCleanup = true;
    jest.spyOn(db, "remove").mockImplementation((async (idOrDoc: any, rev?: string) => {
      const id = typeof idOrDoc === "string" ? idOrDoc : idOrDoc._id;
      if (childIds.has(id) && failCleanup) throw new Error("temporary cleanup failure");
      return (remove as any)(idOrDoc, rev);
    }) as any);

    await deleteSong(db, legacy._id);
    failCleanup = false;
    await expect(loadSong(db, legacy._id)).rejects.toBeInstanceOf(SongV2DeletedError);

    const result = await reconcilePendingSongV2Cleanup(db, 20);
    expect(result.deleted.sort()).toEqual([...childIds].sort());
    await expect(db.get("song-v2:arrangement:real-song:a")).rejects.toMatchObject({ status: 404 });
  });
});

