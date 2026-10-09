import type { MediaType } from "../types";
import { PREFERENCES_POUCH_ID } from "../types";
import { replaceMediaReferencesForReplacement, sweepMediaReferencesBeforeDelete } from "./mediaReferenceSweep";

const prefs = {
  _id: PREFERENCES_POUCH_ID,
  _rev: "1-prefs",
  preferences: {
    defaultSongBackground: { background: "song-default" },
    defaultTimerBackground: { background: "" },
    defaultBibleBackground: { background: "bible-default" },
    defaultFreeFormBackground: { background: "free-default" },
  },
};
const oldMedia = { id: "old", type: "image", background: "https://cdn.example/old.png" } as MediaType;
const newMedia = { ...oldMedia, id: "new", background: "https://cdn.example/new.png" } as MediaType;
const slide = (id: string, docType?: string) => ({
  _id: id,
  _rev: "4-slide",
  ...(docType ? { docType, songId: "song-1", arrangementId: "arr-1" } : { type: "free" }),
  id: "slide-1",
  name: "Slide",
  type: "Section",
  boxes: [{ background: oldMedia.background, mediaInfo: oldMedia, words: "Keep lyrics" }],
});

const dbWith = (docs: Record<string, any>[]) => {
  const byId = new Map(docs.map(doc => [doc._id, doc]));
  const put = jest.fn(async (doc: Record<string, any>) => {
    byId.set(doc._id, { ...doc, _rev: "5-saved" });
    return { rev: "5-saved" };
  });
  const db = {
    get: jest.fn(async (id: string) => byId.get(id) ?? Promise.reject(Object.assign(new Error("missing"), { status: 404 }))),
    put,
    allDocs: jest.fn(async () => ({ rows: [...byId.values()].map(doc => ({ id: doc._id, doc })) })),
  } as unknown as PouchDB.Database;
  return { db, put, byId };
};

describe("v2 media reference cleanup", () => {
  const root = {
    _id: "song-v2:root:song-1", _rev: "2-root", docType: "song-v2-root",
    songId: "song-1", songSchemaVersion: 2, name: "Song", arrangementIds: [],
    background: oldMedia.background,
  };
  const legacy = {
    _id: "song-1", _rev: "8-legacy", type: "song", name: "Legacy song",
    slides: [],
    arrangements: [{ id: "legacy-arr", name: "Master", formattedLyrics: [], songOrder: [], slides: [{
      id: "legacy-slide", type: "Verse", name: "Verse 1",
      boxes: [{ background: oldMedia.background, mediaInfo: oldMedia, words: "Keep lyrics" }],
    }] }],
    background: "",
    shouldSendTo: { projector: true, monitor: true, stream: true },
  };

  it("clears v1 and v2 references by writing each v2 physical document at its own revision", async () => {
    const v2Slide = slide("song-v2:slide:song-1:arr-1:slide-1", "song-v2-slide");
    const { db, put } = dbWith([prefs, root, v2Slide, legacy]);

    const result = await sweepMediaReferencesBeforeDelete(db, new Set([oldMedia.id]), [oldMedia]);

    expect(result.ok).toBe(true);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ _id: v2Slide._id, _rev: "4-slide" }));
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      _id: root._id,
      _rev: "2-root",
      background: expect.stringContaining("WorshipBackground_ycr280"),
    }));
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ _id: legacy._id, _rev: "8-legacy" }));
  });

  it("replaces references in v1 items and v2 slide documents", async () => {
    const v2Slide = slide("song-v2:slide:song-1:arr-1:slide-1", "song-v2-slide");
    const { db, put, byId } = dbWith([prefs, root, v2Slide, legacy]);

    const result = await replaceMediaReferencesForReplacement(db, { oldMedia, newMedia });

    expect(result.ok).toBe(true);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ _id: v2Slide._id, _rev: "4-slide" }));
    expect(byId.get(v2Slide._id)!.boxes[0]).toEqual(expect.objectContaining({
      background: newMedia.background,
      mediaInfo: newMedia,
      words: "Keep lyrics",
    }));
    expect(byId.get(legacy._id)!.arrangements[0].slides[0].boxes[0].mediaInfo).toEqual(newMedia);
  });

  it("does not write unrelated v2 slides during media deletion", async () => {
    const unrelated = {
      ...slide("song-v2:slide:song-1:arr-1:unrelated", "song-v2-slide"),
      boxes: [{ background: "other-image", mediaInfo: { id: "other", type: "image" }, words: "Leave me" }],
    };
    const { db, put } = dbWith([prefs, root, unrelated]);

    const result = await sweepMediaReferencesBeforeDelete(db, new Set([oldMedia.id]), [oldMedia]);

    expect(result.ok).toBe(true);
    expect(put).not.toHaveBeenCalledWith(expect.objectContaining({ _id: unrelated._id }));
  });

  it("rolls back v2 root and slide references if a later mixed-library write fails", async () => {
    const v2Slide = slide("song-v2:slide:song-1:arr-1:slide-1", "song-v2-slide");
    const { db, put, byId } = dbWith([prefs, root, v2Slide, legacy]);
    put.mockImplementation(async doc => {
      if (doc._id === legacy._id) throw Object.assign(new Error("write failed"), { id: legacy._id });
      byId.set(doc._id, { ...doc, _rev: "5-saved" });
      return { rev: "5-saved" };
    });

    const result = await replaceMediaReferencesForReplacement(db, { oldMedia, newMedia });

    expect(result).toMatchObject({ ok: false, rollbackStatus: "complete", failedDocIds: [legacy._id] });
    expect(byId.get(root._id)!.background).toBe(oldMedia.background);
    expect(byId.get(v2Slide._id)!.boxes[0]).toEqual(expect.objectContaining({
      background: oldMedia.background,
      mediaInfo: oldMedia,
      words: "Keep lyrics",
    }));
  });
});
