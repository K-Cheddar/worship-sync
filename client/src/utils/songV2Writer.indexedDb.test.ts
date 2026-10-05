import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItem } from "../types";
import { createSong, loadSong, loadSongV2Snapshot } from "./songPersistence";
import { createSongV2, saveSongV2 } from "./songV2Writer";

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

