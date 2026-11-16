import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItem, ItemState } from "../types";
import { createNewSlide } from "./slideCreation";
import { formatSong } from "./overflow";
import { createSongV2, SongV2MutationNotAuthorizedError } from "./songV2Writer";
import { loadSong, loadSongV2Snapshot, saveSong } from "./songPersistence";
import { itemSlice } from "../store/itemSlice";
import {
  buildSongV2RevisionSelection, loadReconciledSongV2Snapshot,
  loadSongV2ConflictRevisionOptions,
  resolveSongV2ConflictReview, SongV2ConflictReviewStaleError,
} from "./songV2ReplicationConflicts";

jest.mock("./textMeasurement", () => ({
  getMaxLines: () => ({ maxLines: 2, lineHeight: 1 }),
  getNumLines: () => 1,
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(): DBItem {
  const template = createNewSlide({ type: "Verse", words: ["", "alpha\nbeta\ngamma\ndelta"] });
  return formatSong({
    _id: "better-test", type: "song", name: "Better", selectedArrangement: 0,
    selectedSlide: 1, selectedBox: 1, slides: [],
    shouldSendTo: { projector: true, monitor: true, stream: true },
    arrangements: [{ id: "master", name: "Master",
      songOrder: [{ id: "verse-order", name: "Verse 1" }, { id: "chorus-order", name: "Chorus" }],
      formattedLyrics: [
        { id: "verse", name: "Verse 1", type: "Verse", words: "alpha\nbeta\ngamma\ndelta", slideSpan: 2 },
        { id: "chorus", name: "Chorus", type: "Chorus", words: "chorus", slideSpan: 1 },
      ],
      slides: [createNewSlide({ type: "Title", words: ["", "Better"] }), template,
        createNewSlide({ type: "Blank" })],
    }],
  } as ItemState) as DBItem;
}
function fixtureWithThreeSections(): DBItem {
  const source = fixture();
  source.arrangements[0].songOrder.push({ id: "bridge-order", name: "Bridge" });
  source.arrangements[0].formattedLyrics.push({
    id: "bridge", name: "Bridge", type: "Bridge", words: "bridge line", slideSpan: 1,
  });
  source.arrangements[0].slides.push(createNewSlide({ type: "Bridge", words: ["", "bridge line"] }));
  return formatSong({ ...source, selectedSlide: 1, selectedBox: 1 } as ItemState) as DBItem;
}
function edit(song: DBItem, page: number, value: string): DBItem {
  const draft = clone(song);
  const slides = draft.arrangements[0].slides;
  const verse = slides.filter(slide => slide.name.startsWith("Verse 1"));
  verse[page].boxes[1].words = value;
  draft.arrangements[0].formattedLyrics[0].words = verse.map((slide, index) => {
    const words = slide.boxes[1].words ?? "";
    return index < verse.length - 1 && !words.endsWith("\n") ? words + "\n" : words;
  }).join("");
  return formatSong({ ...draft, selectedSlide: page + 1, selectedBox: 1 } as ItemState) as DBItem;
}
function editSection(song: DBItem, sectionIndex: number, value: string): DBItem {
  const draft = clone(song);
  draft.arrangements[0].formattedLyrics[sectionIndex].words = value;
  return formatSong({ ...draft, selectedArrangement: 0, selectedSlide: 1, selectedBox: 1 } as ItemState) as DBItem;
}
function editPhysicalSlide(song: DBItem, slideIndex: number, value: string): DBItem {
  const draft = clone(song);
  const box = draft.arrangements[0].slides[slideIndex].boxes[1];
  if (!box) throw new Error(`Fixture slide ${slideIndex} has no authored text box`);
  box.words = value;
  return draft;
}
async function sharedAncestor(db: PouchDB.Database, documentId: string, revisions: string[]) {
  const histories = await Promise.all(revisions.map(revision =>
    db.get<any>(documentId, { rev: revision, revs: true }),
  ));
  const trails = histories.map(history => history._revisions.ids.map((id: string, index: number) =>
    `${history._revisions.start - index}-${id}`,
  ));
  const commonRevision = trails[0].find((revision: string) => trails.slice(1).every((trail: string[]) =>
    trail.includes(revision),
  ));
  return commonRevision ? db.get<any>(documentId, { rev: commonRevision }) : undefined;
}

describe("Better Verse 1A / Verse 1B through real formatting, state and PouchDB", () => {
  let db: PouchDB.Database;
  beforeEach(async () => {
    db = new PouchDB(`concurrent-lyrics-${Date.now()}-${Math.random()}`, { adapter: "idb" });
    await createSongV2(db, fixture());
  });
  afterEach(async () => { jest.restoreAllMocks(); await db.destroy(); });

  it("opens a nonconflicting song with the existing reads and no warnings", async () => {
    const get = jest.spyOn(db, "get");
    const allDocs = jest.spyOn(db, "allDocs");
    const put = jest.spyOn(db, "put");
    const remove = jest.spyOn(db, "remove");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const loaded = await loadSong(db, "better-test");

    expect(loaded.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta\ngamma\ndelta");
    expect(get).toHaveBeenCalledTimes(1);
    expect(allDocs).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("preserves Verse 1A and Verse 1B, stable identities, exact writes, and both reloads", async () => {
    const baseline = await loadSong(db, "better-test");
    const a = edit(baseline, 0, "alpha\nbeta1\n");
    const b = edit(baseline, 1, "gamma\ndelta1");
    expect(a.arrangements[0].slides.map(s => s.id)).toEqual(baseline.arrangements[0].slides.map(s => s.id));
    expect(a.arrangements[0].slides.map(s => s.boxes.map(box => box.id)))
      .toEqual(baseline.arrangements[0].slides.map(s => s.boxes.map(box => box.id)));
    const get = jest.spyOn(db, "get");
    const allDocs = jest.spyOn(db, "allDocs");
    const put = jest.spyOn(db, "put");
    const remove = jest.spyOn(db, "remove");
    const snapshotA = await loadSongV2Snapshot(db, baseline._id, true);
    const savedA = await saveSong(db, a, baseline, undefined, snapshotA);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([
      `song-v2:slide:better-test:master:${a.arrangements[0].slides[1].id}`,
      "song-v2:arrangement:better-test:master",
    ]);
    const snapshotB = await loadSongV2Snapshot(db, baseline._id, true);
    const savedB = await saveSong(db, b, baseline, undefined, snapshotB);
    expect({ get: get.mock.calls.length, allDocs: allDocs.mock.calls.length,
      put: put.mock.calls.length, remove: remove.mock.calls.length })
      .toEqual({ get: 2, allDocs: 4, put: 4, remove: 0 });
    let state = itemSlice.reducer(undefined, itemSlice.actions.setActiveItem(baseline));
    state = itemSlice.reducer(state, itemSlice.actions._updateArrangements(b.arrangements));
    state = itemSlice.reducer(state, itemSlice.actions.bufferRemoteItemUpdate(savedA));
    expect(state.hasPendingUpdate).toBe(true);
    state = itemSlice.reducer(state, itemSlice.actions.markItemPersisted(savedB, b));
    expect(state.hasPendingUpdate).toBe(false);
    expect(state.hasRemoteUpdate).toBe(false);
    expect(state.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta1\ngamma\ndelta1");
    const reloadedA = await loadSong(db, baseline._id);
    const reloadedB = await loadSong(db, baseline._id);
    expect(reloadedA).toEqual(reloadedB);
    expect(reloadedB.arrangements[0].slides.filter(s => s.name.startsWith("Verse 1")).map(s => s.boxes[1].words).join(""))
      .toBe("alpha\nbeta1\ngamma\ndelta1");
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports overlapping canonical text without discarding either draft", async () => {
    const baseline = await loadSong(db, "better-test");
    const a = edit(baseline, 0, "alpha\nfirst\n");
    const b = edit(baseline, 0, "alpha\nsecond\n");
    await saveSong(db, a, baseline);
    await expect(saveSong(db, b, baseline)).rejects.toMatchObject({ status: 409, name: "SongV2ConcurrentEditError" });
    expect(b.arrangements[0].formattedLyrics[0].words).toContain("second");
    expect((await loadSong(db, baseline._id)).arrangements[0].formattedLyrics[0].words).toContain("first");
  });

  it("converges two independent browser databases when B receives A while holding its own draft", async () => {
    const a = new PouchDB(`browser-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`browser-b-${Math.random()}`, { adapter: "idb" });
    try {
      await a.replicate.from(db);
      await b.replicate.from(db);
      const baseA = await loadSong(a, "better-test");
      const baseB = await loadSong(b, "better-test");
      const draftA = edit(baseA, 0, "alpha\nbeta1\n");
      const draftB = edit(baseB, 1, "gamma\ndelta1");
      let stateB = itemSlice.reducer(undefined, itemSlice.actions.setActiveItem(baseB));
      stateB = itemSlice.reducer(stateB, itemSlice.actions._updateArrangements(draftB.arrangements));
      await saveSong(a, draftA, baseA);
      await a.replicate.to(db);
      await b.replicate.from(db);
      stateB = itemSlice.reducer(stateB, itemSlice.actions.bufferRemoteItemUpdate(await loadSong(b, baseB._id)));
      expect(stateB.hasPendingUpdate).toBe(true);
      const savedB = await saveSong(b, draftB, baseB);
      stateB = itemSlice.reducer(stateB, itemSlice.actions.markItemPersisted(savedB, draftB));
      await b.replicate.to(db);
      await a.replicate.from(db);
      const reloadedA = await loadSong(a, baseA._id);
      const reloadedB = await loadSong(b, baseB._id);
      expect(reloadedA).toEqual(reloadedB);
      expect(reloadedB.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta1\ngamma\ndelta1");
      expect(stateB.hasPendingUpdate).toBe(false);
      await Promise.all([a.replicate.to(db), b.replicate.from(db)]);
      await Promise.all([a.replicate.to(db), b.replicate.from(db)]);
      expect((await loadSongV2Snapshot(b, baseB._id, true)).conflicts).toBeUndefined();
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("merges saves that both validate before either arrangement commit", async () => {
    const baseline = await loadSong(db, "better-test");
    const a = edit(baseline, 0, "alpha\nbeta1\n");
    const b = edit(baseline, 1, "gamma\ndelta1");
    const snapshot = await loadSongV2Snapshot(db, baseline._id);
    await Promise.all([saveSong(db, a, baseline, undefined, snapshot), saveSong(db, b, baseline, undefined, snapshot)]);
    expect((await loadSong(db, baseline._id)).arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta1\ngamma\ndelta1");
  });

  it("merges independent verse and chorus edits from real replicas and remains writable", async () => {
    const a = new PouchDB(`section-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`section-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baseA = await loadSong(a, "better-test");
      const baseB = await loadSong(b, "better-test");
      await Promise.all([
        saveSong(a, editSection(baseA, 0, "Verse from A\nbeta\ngamma\ndelta"), baseA),
        saveSong(b, editSection(baseB, 1, "Chorus from B"), baseB),
      ]);

      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);
      const concurrent = await loadSongV2Snapshot(a, baseA._id, true);
      const reconciled = await loadReconciledSongV2Snapshot(a, baseA._id, concurrent, () => true);

      expect(reconciled.hydrated.arrangements[0].formattedLyrics.map(section => section.words))
        .toEqual(["Verse from A\nbeta\ngamma\ndelta", "Chorus from B"]);
      const editorState = itemSlice.reducer(undefined, itemSlice.actions.setActiveItem(reconciled.hydrated));
      expect(editorState.pendingSongV2Conflicts).toBeUndefined();
      expect(editorState.hasRemoteUpdate).toBe(false);
      await a.replicate.to(db);
      await b.replicate.from(db);
      const beforeNextSave = await loadSong(b, baseB._id);
      const savedAgain = await saveSong(b, editSection(beforeNextSave, 1, "Continued chorus edit"), beforeNextSave);
      await b.replicate.to(db);
      await a.replicate.from(db);

      const finalA = await loadSong(a, baseA._id);
      const finalB = await loadSong(b, baseB._id);
      expect(finalA.arrangements[0].formattedLyrics.map(section => section.words))
        .toEqual(["Verse from A\nbeta\ngamma\ndelta", "Continued chorus edit"]);
      expect(finalA).toEqual(finalB);
      expect(savedAgain.arrangements[0].formattedLyrics[0].words)
        .toBe("Verse from A\nbeta\ngamma\ndelta");
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("merges a generated slide conflict from compatible edits to separate lyric lines", async () => {
    const a = new PouchDB(`derived-slide-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`derived-slide-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baselineA = await loadSong(a, "better-test");
      const baselineB = await loadSong(b, "better-test");
      await Promise.all([
        saveSong(a, edit(baselineA, 0, "alpha from A\nbeta\n"), baselineA),
        saveSong(b, edit(baselineB, 0, "alpha\nbeta from B\n"), baselineB),
      ]);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);

      const snapshot = await loadSongV2Snapshot(a, "better-test", true);
      expect(snapshot.conflicts?.map(conflict => conflict.documentId).sort()).toEqual([
        "song-v2:arrangement:better-test:master",
        `song-v2:slide:better-test:master:${baselineA.arrangements[0].slides[1].id}`,
      ].sort());
      expect((await loadSongV2ConflictRevisionOptions(a, snapshot)).map(entry => entry.conflict.documentId))
        .toHaveLength(2);

      // Both text operations are on different lines and both physical page
      // revisions are deterministic output of their canonical lyric edit.
      const reconciled = await loadReconciledSongV2Snapshot(a, "better-test", snapshot, () => true);
      const verse = reconciled.hydrated.arrangements[0];
      expect(verse.formattedLyrics[0].words).toBe("alpha from A\nbeta from B\ngamma\ndelta");
      expect(verse.slides.map(slide => slide.id)).toEqual(baselineA.arrangements[0].slides.map(slide => slide.id));
      expect(verse.slides.filter(slide => slide.name.startsWith("Verse 1"))
        .map(slide => slide.boxes[1].words).join("")).toBe(verse.formattedLyrics[0].words);
      expect(reconciled.conflicts).toBeUndefined();

      await a.replicate.to(db);
      await b.replicate.from(db);
      expect((await loadSongV2Snapshot(b, "better-test", true)).conflicts).toBeUndefined();
      const thirdEdit = await saveSong(b,
        editSection(await loadSong(b, "better-test"), 1, "third edit after generated merge"),
        await loadSong(b, "better-test"),
      );
      expect(thirdEdit.arrangements[0].formattedLyrics[1].words).toBe("third edit after generated merge");
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("leaves incompatible section ordering for review", async () => {
    const a = new PouchDB(`section-order-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`section-order-b-${Math.random()}`, { adapter: "idb" });
    const ordered = (song: DBItem, ids: string[]) => {
      const draft = clone(song);
      const orderById = new Map(draft.arrangements[0].songOrder.map(order => [order.id, order]));
      draft.arrangements[0].songOrder = ids.map(id => orderById.get(id)!);
      return formatSong({ ...draft, selectedSlide: 1, selectedBox: 1 } as ItemState) as DBItem;
    };
    try {
      const source = fixtureWithThreeSections();
      source._id = "three-section-order";
      await createSongV2(db, source);
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baselineA = await loadSong(a, source._id);
      const baselineB = await loadSong(b, source._id);
      await Promise.all([
        saveSong(a, ordered(baselineA, ["verse-order", "bridge-order", "chorus-order"]), baselineA),
        saveSong(b, ordered(baselineB, ["chorus-order", "bridge-order", "verse-order"]), baselineB),
      ]);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);

      const conflict = await loadSongV2Snapshot(a, source._id, true);
      expect(conflict.conflicts?.some(entry => entry.documentId === conflict.arrangements[0]._id)).toBe(true);
      const puts = jest.spyOn(a, "put");
      const removes = jest.spyOn(a, "remove");
      const unresolved = await loadReconciledSongV2Snapshot(a, source._id, conflict, () => true);
      expect(unresolved.conflicts?.some(entry => entry.documentId === conflict.arrangements[0]._id)).toBe(true);
      expect(puts).not.toHaveBeenCalled();
      expect(removes).not.toHaveBeenCalled();
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("does not reconcile a meaningful revision without a shared baseline", async () => {
    const baseline = await loadSongV2Snapshot(db, "better-test");
    const arrangement = baseline.arrangements[0];
    const unrelatedRevision = {
      ...arrangement,
      _rev: "1-0123456789abcdef0123456789abcdef",
      _revisions: { start: 1, ids: ["0123456789abcdef0123456789abcdef"] },
      formattedLyrics: arrangement.formattedLyrics.map((lyric, index) => index === 0
        ? { ...lyric, words: "disconnected revision text" }
        : lyric),
    };
    await db.bulkDocs([unrelatedRevision], { new_edits: false });
    const conflict = await loadSongV2Snapshot(db, baseline.root.songId, true);
    expect(conflict.conflicts?.map(entry => entry.documentId)).toContain(arrangement._id);
    const puts = jest.spyOn(db, "put");
    const removes = jest.spyOn(db, "remove");

    const unresolved = await loadReconciledSongV2Snapshot(db, baseline.root.songId, conflict, () => true);

    expect(unresolved.conflicts?.map(entry => entry.documentId)).toContain(arrangement._id);
    expect(puts).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });

  it("preserves independent edits to separate physical slide documents", async () => {
    const a = new PouchDB(`slide-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`slide-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baseA = await loadSong(a, "better-test");
      const baseB = await loadSong(b, "better-test");
      const draftA = editPhysicalSlide(baseA, 0, "Title changed by A");
      const draftB = editPhysicalSlide(baseB, 2, "Blank changed by B");
      await Promise.all([saveSong(a, draftA, baseA), saveSong(b, draftB, baseB)]);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);
      const snapshot = await loadSongV2Snapshot(a, baseA._id, true);
      expect(snapshot.conflicts).toBeUndefined();
      const converged = snapshot.hydrated;
      expect(converged.arrangements[0].slides[0].boxes[1].words).toBe("Title changed by A");
      expect(converged.arrangements[0].slides[2].boxes[1].words).toBe("Blank changed by B");
      const editorState = itemSlice.reducer(undefined, itemSlice.actions.setActiveItem(converged));
      expect(editorState.pendingSongV2Conflicts).toBeUndefined();
      expect(editorState.hasRemoteUpdate).toBe(false);

      await a.replicate.to(db);
      await b.replicate.from(db);
      const baselineB2 = await loadSong(b, baseB._id);
      const continued = await saveSong(b, editSection(baselineB2, 1, "continued after slide convergence"), baselineB2);
      await b.replicate.to(db);
      await a.replicate.from(db);
      expect((await loadSong(a, baseA._id)).arrangements[0].formattedLyrics[1].words)
        .toBe("continued after slide convergence");
      expect(continued.arrangements[0].slides[0].boxes[1].words).toBe("Title changed by A");
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("merges a fresh arrangement while preserving pre-existing physical slide leaves", async () => {
    const oldA = new PouchDB(`historical-a-${Math.random()}`, { adapter: "idb" });
    const oldB = new PouchDB(`historical-b-${Math.random()}`, { adapter: "idb" });
    const controllerA = new PouchDB(`historical-controller-a-${Math.random()}`, { adapter: "idb" });
    const controllerB = new PouchDB(`historical-controller-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([oldA.replicate.from(db), oldB.replicate.from(db)]);
      const oldBaseline = await loadSongV2Snapshot(oldA, "better-test");
      const oldBaselineB = await loadSongV2Snapshot(oldB, "better-test");
      const historicalSlides = oldBaseline.slides.slice(0, 4);
      await Promise.all(historicalSlides.map(async (slide, index) => {
        const other = oldBaselineB.slides.find(candidate => candidate._id === slide._id)!;
        const changeBackground = (document: typeof slide, source: string) => ({
          ...document,
          boxes: document.boxes.map((box, boxIndex) => boxIndex === 0
            ? { ...box, background: `${source}-${index}` }
            : box),
        });
        await Promise.all([
          oldA.put(changeBackground(slide, "old-a")),
          oldB.put(changeBackground(other, "old-b")),
        ]);
      }));
      await oldA.replicate.to(db);
      await oldB.replicate.to(db);

      const historical = await loadSongV2Snapshot(db, "better-test", true);
      expect(historical.conflicts?.map(conflict => conflict.documentId).sort())
        .toEqual(historicalSlides.map(slide => slide._id).sort());
      const historicalOptions = await loadSongV2ConflictRevisionOptions(db, historical);
      for (const entry of historicalOptions) {
        const ancestor = await sharedAncestor(db, entry.conflict.documentId, [
          entry.conflict.winningRevision, ...entry.conflict.revisions,
        ]);
        const expectedSlide = historicalSlides.find(slide => slide._id === entry.conflict.documentId)!;
        expect(ancestor?.boxes[0].background).toBe(expectedSlide.boxes[0].background);
        expect(entry.options.map(option => option.document.docType === "song-v2-slide"
          ? option.document.boxes[0].background : undefined))
          .toEqual(expect.arrayContaining([expect.stringMatching(/^old-a-\d+$/), expect.stringMatching(/^old-b-\d+$/)]));
      }

      await Promise.all([controllerA.replicate.from(db), controllerB.replicate.from(db)]);
      const baselineA = await loadSong(controllerA, "better-test");
      const baselineB = await loadSong(controllerB, "better-test");
      await Promise.all([
        saveSong(controllerA, editSection(baselineA, 0, "Verse changed by Controller A\nbeta\ngamma\ndelta"), baselineA),
        saveSong(controllerB, editSection(baselineB, 1, "Chorus changed by Controller B"), baselineB),
      ]);
      await controllerA.replicate.to(db);
      await controllerB.replicate.to(db);
      await controllerA.replicate.from(db);

      const combined = await loadSongV2Snapshot(controllerA, "better-test", true);
      expect(combined.conflicts?.map(conflict => conflict.documentId).sort())
        .toEqual([
          ...historicalSlides.map(slide => slide._id),
          "song-v2:arrangement:better-test:master",
        ].sort());
      const recordedBranches = await loadSongV2ConflictRevisionOptions(controllerA, combined);
      expect(recordedBranches).toHaveLength(5);
      const arrangementConflict = combined.conflicts!.find(conflict =>
        conflict.documentId === "song-v2:arrangement:better-test:master",
      )!;
      const arrangementAncestor = await sharedAncestor(controllerA, arrangementConflict.documentId, [
        arrangementConflict.winningRevision, ...arrangementConflict.revisions,
      ]);
      expect(arrangementAncestor?.formattedLyrics.map((section: { words: string }) => section.words))
        .toEqual(["alpha\nbeta\ngamma\ndelta", "chorus"]);
      const arrangementOptions = recordedBranches.find(entry => entry.conflict.documentId === arrangementConflict.documentId)!;
      expect(arrangementOptions.options.some(option => option.document.docType === "song-v2-arrangement" &&
        option.document.formattedLyrics[0].words.startsWith("Verse changed by Controller A"))).toBe(true);
      expect(arrangementOptions.options.some(option => option.document.docType === "song-v2-arrangement" &&
        option.document.formattedLyrics[1].words === "Chorus changed by Controller B")).toBe(true);
      for (const entry of recordedBranches.filter(entry => entry.conflict.documentId !== "song-v2:arrangement:better-test:master")) {
        const backgrounds = entry.options.map(option => option.document.docType === "song-v2-slide"
          ? option.document.boxes[0].background : undefined);
        expect(backgrounds).toHaveLength(2);
        expect(backgrounds.every(background => /^old-[ab]-\d+$/.test(background ?? ""))).toBe(true);
      }

      const reconciled = await loadReconciledSongV2Snapshot(
        controllerA, "better-test", combined, () => true,
      );
      expect(reconciled.hydrated.arrangements[0].formattedLyrics.map(section => section.words))
        .toEqual([
          "Verse changed by Controller A\nbeta\ngamma\ndelta",
          "Chorus changed by Controller B",
        ]);
      expect(reconciled.conflicts?.map(conflict => conflict.documentId).sort())
        .toEqual(historicalSlides.map(slide => slide._id).sort());
      const afterMerge = await loadSongV2Snapshot(controllerA, "better-test", true);
      expect(afterMerge.conflicts?.map(conflict => conflict.documentId).sort())
        .toEqual(historicalSlides.map(slide => slide._id).sort());
      const preservedBranches = await loadSongV2ConflictRevisionOptions(controllerA, afterMerge);
      expect(preservedBranches).toHaveLength(historicalSlides.length);
      for (const entry of preservedBranches) {
        const backgrounds = entry.options.map(option => option.document.docType === "song-v2-slide"
          ? option.document.boxes[0].background : undefined);
        expect(backgrounds.every(background => /^old-[ab]-\d+$/.test(background ?? ""))).toBe(true);
      }

      const conflictedTitle = historicalSlides.find(slide => slide.name === "Title")!;
      const titleEdit = clone(afterMerge.hydrated);
      titleEdit.arrangements[0].slides.find(slide => slide.id === conflictedTitle.id)!.boxes[0].background = "Edited background while title versions need review";
      await expect(saveSong(controllerA, titleEdit, afterMerge.hydrated, undefined, afterMerge))
        .rejects.toMatchObject({
          name: "SongV2ConcurrentEditError",
          documentId: conflictedTitle._id,
        });

      const unrelatedSlide = afterMerge.hydrated.arrangements[0].slides.find(slide =>
        slide.id === "blank",
      ) ?? afterMerge.hydrated.arrangements[0].slides.find(slide =>
        !historicalSlides.some(conflictSlide => conflictSlide.id === slide.id),
      )!;
      const unrelatedEdit = clone(afterMerge.hydrated);
      unrelatedEdit.arrangements[0].slides.find(slide => slide.id === unrelatedSlide.id)!.boxes[0].background = "unrelated-slide-edit";
      const unrelatedSaved = await saveSong(controllerA, unrelatedEdit, afterMerge.hydrated, undefined, afterMerge);
      expect(unrelatedSaved.arrangements[0].slides.find(slide => slide.id === unrelatedSlide.id)!.boxes[0].background)
        .toBe("unrelated-slide-edit");
      expect((await loadSongV2Snapshot(controllerA, "better-test", true)).conflicts)
        .toHaveLength(historicalSlides.length);
    } finally {
      await Promise.all([
        oldA.destroy(), oldB.destroy(), controllerA.destroy(), controllerB.destroy(),
      ]);
    }
  });

  it("ignores equivalent authored physical leaves and permits the next edit", async () => {
    const a = new PouchDB(`equivalent-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`equivalent-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baseA = await loadSong(a, "better-test");
      const baseB = await loadSong(b, "better-test");
      const sameA = editSection(baseA, 1, "Same authored chorus");
      const sameB = editSection(baseB, 1, "Same authored chorus");
      await Promise.all([saveSong(a, sameA, baseA), saveSong(b, sameB, baseB)]);
      const arrangementId = "song-v2:arrangement:better-test:master";
      const [arrangementA, arrangementB] = await Promise.all([
        a.get<any>(arrangementId), b.get<any>(arrangementId),
      ]);
      await Promise.all([
        a.put({ ...arrangementA, updatedAt: "equivalent-branch-a" }),
        b.put({ ...arrangementB, updatedAt: "equivalent-branch-b" }),
      ]);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);

      const rawArrangement = await a.get("song-v2:arrangement:better-test:master", { conflicts: true }) as
        typeof baseA.arrangements[number] & { _conflicts?: string[] };
      expect(rawArrangement._conflicts?.length).toBeGreaterThan(0);
      const snapshot = await loadSongV2Snapshot(a, "better-test", true);
      expect(snapshot.conflicts).toBeUndefined();
      const editorState = itemSlice.reducer(undefined, itemSlice.actions.setActiveItem(snapshot.hydrated));
      expect(editorState.pendingSongV2Conflicts).toBeUndefined();
      expect(editorState.hasRemoteUpdate).toBe(false);

      const nextDraft = editSection(snapshot.hydrated, 0, "Verse after convergence\nbeta\ngamma\ndelta");
      const saved = await saveSong(a, nextDraft, snapshot.hydrated);
      expect(saved.arrangements[0].formattedLyrics.map(section => section.words))
        .toEqual(["Verse after convergence\nbeta\ngamma\ndelta", "Same authored chorus"]);
    } finally { await a.destroy(); await b.destroy(); }
  });

  it.each(["targeted refresh", "reopen"])("converges through %s when both browser databases save before either edit replicates", async mode => {
    const a = new PouchDB(`simultaneous-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`simultaneous-b-${Math.random()}`, { adapter: "idb" });
    try {
      await a.replicate.from(db);
      await b.replicate.from(db);
      const baseA = await loadSong(a, "better-test");
      const baseB = await loadSong(b, "better-test");
      await Promise.all([
        saveSong(a, edit(baseA, 0, "alpha\nbeta1\n"), baseA),
        saveSong(b, edit(baseB, 1, "gamma\ndelta1"), baseB),
      ]);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);
      const conflict = await loadSongV2Snapshot(a, baseA._id, true);
      expect(conflict.conflicts).toHaveLength(1);
      const get = jest.spyOn(a, "get");
      const allDocs = jest.spyOn(a, "allDocs");
      const put = jest.spyOn(a, "put");
      const remove = jest.spyOn(a, "remove");
      const reconciled = await loadReconciledSongV2Snapshot(
        a, baseA._id, conflict, () => true,
      );
      expect({ get: get.mock.calls.length, allDocs: allDocs.mock.calls.length,
        put: put.mock.calls.length, remove: remove.mock.calls.length })
        .toEqual({ get: 8, allDocs: 4, put: 1, remove: 1 });
      expect(reconciled.hydrated.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta1\ngamma\ndelta1");
      await a.replicate.to(db);
      await b.replicate.from(db);
      expect((await loadSongV2Snapshot(b, baseB._id, true)).conflicts).toBeUndefined();
      expect(await loadSong(a, baseA._id)).toEqual(await loadSong(b, baseB._id));
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("keeps safe replicated edits read-only until an authorized editor reconciles them", async () => {
    const a = new PouchDB(`readonly-reconcile-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`readonly-reconcile-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baselineA = await loadSong(a, "better-test");
      const baselineB = await loadSong(b, "better-test");
      await saveSong(a, edit(baselineA, 0, "alpha\nbeta1\n"), baselineA);
      await saveSong(b, edit(baselineB, 1, "gamma\ndelta1"), baselineB);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);

      const conflict = await loadSongV2Snapshot(a, "better-test", true);
      expect(conflict.conflicts).toHaveLength(1);
      const puts = jest.spyOn(a, "put");
      const removes = jest.spyOn(a, "remove");
      const readOnly = await loadSong(a, "better-test");
      expect(readOnly).toEqual(conflict.hydrated);
      expect(puts).not.toHaveBeenCalled();
      expect(removes).not.toHaveBeenCalled();
      expect((await loadSongV2Snapshot(a, "better-test", true)).conflicts).toHaveLength(1);

      await expect(loadReconciledSongV2Snapshot(a, "better-test", conflict, () => false))
        .rejects.toBeInstanceOf(SongV2MutationNotAuthorizedError);
      expect(puts).not.toHaveBeenCalled();
      expect(removes).not.toHaveBeenCalled();
      expect((await loadSongV2Snapshot(a, "better-test", true)).conflicts).toHaveLength(1);

      const reconciled = await loadReconciledSongV2Snapshot(a, "better-test", conflict, () => true);
      expect(reconciled.hydrated.arrangements[0].formattedLyrics[0].words)
        .toBe("alpha\nbeta1\ngamma\ndelta1");
      expect(puts).toHaveBeenCalledTimes(1);
      expect(removes).toHaveBeenCalledTimes(1);
      expect((await loadSongV2Snapshot(a, "better-test", true)).conflicts).toBeUndefined();
    } finally { await a.destroy(); await b.destroy(); }
  });

  it("rechecks authorization before retiring a conflict leaf after a committed merge", async () => {
    const a = new PouchDB(`revoked-reconcile-a-${Math.random()}`, { adapter: "idb" });
    const b = new PouchDB(`revoked-reconcile-b-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([a.replicate.from(db), b.replicate.from(db)]);
      const baselineA = await loadSong(a, "better-test");
      const baselineB = await loadSong(b, "better-test");
      await saveSong(a, edit(baselineA, 0, "alpha\nbeta1\n"), baselineA);
      await saveSong(b, edit(baselineB, 1, "gamma\ndelta1"), baselineB);
      await a.replicate.to(db);
      await b.replicate.to(db);
      await a.replicate.from(db);
      const conflict = await loadSongV2Snapshot(a, "better-test", true);
      const originalPut = a.put.bind(a);
      let allowed = true;
      const puts = jest.spyOn(a, "put").mockImplementation(async document => {
        const result = await originalPut(document);
        allowed = false;
        return result;
      });
      const removes = jest.spyOn(a, "remove");

      await expect(loadReconciledSongV2Snapshot(a, "better-test", conflict, () => allowed))
        .rejects.toBeInstanceOf(SongV2MutationNotAuthorizedError);
      expect(puts).toHaveBeenCalledTimes(1);
      expect(removes).not.toHaveBeenCalled();
      expect((await loadSongV2Snapshot(a, "better-test", true)).conflicts).toHaveLength(1);
    } finally { await a.destroy(); await b.destroy(); }
  });

  it.each(["mine", "theirs"])("retains overlapping replicated drafts until the explicit %s choice", async choice => {
    const peer = new PouchDB(`overlap-peer-${Math.random()}`, { adapter: "idb" });
    try {
      await peer.replicate.from(db);
      const baseline = await loadSong(db, "better-test");
      const draft = edit(baseline, 0, "alpha\nsecond\n");
      await saveSong(db, edit(baseline, 0, "alpha\nfirst\n"), baseline);
      await saveSong(peer, draft, baseline);
      await peer.replicate.to(db);
      const before = await loadSongV2Snapshot(db, baseline._id, true);
      const put = jest.spyOn(db, "put");
      const remove = jest.spyOn(db, "remove");
      const unresolved = await loadReconciledSongV2Snapshot(db, baseline._id, undefined, () => true);
      expect(unresolved.conflicts).toHaveLength(2);
      expect(put).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(before.conflicts?.length).toBe(2);
      const versions = await loadSongV2ConflictRevisionOptions(db, before);
      const selectedText = choice === "mine" ? "second" : "first";
      const choices = Object.fromEntries(versions.map(entry => {
        const selected = entry.options.find(option => {
          const document = option.document;
          return document.docType === "song-v2-arrangement"
            ? document.formattedLyrics.some(lyric => lyric.words.includes(selectedText))
            : document.docType === "song-v2-slide" &&
              document.boxes.some(box => box.words?.includes(selectedText));
        });
        return [entry.conflict.documentId, selected?.revision ?? entry.conflict.winningRevision];
      }));
      const selection = await buildSongV2RevisionSelection(db, before, versions, choices);
      const resolved = await resolveSongV2ConflictReview(
        db, before, selection.song, before.conflicts!, selection.sourceRevisions,
        () => true,
      );
      expect(resolved.conflictsRetired).toBe(true);
      expect(resolved.song.arrangements[0].formattedLyrics[0].words).toContain(selectedText);
      const loaded = await loadSongV2Snapshot(db, baseline._id, true);
      expect(loaded.conflicts).toBeUndefined();
      expect(loaded.hydrated.arrangements).toEqual(resolved.song.arrangements);
      expect(loaded.hydrated.arrangements[0].slides.filter(s => s.name.startsWith("Verse 1")).map(s => s.boxes[1].words).join(""))
        .toBe(loaded.hydrated.arrangements[0].formattedLyrics[0].words);
      await peer.replicate.from(db);
      expect((await loadSongV2Snapshot(peer, baseline._id, true)).conflicts).toBeUndefined();
    } finally { await peer.destroy(); }
  });

  it("lets a third browser review and resolve real revision leaves after both editors close", async () => {
    const browserA = new PouchDB(`closed-browser-a-${Math.random()}`, { adapter: "idb" });
    const browserB = new PouchDB(`closed-browser-b-${Math.random()}`, { adapter: "idb" });
    const reviewer = new PouchDB(`conflict-reviewer-${Math.random()}`, { adapter: "idb" });
    const observer = new PouchDB(`conflict-observer-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([browserA.replicate.from(db), browserB.replicate.from(db)]);
      const baselineA = await loadSong(browserA, "better-test");
      const baselineB = await loadSong(browserB, "better-test");
      await saveSong(browserA, edit(baselineA, 0, "alpha\nfirst\n"), baselineA);
      await saveSong(browserB, edit(baselineB, 0, "alpha\nsecond\n"), baselineB);
      await browserA.replicate.to(db);
      await browserB.replicate.to(db);

      // The original editor databases are closed before the third browser arrives.
      await browserA.destroy();
      await browserB.destroy();
      await Promise.all([reviewer.replicate.from(db), observer.replicate.from(db)]);

      const reviewed = await loadSongV2Snapshot(reviewer, "better-test", true);
      expect(reviewed.conflicts?.length).toBeGreaterThan(0);
      const reads = jest.spyOn(reviewer, "get");
      const puts = jest.spyOn(reviewer, "put");
      const removes = jest.spyOn(reviewer, "remove");
      const revisionReadCount = reads.mock.calls.filter(([, options]) => options?.revs).length;
      const readOnly = await loadSong(reviewer, "better-test");
      expect(["first", "second"].some(choice =>
        readOnly.arrangements[0].formattedLyrics[0].words.includes(choice),
      )).toBe(true);
      expect((await loadSongV2Snapshot(reviewer, "better-test", true)).conflicts?.length).toBeGreaterThan(0);
      expect(reads.mock.calls.filter(([, options]) => options?.revs)).toHaveLength(revisionReadCount);
      expect(puts).not.toHaveBeenCalled();
      expect(removes).not.toHaveBeenCalled();

      const versions = await loadSongV2ConflictRevisionOptions(reviewer, reviewed);
      expect(versions.every(entry => entry.options.length >= 2)).toBe(true);
      expect(versions.some(entry => entry.options.some(option =>
        option.document.docType === "song-v2-arrangement" &&
        option.document.formattedLyrics.some(lyric => lyric.words.includes("first")),
      ))).toBe(true);
      expect(versions.some(entry => entry.options.some(option =>
        option.document.docType === "song-v2-arrangement" &&
        option.document.formattedLyrics.some(lyric => lyric.words.includes("second")),
      ))).toBe(true);

      const choices = Object.fromEntries(versions.map(entry => {
        const chosen = entry.options.find(option => {
          const doc = option.document;
          return doc.docType === "song-v2-arrangement"
            ? doc.formattedLyrics.some(lyric => lyric.words.includes("second"))
            : doc.docType === "song-v2-slide" && doc.boxes.some(box => box.words?.includes("second"));
        });
        return [entry.conflict.documentId, chosen?.revision ?? entry.conflict.winningRevision];
      }));
      const selection = await buildSongV2RevisionSelection(reviewer, reviewed, versions, choices);
      expect(selection.song.arrangements[0].formattedLyrics[0].words).toContain("second");
      expect(selection.song.arrangements[0].slides.filter(slide => slide.name.startsWith("Verse 1"))
        .map(slide => slide.boxes[1].words).join(""))
        .toBe(selection.song.arrangements[0].formattedLyrics[0].words);
      const resolved = await resolveSongV2ConflictReview(
        reviewer, reviewed, selection.song, reviewed.conflicts!, selection.sourceRevisions,
        () => true,
      );
      expect(resolved.conflictsRetired).toBe(true);
      expect(resolved.song.arrangements[0].formattedLyrics[0].words).toContain("second");
      expect(resolved.song.arrangements[0].slides.filter(slide => slide.name.startsWith("Verse 1"))
        .map(slide => slide.boxes[1].words).join(""))
        .toBe(resolved.song.arrangements[0].formattedLyrics[0].words);
      expect((await loadSongV2Snapshot(reviewer, "better-test", true)).conflicts).toBeUndefined();
      expect((await loadSong(reviewer, "better-test")).arrangements[0].formattedLyrics[0].words)
        .toBe("alpha\nsecond\ngamma\ndelta");

      await reviewer.replicate.to(db);
      expect((await loadSong(reviewer, "better-test")).arrangements[0].formattedLyrics[0].words)
        .toBe("alpha\nsecond\ngamma\ndelta");
      await observer.replicate.from(db);
      expect((await loadSongV2Snapshot(observer, "better-test", true)).conflicts).toBeUndefined();
      const reviewerSong = await loadSong(reviewer, "better-test");
      const observerSong = await loadSong(observer, "better-test");
      expect(reviewerSong.arrangements[0].formattedLyrics[0].words).toBe("alpha\nsecond\ngamma\ndelta");
      expect(observerSong.arrangements[0].formattedLyrics[0].words).toBe("alpha\nsecond\ngamma\ndelta");
      expect(reviewerSong).toEqual(observerSong);
    } finally {
      await Promise.all([browserA.destroy().catch(() => undefined), browserB.destroy().catch(() => undefined), reviewer.destroy(), observer.destroy()]);
    }
  });

  it("does not discard an unseen revision that arrives after an explicit conflict decision", async () => {
    const peer = new PouchDB(`unseen-peer-${Math.random()}`, { adapter: "idb" });
    const unseen = new PouchDB(`unseen-third-${Math.random()}`, { adapter: "idb" });
    try {
      await peer.replicate.from(db); await unseen.replicate.from(db);
      const baseline = await loadSong(db, "better-test");
      await saveSong(db, edit(baseline, 0, "alpha\nfirst\n"), baseline);
      await saveSong(peer, edit(baseline, 0, "alpha\nsecond\n"), baseline);
      await peer.replicate.to(db);
      const displayed = await loadSongV2Snapshot(db, baseline._id, true);
      await saveSong(unseen, edit(baseline, 0, "alpha\nunseen\n"), baseline);
      const versions = await loadSongV2ConflictRevisionOptions(db, displayed);
      const choices = Object.fromEntries(versions.map(entry => [
        entry.conflict.documentId,
        entry.options.find(option => option.revision !== entry.conflict.winningRevision)?.revision ??
          entry.conflict.winningRevision,
      ]));
      const selection = await buildSongV2RevisionSelection(db, displayed, versions, choices);
      expect(selection.song.arrangements[0].formattedLyrics[0].words)
        .not.toBe(displayed.hydrated.arrangements[0].formattedLyrics[0].words);
      const originalPut = db.put.bind(db);
      let unseenReplicated = false;
      jest.spyOn(db, "put").mockImplementation(async document => {
        const result = await originalPut(document);
        if (!unseenReplicated) {
          unseenReplicated = true;
          await unseen.replicate.to(db);
        }
        return result;
      });
      const resolution = await resolveSongV2ConflictReview(
        db, displayed, selection.song, displayed.conflicts!, selection.sourceRevisions, () => true,
      );
      expect(unseenReplicated).toBe(true);
      expect(resolution.conflictsRetired).toBe(false);
      const remaining = await loadSongV2Snapshot(db, baseline._id, true);
      expect(remaining.conflicts?.length).toBe(2);
      const remainingOptions = await loadSongV2ConflictRevisionOptions(db, remaining);
      expect(remainingOptions.some(entry => entry.options.some(option =>
        option.document.docType === "song-v2-arrangement" &&
        option.document.formattedLyrics[0].words.includes("unseen"),
      ))).toBe(true);
    } finally { await peer.destroy(); await unseen.destroy(); }
  });

  it("rejects a reviewed choice when a newer branch arrives before the save", async () => {
    const peer = new PouchDB(`review-race-peer-${Math.random()}`, { adapter: "idb" });
    const unseen = new PouchDB(`review-race-unseen-${Math.random()}`, { adapter: "idb" });
    try {
      await Promise.all([peer.replicate.from(db), unseen.replicate.from(db)]);
      const baseline = await loadSong(db, "better-test");
      await saveSong(db, edit(baseline, 0, "alpha\nfirst\n"), baseline);
      await saveSong(peer, edit(baseline, 0, "alpha\nsecond\n"), baseline);
      await peer.replicate.to(db);
      await peer.replicate.from(db);
      const reviewed = await loadSongV2Snapshot(peer, baseline._id, true);
      const versions = await loadSongV2ConflictRevisionOptions(peer, reviewed);
      const choices = Object.fromEntries(versions.map(entry => [
        entry.conflict.documentId, entry.conflict.winningRevision,
      ]));
      const selection = await buildSongV2RevisionSelection(peer, reviewed, versions, choices);

      await saveSong(unseen, edit(baseline, 0, "alpha\nunseen\n"), baseline);
      await unseen.replicate.to(db);
      await peer.replicate.from(db);
      const puts = jest.spyOn(peer, "put");
      const removes = jest.spyOn(peer, "remove");
      await expect(resolveSongV2ConflictReview(
        peer, reviewed, selection.song, reviewed.conflicts!, selection.sourceRevisions,
        () => true,
      )).rejects.toBeInstanceOf(SongV2ConflictReviewStaleError);
      expect(puts).not.toHaveBeenCalled();
      expect(removes).not.toHaveBeenCalled();
      const remaining = (await loadSongV2Snapshot(peer, baseline._id, true)).conflicts ?? [];
      expect(remaining.reduce((total, conflict) => total + conflict.revisions.length, 0))
        .toBeGreaterThan(reviewed.conflicts!.reduce((total, conflict) => total + conflict.revisions.length, 0));
    } finally { await peer.destroy(); await unseen.destroy(); }
  });

  it("keeps a durable merged song editable when branch retirement fails", async () => {
    const peer = new PouchDB(`cleanup-retry-${Math.random()}`, { adapter: "idb" });
    try {
      await peer.replicate.from(db);
      const baseline = await loadSong(db, "better-test");
      await saveSong(db, edit(baseline, 0, "alpha\nbeta1\n"), baseline);
      await saveSong(peer, edit(baseline, 1, "gamma\ndelta1"), baseline);
      await peer.replicate.to(db);
      const put = jest.spyOn(db, "put");
      jest.spyOn(db, "remove").mockRejectedValueOnce(new Error("cleanup offline"));
      const first = await loadReconciledSongV2Snapshot(db, baseline._id, undefined, () => true);
      expect(put).toHaveBeenCalledTimes(1);
      expect(first.hydrated.arrangements[0].formattedLyrics[0].words)
        .toBe("alpha\nbeta1\ngamma\ndelta1");
      expect(first.conflicts).toBeUndefined();
      expect(put).toHaveBeenCalledTimes(1);

      // A fresh handle discards the WeakMap record and observes the actual
      // physical leaves that survived the failed retirement.
      const databaseName = db.name;
      await db.close();
      db = new PouchDB(databaseName, { adapter: "idb" });
      const restartedSnapshot = await loadSongV2Snapshot(db, baseline._id, true);
      expect(restartedSnapshot.physicalConflicts?.length).toBeGreaterThan(0);
      expect(restartedSnapshot.conflicts?.length).toBeGreaterThan(0);

      const restartPut = jest.spyOn(db, "put");
      const restartRemove = jest.spyOn(db, "remove").mockRejectedValueOnce(new Error("cleanup still offline"));
      const recovered = await loadReconciledSongV2Snapshot(db, baseline._id, restartedSnapshot, () => true);
      expect(restartPut).not.toHaveBeenCalled();
      expect(restartRemove).toHaveBeenCalled();
      expect(recovered.hydrated.arrangements[0].formattedLyrics[0].words)
        .toBe("alpha\nbeta1\ngamma\ndelta1");
      expect(recovered.conflicts).toBeUndefined();
      expect((await loadSongV2Snapshot(db, baseline._id, true)).conflicts).toBeUndefined();

      await db.close();
      db = new PouchDB(databaseName, { adapter: "idb" });
      const cleanupRetrySnapshot = await loadSongV2Snapshot(db, baseline._id, true);
      expect(cleanupRetrySnapshot.conflicts?.length).toBeGreaterThan(0);
      const retryPut = jest.spyOn(db, "put");
      const retryRemove = jest.spyOn(db, "remove");
      const cleanupRetried = await loadReconciledSongV2Snapshot(db, baseline._id, cleanupRetrySnapshot, () => true);
      expect(retryPut).not.toHaveBeenCalled();
      expect(retryRemove).toHaveBeenCalled();
      expect(cleanupRetried.conflicts).toBeUndefined();
      expect((await loadSongV2Snapshot(db, baseline._id, true)).physicalConflicts).toBeUndefined();

      const continued = await saveSong(db, editSection(cleanupRetried.hydrated, 1, "continued after restart cleanup failure"), cleanupRetried.hydrated);
      expect(continued.arrangements[0].formattedLyrics[1].words)
        .toBe("continued after restart cleanup failure");
    } finally { await peer.destroy(); }
  });

  it("grows and shrinks overflow without borrowing unrelated section identities", async () => {
    const baseline = await loadSong(db, "better-test");
    const draft = edit(baseline, 1, "gamma\ndelta\nepsilon\nzeta");
    const old = baseline.arrangements[0].slides;
    const grown = draft.arrangements[0].slides;
    expect(grown).toHaveLength(old.length + 1);
    expect(grown[3].id).not.toBe(old[3].id);
    expect(grown[4]).toEqual(old[3]);
    const saved = await saveSong(db, draft, baseline);
    expect(saved.arrangements[0].formattedLyrics[0].slideSpan).toBe(3);
    const shrinking = clone(saved);
    shrinking.arrangements[0].formattedLyrics[0].words = "alpha";
    const shrunk = formatSong({ ...shrinking, selectedSlide: 1, selectedBox: 1 } as ItemState) as DBItem;
    expect(shrunk.arrangements[0].slides[1].id).toBe(old[1].id);
    expect(shrunk.arrangements[0].slides[2]).toEqual(old[3]);
    await saveSong(db, shrunk, saved);
    expect((await loadSong(db, baseline._id)).arrangements[0].formattedLyrics[0].words).toBe("alpha");
  });

  it("merges separate text changes when one save adds an overflow page", async () => {
    const baseline = await loadSong(db, "better-test");
    const a = edit(baseline, 0, "alpha\nbeta\ninserted\n");
    const b = edit(baseline, 1, "gamma\ndelta1");
    await saveSong(db, a, baseline);
    const saved = await saveSong(db, b, baseline);
    expect(saved.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta\ninserted\ngamma\ndelta1");
    expect(saved.arrangements[0].slides.filter(s => s.name.startsWith("Verse 1")).map(s => s.boxes[1].words).join(""))
      .toBe(saved.arrangements[0].formattedLyrics[0].words);
  });

  it("allocates distinct identities for a newly added occurrence and a genuinely new section", () => {
    const source = fixture();
    source.arrangements[0].songOrder.push({ id: "repeat", name: "Verse 1" });
    const repeated = formatSong({ ...source, selectedSlide: 1, selectedBox: 1 } as ItemState);
    const ids = repeated.arrangements[0].slides.map(slide => slide.id);
    expect(new Set(ids).size).toBe(ids.length);
    const previousIds = source.arrangements[0].slides.filter(slide => slide.name.startsWith("Verse 1")).map(slide => slide.id);
    source.arrangements[0].songOrder[0].name = "Verse 2";
    source.arrangements[0].formattedLyrics[0].name = "Verse 2";
    const replaced = formatSong({ ...source, selectedSlide: 1, selectedBox: 1 } as ItemState);
    expect(replaced.arrangements[0].slides.filter(slide => slide.name.startsWith("Verse 2")).every(slide => !previousIds.includes(slide.id))).toBe(true);
  });
});
