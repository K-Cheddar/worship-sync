import type { DBItem, ItemSlideType, SongV2Documents } from "../types";
import {
  loadSong, loadSongV2Snapshot, serializeSongToV2Documents,
  type SongV2Snapshot,
} from "./songPersistence";
import {
  createSongV2, saveSongV2, planSongV2Changes, resumeSongV2Write,
  SongV2WriteError,
} from "./songV2Writer";
import { setAuditSnapshot } from "./pouchAudit";
import * as formatter from "./monitorSlideFormatter";

const slide = (id: string): ItemSlideType => ({
  id, type: "Verse", name: id,
  boxes: [{ id: `${id}-box`, words: id, width: 1920, height: 1080 }],
});
const song = (): DBItem => ({
  _id: "song-1", type: "song", name: "Song", selectedArrangement: 0, slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  arrangements: ["a", "b", "c"].map(id => ({
    id, name: id, formattedLyrics: [], songOrder: [],
    slides: [1, 2, 3].map(n => slide(`${id}${n}`)),
  })),
});
type Doc = SongV2Documents["root"] | SongV2Documents["arrangements"][number] | SongV2Documents["slides"][number];
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const notFound = () => Object.assign(new Error("not found"), { status: 404 });
const conflict = () => Object.assign(new Error("conflict"), { status: 409 });
function makeDb(source = song(), empty = false) {
  const serialized = serializeSongToV2Documents(source);
  const docs = new Map<string, Doc>();
  const documents = [serialized.root, ...serialized.arrangements, ...serialized.slides];
  documents.forEach(doc => {
    doc._rev = doc.docType === "song-v2-root" ? "4-root"
      : doc.docType === "song-v2-arrangement" ? "7-arr" : "13-slide";
    doc.createdAt = "original-time";
    doc.createdBy = "original-actor";
    doc.updatedAt = "prior-time";
    doc.updatedBy = "prior-actor";
    if (!empty) docs.set(doc._id, copy(doc));
  });
  const events: string[] = [];
  const failures = new Map<string, unknown>();
  const get = jest.fn(async (id: string) => {
    if (!docs.has(id)) throw notFound();
    return copy(docs.get(id));
  });
  const put = jest.fn(async (doc: Doc) => {
    events.push(`put ${doc._id}`);
    if (failures.has(doc._id)) throw failures.get(doc._id);
    const existing = docs.get(doc._id);
    if (existing ? existing._rev !== doc._rev : doc._rev !== undefined) throw conflict();
    const rev = `${Number(existing?._rev?.split("-")[0] ?? 0) + 1}-saved`;
    docs.set(doc._id, copy({ ...doc, _rev: rev }));
    return { ok: true, id: doc._id, rev };
  });
  const remove = jest.fn(async (id: string, rev: string) => {
    events.push(`remove ${id}`);
    if (failures.has(id)) throw failures.get(id);
    if (!docs.has(id)) throw notFound();
    if (docs.get(id)?._rev !== rev) throw conflict();
    docs.delete(id);
    return { ok: true, id, rev: "deleted" };
  });
  const allDocs = jest.fn(async ({ keys }: { keys: string[] }) => ({
    rows: keys.map(id => ({ id, key: id, doc: copy(docs.get(id) ?? null) })),
  }));
  return {
    db: { get, put, remove, allDocs } as unknown as PouchDB.Database,
    docs, put, remove, get, events, failures, serialized,
  };
}
const ids = (snapshot: SongV2Snapshot) => ({
  root: snapshot.root._id,
  arr: snapshot.arrangements[0]._id,
  slide: snapshot.slides[1]._id,
});
async function setup(source = song()) {
  const env = makeDb(source);
  const snapshot = await loadSongV2Snapshot(env.db, source._id);
  return { ...env, snapshot, desired: copy(snapshot.hydrated) };
}
const editSlide = (desired: DBItem, index: number, words = "Changed") => {
  desired.arrangements[0].slides[index].boxes[0].words = words;
};
async function writeError(promise: Promise<unknown>): Promise<SongV2WriteError> {
  const outcome = await promise.catch(error => error);
  expect(outcome).toBeInstanceOf(SongV2WriteError);
  return outcome as SongV2WriteError;
}

describe("isolated Song Schema v2 writer", () => {
  beforeEach(() => setAuditSnapshot({ displayName: "Current writer" }));
  afterEach(() => jest.restoreAllMocks());

  it("retains every physical revision and hides child revisions from hydration", async () => {
    const { snapshot } = await setup();
    expect(snapshot.root._rev).toBe("4-root");
    expect(snapshot.arrangements.map(doc => doc._rev)).toEqual(["7-arr", "7-arr", "7-arr"]);
    expect(snapshot.slides.map(doc => doc._rev)).toEqual(Array(9).fill("13-slide"));
    expect(snapshot.hydrated.arrangements[0]).not.toHaveProperty("_rev");
    expect(snapshot.hydrated.arrangements[0].slides[0]).not.toHaveProperty("_rev");
  });

  it("does no writes for unchanged content, audit-only changes, or reordered object keys", async () => {
    const { db, snapshot, desired, put, remove } = await setup();
    desired.updatedAt = "untrusted-new-time";
    desired.updatedBy = "untrusted-actor";
    desired.arrangements[0].slides[0].boxes[0] = {
      height: 1080, width: 1920, words: "a1", id: "a1-box",
    };
    const before = copy(snapshot);
    const plan = planSongV2Changes(snapshot, desired);
    expect(plan).toEqual({
      arrangements: { create: [], update: [], delete: [] },
      slides: { create: [], update: [], delete: [] },
    });
    const result = await saveSongV2(db, snapshot, desired);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(snapshot).toEqual(before);
    expect(result.snapshot).toEqual(before);
  });

  it("one slide edit writes EXACTLY slide 2 with its own revision; all parents and siblings stay byte-identical", async () => {
    const { db, docs, snapshot, desired, put, remove } = await setup();
    const before = copy([...docs]);
    editSlide(desired, 1);
    const plan = planSongV2Changes(snapshot, desired);
    expect(plan.root).toBeUndefined();
    expect(plan.arrangements.update).toEqual([]);
    expect(plan.slides.update.map(change => change.next._id)).toEqual([ids(snapshot).slide]);
    const result = await saveSongV2(db, snapshot, desired);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      _id: "song-v2:slide:song-1:a:a2", _rev: "13-slide",
      createdAt: "original-time", createdBy: "original-actor", updatedBy: "Current writer",
    }));
    expect(put.mock.calls[0][0].updatedAt).not.toBe("prior-time");
    expect(result.written).toEqual(["song-v2:slide:song-1:a:a2"]);
    expect(result.snapshot.slides.find(doc => doc.id === "a2")?._rev).toBe("14-saved");
    const untouched = before.filter(([id]) => id !== ids(snapshot).slide);
    expect([...docs].filter(([id]) => id !== ids(snapshot).slide)).toEqual(untouched);
    expect(remove).not.toHaveBeenCalled();
  });

  it("two changed slides write just their independent Couch documents", async () => {
    const { db, snapshot, desired, put } = await setup();
    editSlide(desired, 0);
    editSlide(desired, 2);
    const result = await saveSongV2(db, snapshot, desired);
    expect(result.written).toEqual([snapshot.slides[0]._id, snapshot.slides[2]._id]);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it.each(["name", "songMetadata", "songLinks", "songAudio", "background", "shouldSendTo", "shouldSkipTitle", "selectedArrangement"] as const)(
    "%s edit touches root only and preserves child identities", async field => {
      const { db, snapshot, desired, put, docs } = await setup();
      const changes: Partial<DBItem> = {
        name: "Renamed", background: "new.jpg", shouldSkipTitle: true, selectedArrangement: 1,
        shouldSendTo: { projector: true, monitor: false, stream: true },
        songMetadata: { source: "manual", trackName: "Track", artistName: "Artist", importedAt: "time" },
        songLinks: [{ id: "link", label: "Chart", url: "https://example.test" }],
        songAudio: { id: "audio", key: "audio.mp3", fileName: "audio.mp3", contentType: "audio/mpeg", sizeBytes: 100, uploadedAt: "time" },
      };
      Object.assign(desired, { [field]: changes[field] });
      const childDocs = [...docs].filter(([id]) => id !== snapshot.root._id);
      const result = await saveSongV2(db, snapshot, desired);
      expect(result.written).toEqual([snapshot.root._id]);
      expect(put).toHaveBeenCalledWith(expect.objectContaining({ _rev: "4-root" }));
      expect([...docs].filter(([id]) => id !== snapshot.root._id)).toEqual(childDocs);
    },
  );

  it.each(["name", "formattedLyrics", "songOrder", "monitorLayout"] as const)(
    "%s edit in B touches arrangement B only", async field => {
      const { db, snapshot, desired, put } = await setup();
      const changes = {
        name: "B changed",
        formattedLyrics: [{ id: "lyrics", type: "Verse", name: "Verse", words: "New lyrics", slideSpan: 1 }],
        songOrder: [{ id: "order", name: "Verse" }],
        monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 28 },
      };
      Object.assign(desired.arrangements[1], { [field]: changes[field] });
      const result = await saveSongV2(db, snapshot, desired);
      expect(result.written).toEqual([snapshot.arrangements[1]._id]);
      expect(put).toHaveBeenCalledTimes(1);
      expect(put).toHaveBeenCalledWith(expect.objectContaining({ _rev: "7-arr" }));
    },
  );

  it("reordering arrangements writes only root manifest", async () => {
    const { db, snapshot, desired, put } = await setup();
    desired.arrangements.reverse();
    const result = await saveSongV2(db, snapshot, desired);
    expect(result.written).toEqual([snapshot.root._id]);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ arrangementIds: ["c", "b", "a"] }));
  });

  it("reordering slides writes only their arrangement manifest", async () => {
    const { db, snapshot, desired, put } = await setup();
    desired.arrangements[0].slides.reverse();
    const result = await saveSongV2(db, snapshot, desired);
    expect(result.written).toEqual([snapshot.arrangements[0]._id]);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ slideIds: ["a3", "a2", "a1"] }));
  });

  it("creates a slide before its manifest and stamps new document audit locally", async () => {
    const { db, snapshot, desired, events, put } = await setup();
    desired.arrangements[0].slides.push(slide("new"));
    const result = await saveSongV2(db, snapshot, desired);
    expect(events).toEqual(["put song-v2:slide:song-1:a:new", `put ${snapshot.arrangements[0]._id}`]);
    expect(result.created).toEqual(["song-v2:slide:song-1:a:new"]);
    expect(put.mock.calls[0][0]).toEqual(expect.objectContaining({ createdBy: "Current writer", updatedBy: "Current writer" }));
    expect(put.mock.calls[0][0].createdAt).not.toBe("original-time");
    expect(put.mock.calls[0][0]).not.toHaveProperty("_rev");
    expect((await loadSongV2Snapshot(db, "song-1")).slides).toHaveLength(10);
  });

  it("failed slide create never publishes its reference", async () => {
    const { db, snapshot, desired, failures, events } = await setup();
    desired.arrangements[0].slides.push(slide("new"));
    failures.set("song-v2:slide:song-1:a:new", new Error("disk"));
    const error = await writeError(saveSongV2(db, snapshot, desired));
    expect(events).toEqual(["put song-v2:slide:song-1:a:new"]);
    expect(error.progress.written).toEqual([]);
    expect((await loadSongV2Snapshot(db, "song-1")).arrangements[0].slideIds).toEqual(["a1", "a2", "a3"]);
  });

  it("manifest failure leaves ignored orphan; explicit retry skips committed child", async () => {
    const { db, snapshot, desired, failures, events, docs } = await setup();
    desired.arrangements[0].slides.push(slide("new"));
    failures.set(snapshot.arrangements[0]._id, new Error("offline"));
    const error = await writeError(saveSongV2(db, snapshot, desired));
    expect(error.progress.created).toEqual(["song-v2:slide:song-1:a:new"]);
    expect(docs.has("song-v2:slide:song-1:a:new")).toBe(true);
    expect((await loadSongV2Snapshot(db, "song-1")).slides).toHaveLength(9);
    failures.clear();
    const result = await resumeSongV2Write(db, error);
    expect(events).toEqual(["put song-v2:slide:song-1:a:new", `put ${snapshot.arrangements[0]._id}`, `put ${snapshot.arrangements[0]._id}`]);
    expect(result.snapshot.slides).toHaveLength(10);
    expect(error.progress.written).toEqual(["song-v2:slide:song-1:a:new"]);
  });

  it("new arrangement publishes slides then arrangement then root", async () => {
    const { db, snapshot, desired, events } = await setup();
    desired.arrangements.push({ id: "new", name: "New", formattedLyrics: [], songOrder: [], slides: [slide("n1"), slide("n2")] });
    await saveSongV2(db, snapshot, desired);
    expect(events).toEqual([
      "put song-v2:slide:song-1:new:n1", "put song-v2:slide:song-1:new:n2",
      "put song-v2:arrangement:song-1:new", `put ${snapshot.root._id}`,
    ]);
  });

  it.each(["song-v2:slide:song-1:new:n2", "song-v2:arrangement:song-1:new"])(
    "new arrangement prerequisite failure at %s cannot activate root", async failing => {
      const { db, snapshot, desired, failures, events } = await setup();
      desired.arrangements.push({ id: "new", name: "New", formattedLyrics: [], songOrder: [], slides: [slide("n1"), slide("n2")] });
      failures.set(failing, new Error("failed"));
      await writeError(saveSongV2(db, snapshot, desired));
      expect(events).not.toContain(`put ${snapshot.root._id}`);
      expect((await loadSongV2Snapshot(db, "song-1")).root.arrangementIds).toEqual(["a", "b", "c"]);
    },
  );

  it("removes a slide reference before cleanup using slide revision", async () => {
    const { db, snapshot, desired, events, remove } = await setup();
    desired.arrangements[0].slides.splice(1, 1);
    const result = await saveSongV2(db, snapshot, desired);
    expect(events).toEqual([`put ${snapshot.arrangements[0]._id}`, `remove ${snapshot.slides[1]._id}`]);
    expect(remove).toHaveBeenCalledWith(snapshot.slides[1]._id, "13-slide");
    expect(result.deleted).toEqual([snapshot.slides[1]._id]);
  });

  it("removes arrangement from root before arrangement and slide cleanup", async () => {
    const { db, snapshot, desired, events, remove } = await setup();
    desired.arrangements.splice(1, 1);
    await saveSongV2(db, snapshot, desired);
    expect(events).toEqual([
      `put ${snapshot.root._id}`, `remove ${snapshot.arrangements[1]._id}`,
      ...snapshot.slides.filter(doc => doc.arrangementId === "b").map(doc => `remove ${doc._id}`),
    ]);
    expect(remove).toHaveBeenCalledWith(snapshot.arrangements[1]._id, "7-arr");
  });

  it("failed removal manifest does no cleanup", async () => {
    const { db, snapshot, desired, failures, remove } = await setup();
    desired.arrangements[0].slides.pop();
    failures.set(snapshot.arrangements[0]._id, conflict());
    await writeError(saveSongV2(db, snapshot, desired));
    expect(remove).not.toHaveBeenCalled();
  });

  it("cleanup failure reports separately while logical removal remains successful", async () => {
    const { db, snapshot, desired, failures, docs } = await setup();
    desired.arrangements.splice(1, 1);
    const cause = conflict();
    failures.set(snapshot.arrangements[1]._id, cause);
    failures.set(snapshot.slides[3]._id, cause);
    const result = await saveSongV2(db, snapshot, desired);
    expect(result.cleanupErrors).toEqual([
      { documentId: snapshot.arrangements[1]._id, revision: snapshot.arrangements[1]._rev, cause },
      { documentId: snapshot.slides[3]._id, revision: snapshot.slides[3]._rev, cause },
    ]);
    expect(result.deleted).toEqual([snapshot.slides[4]._id, snapshot.slides[5]._id]);
    expect(docs.has(snapshot.arrangements[1]._id)).toBe(true);
    expect((await loadSongV2Snapshot(db, "song-1")).hydrated.arrangements.map(arr => arr.id)).toEqual(["a", "c"]);
  });

  it("root and slide optional fields are removed rather than merged from persisted state", async () => {
    const source = song();
    source.background = "old";
    source.songMetadata = { source: "manual", trackName: "Track", artistName: "Artist", importedAt: "time" };
    source.songLinks = [{ id: "link", label: "Link", url: "https://example.test" }];
    source.songAudio = { id: "audio", key: "a.mp3", fileName: "a.mp3", contentType: "audio/mpeg", sizeBytes: 1, uploadedAt: "time" };
    source.arrangements[0].slides[0].mediaSource = { kind: "local-video-input", sourceId: "camera", label: "Camera" };
    source.arrangements[0].slides[0].formattedTextDisplayInfo = { heading: "Heading" } as ItemSlideType["formattedTextDisplayInfo"];
    const { db, snapshot, desired, docs } = await setup(source);
    delete desired.background;
    delete desired.songMetadata;
    delete desired.songLinks;
    delete desired.songAudio;
    delete desired.arrangements[0].slides[0].mediaSource;
    delete desired.arrangements[0].slides[0].formattedTextDisplayInfo;
    await saveSongV2(db, snapshot, desired);
    expect(docs.get(snapshot.root._id)).not.toHaveProperty("background");
    expect(docs.get(snapshot.root._id)).not.toHaveProperty("songMetadata");
    expect(docs.get(snapshot.root._id)).not.toHaveProperty("songLinks");
    expect(docs.get(snapshot.root._id)).not.toHaveProperty("songAudio");
    expect(docs.get(snapshot.slides[0]._id)).not.toHaveProperty("mediaSource");
    expect(docs.get(snapshot.slides[0]._id)).not.toHaveProperty("formattedTextDisplayInfo");
  });

  it("removes arrangement monitor layout without deriving a replacement or measuring DOM", async () => {
    const source = song();
    source.arrangements[0].monitorLayout = { currentFontSizePx: 30, nextFontSizePx: 28 };
    const measurement = jest.spyOn(formatter, "getMonitorLayoutForSlides").mockImplementation(() => {
      throw new Error("must not measure");
    });
    const { db, snapshot, desired, docs } = await setup(source);
    delete desired.arrangements[0].monitorLayout;
    const result = await saveSongV2(db, snapshot, desired);
    expect(result.written).toEqual([snapshot.arrangements[0]._id]);
    expect(docs.get(snapshot.arrangements[0]._id)).not.toHaveProperty("monitorLayout");
    expect(measurement).not.toHaveBeenCalled();
  });

  it("conflict is surfaced without reading a fresh revision or overwriting", async () => {
    const { db, snapshot, desired, docs, put, get } = await setup();
    editSlide(desired, 1);
    const concurrent = docs.get(ids(snapshot).slide)!;
    docs.set(concurrent._id, { ...concurrent, _rev: "14-other" });
    get.mockClear();
    const error = await writeError(saveSongV2(db, snapshot, desired));
    expect(error.status).toBe(409);
    expect(error.documentId).toBe(ids(snapshot).slide);
    expect(put).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(docs.get(concurrent._id)?._rev).toBe("14-other");
  });

  it("two users editing different slides from the SAME baseline do not compete for revisions", async () => {
    const { db, snapshot, desired, put } = await setup();
    const other = copy(desired);
    editSlide(desired, 0, "User A");
    editSlide(other, 1, "User B");
    await saveSongV2(db, snapshot, desired);
    await saveSongV2(db, snapshot, other);
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([snapshot.slides[0]._id, snapshot.slides[1]._id]);
    const loaded = await loadSongV2Snapshot(db, "song-1");
    expect(loaded.hydrated.arrangements[0].slides.slice(0, 2).map(doc => doc.boxes[0].words)).toEqual(["User A", "User B"]);
  });

  it("same-slide concurrent edit conflicts, while root/slide and arrangement A/B edits remain independent", async () => {
    const { db, snapshot, desired } = await setup();
    const other = copy(desired);
    editSlide(desired, 0, "First");
    editSlide(other, 0, "Second");
    await saveSongV2(db, snapshot, desired);
    const error = await writeError(saveSongV2(db, snapshot, other));
    expect(error.status).toBe(409);
    const rootEdit = copy(snapshot.hydrated);
    rootEdit.name = "Renamed";
    await saveSongV2(db, snapshot, rootEdit);
    const arrA = copy(snapshot.hydrated);
    arrA.arrangements[0].name = "A edited";
    const arrB = copy(snapshot.hydrated);
    arrB.arrangements[1].name = "B edited";
    await saveSongV2(db, snapshot, arrA);
    await saveSongV2(db, snapshot, arrB);
    const loaded = await loadSongV2Snapshot(db, "song-1");
    expect(loaded.hydrated.name).toBe("Renamed");
    expect(loaded.hydrated.arrangements.slice(0, 2).map(arr => arr.name)).toEqual(["A edited", "B edited"]);
    expect(loaded.hydrated.arrangements[0].slides[0].boxes[0].words).toBe("First");
  });

  it("required partial failure includes durable progress and retry resumes after it", async () => {
    const { db, snapshot, desired, failures, events } = await setup();
    editSlide(desired, 0);
    editSlide(desired, 1);
    editSlide(desired, 2);
    failures.set(snapshot.slides[1]._id, new Error("offline"));
    const error = await writeError(saveSongV2(db, snapshot, desired));
    expect(error.progress.written).toEqual([snapshot.slides[0]._id]);
    expect(error.remainingDocumentIds).toEqual([snapshot.slides[1]._id, snapshot.slides[2]._id]);
    failures.clear();
    const result = await resumeSongV2Write(db, error);
    expect(events).toEqual([
      `put ${snapshot.slides[0]._id}`, `put ${snapshot.slides[1]._id}`,
      `put ${snapshot.slides[1]._id}`, `put ${snapshot.slides[2]._id}`,
    ]);
    expect(result.written).toEqual(snapshot.slides.slice(0, 3).map(doc => doc._id));
  });

  it("detaches pending work from a draft changed to another identity during the write", async () => {
    const { db, snapshot, desired, put, docs } = await setup();
    editSlide(desired, 0, "Original owner");
    editSlide(desired, 1, "Captured second");
    const actualPut = put.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    put.mockImplementationOnce(async doc => {
      await gate;
      return actualPut(doc);
    });
    const pending = saveSongV2(db, snapshot, desired);
    desired._id = "different-song";
    editSlide(desired, 1, "Changed while pending");
    snapshot.root.songId = "different-song";
    release();
    const result = await pending;
    expect(result.song._id).toBe("song-1");
    expect(docs.get("song-v2:slide:song-1:a:a2")).toEqual(expect.objectContaining({
      boxes: [expect.objectContaining({ words: "Captured second" })],
    }));
  });

  it("a mixed edit applies deliberately different revisions to their own physical documents", async () => {
    const { db, snapshot, desired, put } = await setup();
    desired.name = "Root edit";
    desired.arrangements[0].name = "Arrangement edit";
    editSlide(desired, 1);
    await saveSongV2(db, snapshot, desired);
    expect(put.mock.calls.map(([doc]) => [doc._id, doc._rev])).toEqual([
      [snapshot.slides[1]._id, "13-slide"],
      [snapshot.arrangements[0]._id, "7-arr"],
      [snapshot.root._id, "4-root"],
    ]);
  });

  it("explicit undefined removes optional fields just like absence", async () => {
    const source = song();
    source.background = "old.jpg";
    source.arrangements[0].slides[0].mediaSource = { kind: "local-video-input", sourceId: "camera", label: "Camera" };
    const { db, snapshot, desired, docs } = await setup(source);
    desired.background = undefined;
    desired.arrangements[0].slides[0].mediaSource = undefined;
    await saveSongV2(db, snapshot, desired);
    expect(docs.get(snapshot.root._id)).not.toHaveProperty("background");
    expect(docs.get(snapshot.slides[0]._id)).not.toHaveProperty("mediaSource");
  });

  it("new arrangement root conflict leaves ignored children and explicit retry skips them", async () => {
    const { db, snapshot, desired, failures, events } = await setup();
    desired.arrangements.push({ id: "new", name: "New", formattedLyrics: [], songOrder: [], slides: [slide("n1")] });
    failures.set(snapshot.root._id, conflict());
    const error = await writeError(saveSongV2(db, snapshot, desired));
    expect(error.status).toBe(409);
    expect(error.progress.created).toEqual([
      "song-v2:slide:song-1:new:n1", "song-v2:arrangement:song-1:new",
    ]);
    expect((await loadSongV2Snapshot(db, "song-1")).root.arrangementIds).toEqual(["a", "b", "c"]);
    // Resolve only the injected failure; no fresh revision is loaded or adopted.
    failures.clear();
    await resumeSongV2Write(db, error);
    expect(events).toEqual([
      "put song-v2:slide:song-1:new:n1", "put song-v2:arrangement:song-1:new",
      `put ${snapshot.root._id}`, `put ${snapshot.root._id}`,
    ]);
    expect((await loadSongV2Snapshot(db, "song-1")).root.arrangementIds).toEqual(["a", "b", "c", "new"]);
  });
  it("rejects wrong-owner and missing revision writes before any mutation", async () => {
    const { db, snapshot, desired, put } = await setup();
    desired._id = "other";
    await expect(saveSongV2(db, snapshot, desired)).rejects.toThrow("another song");
    desired._id = "song-1";
    editSlide(desired, 0);
    delete snapshot.slides[0]._rev;
    await expect(saveSongV2(db, snapshot, desired)).rejects.toThrow("Missing revision");
    expect(put).not.toHaveBeenCalled();
  });

  it("new song activation is slides then arrangements then root, with no legacy song document", async () => {
    const source = song();
    const { db, events, docs } = makeDb(source, true);
    const result = await createSongV2(db, source);
    expect(events).toEqual([
      ...result.snapshot.slides.map(doc => `put ${doc._id}`),
      ...result.snapshot.arrangements.map(doc => `put ${doc._id}`),
      `put ${result.snapshot.root._id}`,
    ]);
    expect(docs.has(source._id)).toBe(false);
    expect((await loadSong(db, source._id)).name).toBe(source.name);
  });

  it.each(["song-v2:slide:song-1:a:a2", "song-v2:arrangement:song-1:b", "song-v2:root:song-1"])(
    "creation failure at %s leaves no active v2 root and can resume without recreating durable children", async failing => {
      const source = song();
      const { db, docs, failures, events } = makeDb(source, true);
      failures.set(failing, new Error("failed"));
      const error = await writeError(createSongV2(db, source));
      expect(docs.has("song-v2:root:song-1")).toBe(false);
      await expect(loadSong(db, source._id)).rejects.toMatchObject({ status: 404 });
      const committed = [...error.progress.written];
      failures.clear();
      const result = await resumeSongV2Write(db, error);
      expect((await loadSong(db, source._id)).name).toBe(source.name);
      expect(committed.map(id => events.filter(event => event === `put ${id}`).length)).toEqual(committed.map(() => 1));
      expect(result.written).toHaveLength(13);
    },
  );
});


