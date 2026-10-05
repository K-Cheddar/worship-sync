import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItem } from "../types";
import { createSong, loadSong, loadSongV2Snapshot, saveSong, songToLibraryProjection } from "./songPersistence";
import { createSongV2, saveSongV2, saveSongV2FromBaseline } from "./songV2Writer";

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
      songId: "real-song", arrangementId: "a", id: "new", name: "New",
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
});

