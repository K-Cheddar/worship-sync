import type { DBItem, ItemSlideType } from "../types";
import {
  createSong,
  deleteSong,
  loadItemWithSongHydration,
  loadSong,
  saveSong,
} from "./songPersistence";

const songSlide = (id: string): ItemSlideType => ({
  id,
  type: "Verse",
  name: "Verse 1",
  boxes: [{ id: `${id}-box`, words: "Lyrics", width: 1920, height: 1080 }],
});

const song = (overrides: Partial<DBItem> = {}): DBItem => ({
  _id: "song-1",
  _rev: "1-old",
  type: "song",
  name: "Song",
  selectedArrangement: 0,
  slides: [],
  arrangements: [{
    id: "arr-1",
    name: "Master",
    formattedLyrics: [],
    songOrder: [],
    monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 28 },
    slides: [songSlide("slide-1")],
  }],
  ...overrides,
} as DBItem);

const makeDb = (document: DBItem) => {
  const put = jest.fn(async (next: DBItem) => ({
    ok: true,
    id: next._id,
    rev: "2-new",
  }));
  const remove = jest.fn(async () => ({ ok: true, id: document._id, rev: "2-deleted" }));
  const db = {
    get: jest.fn(async () => document),
    put,
    remove,
  } as unknown as PouchDB.Database;
  return { db, put, remove };
};

describe("songPersistence", () => {
  it("loads canonical song slides and arrangement monitor layout", async () => {
    const source = song();
    const { db } = makeDb(source);

    const loaded = await loadSong(db, source._id);

    expect(loaded.slides).toEqual([]);
    expect(loaded.arrangements[0].slides).toEqual(source.arrangements[0].slides);
    expect(loaded.arrangements[0].monitorLayout).toEqual({
      currentFontSizePx: 30,
      nextFontSizePx: 28,
    });
  });

  it("leaves non-song documents unchanged on the exact-item read path", async () => {
    const freeItem = {
      _id: "free-1",
      _rev: "1-free",
      type: "free",
      slides: [songSlide("free-slide")],
    } as unknown as DBItem;
    const { db } = makeDb(freeItem);

    const loaded = await loadItemWithSongHydration(db, freeItem._id);

    expect(loaded).toBe(freeItem);
  });

  it("recovers selected-arrangement legacy slides and removes monitor clones", async () => {
    const rootSlide = {
      ...songSlide("legacy-root"),
      monitorCurrentBandBoxes: [{ id: "current-clone", fontSize: 32 }],
      monitorNextBandBoxes: [{ id: "next-clone", fontSize: 29 }],
    } as unknown as ItemSlideType;
    const source = song({
      slides: [rootSlide],
      selectedArrangement: 1,
      arrangements: [
        {
          id: "arr-full",
          name: "Full",
          formattedLyrics: [],
          songOrder: [],
          slides: [songSlide("other-arrangement")],
        },
        {
          id: "arr-empty",
          name: "Selected",
          formattedLyrics: [],
          songOrder: [],
          slides: [],
        },
      ],
    });
    const { db } = makeDb(source);

    const loaded = await loadSong(db, source._id);

    expect(loaded.slides).toEqual([]);
    expect(loaded.arrangements[0].slides[0].id).toBe("other-arrangement");
    expect(loaded.arrangements[1].slides[0].id).toBe("legacy-root");
    expect(loaded.arrangements[1].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(loaded.arrangements[1].slides[0]).not.toHaveProperty("monitorNextBandBoxes");
    expect(loaded.arrangements[1].monitorLayout).toEqual({
      currentFontSizePx: 32,
      nextFontSizePx: 29,
    });
  });

  it("creates canonical one-document songs with audit fields", async () => {
    const source = song({
      slides: [{
        ...songSlide("legacy-root"),
        monitorCurrentBandBoxes: [{ id: "root-clone" }],
      } as unknown as ItemSlideType],
      monitorLayout: { currentFontSizePx: 18, nextFontSizePx: 17 },
      selectedArrangement: 1,
      arrangements: [{
        ...song().arrangements[0],
        monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 28 },
        slides: [{
          ...songSlide("arrangement-slide"),
          monitorNextBandBoxes: [{ id: "arrangement-clone" }],
        } as unknown as ItemSlideType],
      }, {
        id: "arr-empty",
        name: "Selected",
        formattedLyrics: [],
        songOrder: [],
        slides: [],
      }],
    });
    delete source._rev;
    const { db, put } = makeDb(source);

    await createSong(db, source);

    const persisted = put.mock.calls[0][0];
    expect(persisted).not.toHaveProperty("_rev");
    expect(persisted).not.toHaveProperty("slides");
    expect(persisted).not.toHaveProperty("monitorLayout");
    expect(persisted).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(persisted).not.toHaveProperty("monitorNextBandBoxes");
    expect(persisted.arrangements[0].slides[0].id).toBe("arrangement-slide");
    expect(persisted.arrangements[0].monitorLayout).toEqual({
      currentFontSizePx: 30,
      nextFontSizePx: 28,
    });
    expect(persisted.arrangements[0].slides[0]).not.toHaveProperty("monitorNextBandBoxes");
    expect(persisted.arrangements[1].slides[0].id).toBe("legacy-root");
    expect(persisted.arrangements[1].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(persisted.createdAt).toEqual(expect.any(String));
    expect(persisted.updatedBy).toEqual(expect.any(String));
  });

  it("updates one canonical song while preserving revision and untouched metadata", async () => {
    const existing = song({
      _rev: "3-current",
      createdAt: "created",
      createdBy: "original creator",
      songAudio: { id: "audio-1" } as DBItem["songAudio"],
    });
    const { db, put } = makeDb(existing);

    const edited = {
      _id: existing._id,
      _rev: "stale-redux-revision",
      type: "song",
      name: "Edited",
      selectedArrangement: 0,
      arrangements: existing.arrangements,
    } as DBItem;
    const saved = await saveSong(db, edited, existing);

    const persisted = put.mock.calls[0][0];
    expect(persisted._rev).toBe("3-current");
    expect(persisted.createdAt).toBe("created");
    expect(persisted.createdBy).toBe("original creator");
    expect(persisted.songAudio).toEqual({ id: "audio-1" });
    expect(persisted.name).toBe("Edited");
    expect(persisted).not.toHaveProperty("slides");
    expect(persisted.arrangements[0].slides[0].id).toBe("slide-1");
    expect(saved._rev).toBe("2-new");
    expect(saved.slides).toEqual([]);
  });

  it("deletes the requested single song document", async () => {
    const source = song();
    const { db, remove } = makeDb(source);

    const deleted = await deleteSong(db, source._id);

    expect(db.get).toHaveBeenCalledWith(source._id);
    expect(remove).toHaveBeenCalledWith(source);
    expect(deleted).toBe(source);
  });
});
