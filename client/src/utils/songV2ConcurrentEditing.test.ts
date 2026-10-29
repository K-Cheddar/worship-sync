import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItem, ItemState } from "../types";
import { createNewSlide } from "./slideCreation";
import { formatSong } from "./overflow";
import { createSongV2 } from "./songV2Writer";
import { loadSong, loadSongV2Snapshot, saveSong } from "./songPersistence";
import { itemSlice } from "../store/itemSlice";
import {
  buildSongV2RevisionSelection, loadReconciledSongV2Snapshot,
  loadSongV2ConflictRevisionOptions, pruneResolvedSongV2Conflicts,
  resolveSongV2ConflictReview, SongV2ConflictReviewStaleError, SongV2ReplicationConflictError,
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
    const snapshotA = await loadSongV2Snapshot(db, baseline._id);
    const savedA = await saveSong(db, a, baseline, undefined, snapshotA);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([
      `song-v2:slide:better-test:master:${a.arrangements[0].slides[1].id}`,
      "song-v2:arrangement:better-test:master",
    ]);
    const snapshotB = await loadSongV2Snapshot(db, baseline._id);
    const savedB = await saveSong(db, b, baseline, undefined, snapshotB);
    expect({ get: get.mock.calls.length, allDocs: allDocs.mock.calls.length,
      put: put.mock.calls.length, remove: remove.mock.calls.length })
      .toEqual({ get: 2, allDocs: 4, put: 4, remove: 0 });
    console.info("AFTER two-editor save calls", { get: get.mock.calls.length, allDocs: allDocs.mock.calls.length,
      put: put.mock.calls.length, remove: remove.mock.calls.length,
      written: put.mock.calls.map(([doc]) => doc._id) });
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
      const reconciled = mode === "reopen" ? { hydrated: await loadSong(a, baseA._id) }
        : await loadReconciledSongV2Snapshot(a, baseA._id);
      expect({ get: get.mock.calls.length, allDocs: allDocs.mock.calls.length,
        put: put.mock.calls.length, remove: remove.mock.calls.length })
        .toEqual({ get: 7, allDocs: 6, put: 1, remove: 1 });
      console.info("Eventual-branch reconciliation calls", { get: get.mock.calls.length, allDocs: allDocs.mock.calls.length,
        put: put.mock.calls.length, remove: remove.mock.calls.length });
      expect(reconciled.hydrated.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta1\ngamma\ndelta1");
      await a.replicate.to(db);
      await b.replicate.from(db);
      expect((await loadSongV2Snapshot(b, baseB._id, true)).conflicts).toBeUndefined();
      expect(await loadSong(a, baseA._id)).toEqual(await loadSong(b, baseB._id));
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
      await expect(loadReconciledSongV2Snapshot(db, baseline._id)).rejects.toBeInstanceOf(SongV2ReplicationConflictError);
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
      await expect(loadSong(reviewer, "better-test")).rejects.toBeInstanceOf(SongV2ReplicationConflictError);
      const revisionReadCount = reads.mock.calls.filter(([, options]) => options?.revs).length;
      await expect(loadSong(reviewer, "better-test")).rejects.toBeInstanceOf(SongV2ReplicationConflictError);
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
      const resolved = await resolveSongV2ConflictReview(
        reviewer, reviewed, selection.song, reviewed.conflicts!, selection.sourceRevisions,
      );
      expect(resolved.conflictsRetired).toBe(true);
      expect(resolved.song.arrangements[0].formattedLyrics[0].words).toContain("second");
      expect(resolved.song.arrangements[0].slides.filter(slide => slide.name.startsWith("Verse 1"))
        .map(slide => slide.boxes[1].words).join(""))
        .toBe(resolved.song.arrangements[0].formattedLyrics[0].words);
      expect((await loadSongV2Snapshot(reviewer, "better-test", true)).conflicts).toBeUndefined();

      await reviewer.replicate.to(db);
      await observer.replicate.from(db);
      expect((await loadSongV2Snapshot(observer, "better-test", true)).conflicts).toBeUndefined();
      expect(await loadSong(reviewer, "better-test")).toEqual(await loadSong(observer, "better-test"));
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
      const chosen = await saveSong(db, edit(displayed.hydrated, 0, "alpha\nchosen\n"), displayed.hydrated);
      await saveSong(unseen, edit(baseline, 0, "alpha\nunseen\n"), baseline);
      await unseen.replicate.to(db);
      await pruneResolvedSongV2Conflicts(db, chosen, displayed.conflicts!);
      const remaining = await loadSongV2Snapshot(db, baseline._id, true);
      expect(remaining.conflicts?.length).toBe(2);
      expect(remaining.hydrated.arrangements[0].formattedLyrics[0].words).toContain("chosen");
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
      )).rejects.toBeInstanceOf(SongV2ConflictReviewStaleError);
      expect(puts).not.toHaveBeenCalled();
      expect(removes).not.toHaveBeenCalled();
      const remaining = (await loadSongV2Snapshot(peer, baseline._id, true)).conflicts ?? [];
      expect(remaining.reduce((total, conflict) => total + conflict.revisions.length, 0))
        .toBeGreaterThan(reviewed.conflicts!.reduce((total, conflict) => total + conflict.revisions.length, 0));
    } finally { await peer.destroy(); await unseen.destroy(); }
  });

  it("retries failed branch retirement without repeating the durable merged write", async () => {
    const peer = new PouchDB(`cleanup-retry-${Math.random()}`, { adapter: "idb" });
    try {
      await peer.replicate.from(db);
      const baseline = await loadSong(db, "better-test");
      await saveSong(db, edit(baseline, 0, "alpha\nbeta1\n"), baseline);
      await saveSong(peer, edit(baseline, 1, "gamma\ndelta1"), baseline);
      await peer.replicate.to(db);
      const put = jest.spyOn(db, "put");
      jest.spyOn(db, "remove").mockRejectedValueOnce(new Error("cleanup offline"));
      await expect(loadReconciledSongV2Snapshot(db, baseline._id)).rejects.toThrow("cleanup offline");
      expect(put).toHaveBeenCalledTimes(1);
      const recovered = await loadReconciledSongV2Snapshot(db, baseline._id);
      expect(put).toHaveBeenCalledTimes(1);
      expect(recovered.hydrated.arrangements[0].formattedLyrics[0].words).toBe("alpha\nbeta1\ngamma\ndelta1");
      expect((await loadSongV2Snapshot(db, baseline._id, true)).conflicts).toBeUndefined();
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
