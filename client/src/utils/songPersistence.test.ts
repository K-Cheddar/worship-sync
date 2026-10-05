import type { DBItem, ItemSlideType } from "../types";
import { normalizeItemSlides } from "./activeItemSlides";
import {
  createSong,
  deleteSong,
  getSongV2ArrangementDocId,
  getSongV2RootDocId,
  getSongV2SlideDocId,
  hydrateSongFromV2Documents,
  loadItemWithSongHydration,
  loadSong,
  saveSong,
  serializeSongToV2Documents,
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

const makeDb = (document: DBItem, childDocuments: Array<Record<string, unknown>> = []) => {
  const put = jest.fn(async (next: DBItem) => ({
    ok: true,
    id: next._id,
    rev: "2-new",
  }));
  const remove = jest.fn(async () => ({ ok: true, id: document._id, rev: "2-deleted" }));
  const documentsById = new Map<string, unknown>([
    [document._id, document],
    ...childDocuments.map((child): [string, unknown] => [String(child._id), child]),
  ]);
  const notFound = (id: string) => Object.assign(new Error(`missing ${id}`), {
    status: 404,
    name: "not_found",
  });
  const db = {
    get: jest.fn(async (id: string) => {
      const found = documentsById.get(id);
      if (!found) throw notFound(id);
      return found;
    }),
    allDocs: jest.fn(async ({ keys }: { keys?: string[] } = {}) => ({
      rows: (keys ?? []).map((id) => {
        const doc = documentsById.get(id);
        return doc
          ? { id, key: id, value: { rev: "1-child" }, doc }
          : { id, key: id, error: "not_found" };
      }),
    })),
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

  it("serializes and hydrates authored song data without changing order", () => {
    const source = song({
      name: "Schema Song",
      createdAt: "created",
      updatedAt: "updated",
      background: "song-background",
      shouldSendTo: { projector: true, monitor: false, stream: true },
      selectedArrangement: 1,
      songMetadata: {
        source: "manual",
        trackName: "Schema Song",
        artistName: "Test Artist",
        importedAt: "imported",
      },
      songLinks: [{ id: "link-1", label: "Chart", url: "https://example.test/chart" }],
      songAudio: {
        id: "audio-1",
        key: "songs/song-1/audio.mp3",
        fileName: "audio.mp3",
        contentType: "audio/mpeg",
        sizeBytes: 120,
        uploadedAt: "uploaded",
      },
      arrangements: [
        {
          id: "arr-a",
          name: "Arrangement A",
          formattedLyrics: [{
            id: "lyrics-a",
            type: "Verse",
            name: "Verse 1",
            words: "A lyrics",
            slideSpan: 2,
          }],
          songOrder: [{ id: "order-a", name: "Verse 1" }],
          monitorLayout: { currentFontSizePx: 31, nextFontSizePx: 28 },
          slides: [
            {
              ...songSlide("a-slide-2"),
              overflow: "separate",
              videoBackgroundSendMode: "continue",
              boxes: [{ id: "a-box-2", words: "A2", width: 1920, height: 1080, background: "media/a2.jpg" }],
            },
            {
              ...songSlide("a-slide-1"),
              boxes: [{ id: "a-box-1", words: "A1", width: 1920, height: 1080 }],
              monitorCurrentBandBoxes: [{ id: "derived-current", fontSize: 31 }],
              monitorNextBandBoxes: [{ id: "derived-next", fontSize: 28 }],
            } as unknown as ItemSlideType,
          ],
        },
        {
          id: "arr-b",
          name: "Arrangement B",
          formattedLyrics: [{
            id: "lyrics-b",
            type: "Chorus",
            name: "Chorus",
            words: "B lyrics",
            slideSpan: 1,
          }],
          songOrder: [{ id: "order-b", name: "Chorus" }],
          monitorLayout: { currentFontSizePx: 25, nextFontSizePx: 23 },
          slides: [songSlide("b-slide-1")],
        },
        {
          id: "arr-c",
          name: "Arrangement C",
          formattedLyrics: [],
          songOrder: [{ id: "order-c", name: "Bridge" }, { id: "order-c2", name: "Ending" }],
          monitorLayout: { currentFontSizePx: 20, nextFontSizePx: 18 },
          slides: [songSlide("c-slide-1"), songSlide("c-slide-2")],
        },
      ],
    });
    delete source._rev;
    const canonicalSource = normalizeItemSlides(source);

    const documents = serializeSongToV2Documents(source);
    const hydrated = hydrateSongFromV2Documents(
      documents.root,
      documents.arrangements,
      documents.slides,
    );

    expect(documents.root._id).toBe(getSongV2RootDocId(source._id));
    expect(documents.root.songSchemaVersion).toBe(2);
    expect(documents.root.arrangementIds).toEqual(["arr-a", "arr-b", "arr-c"]);
    expect(documents.root).not.toHaveProperty("slides");
    expect(documents.root).not.toHaveProperty("arrangements");
    expect(documents.root).not.toHaveProperty("monitorLayout");
    expect(documents.arrangements.map(({ slideIds }) => slideIds)).toEqual([
      ["a-slide-2", "a-slide-1"],
      ["b-slide-1"],
      ["c-slide-1", "c-slide-2"],
    ]);
    expect(documents.arrangements[0]).not.toHaveProperty("slides");
    expect(documents.slides.every((slide) =>
      !("monitorCurrentBandBoxes" in slide) && !("monitorNextBandBoxes" in slide),
    )).toBe(true);
    expect(hydrated).toMatchObject({
      _id: source._id,
      name: source.name,
      selectedArrangement: 1,
      background: "song-background",
      shouldSendTo: source.shouldSendTo,
      songMetadata: source.songMetadata,
      songLinks: source.songLinks,
      songAudio: source.songAudio,
      slides: [],
      arrangements: canonicalSource.arrangements,
    });
    expect(hydrated.arrangements.map(({ id }) => id)).toEqual(["arr-a", "arr-b", "arr-c"]);
    expect(hydrated.arrangements.map(({ slides }) => slides.map(({ id }) => id))).toEqual([
      ["a-slide-2", "a-slide-1"],
      ["b-slide-1"],
      ["c-slide-1", "c-slide-2"],
    ]);
    expect(hydrated.arrangements[0].slides[0].boxes[0].background).toBe("media/a2.jpg");
    expect(hydrated.arrangements[0].slides[1]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(hydrated.arrangements[0].slides[1]).not.toHaveProperty("monitorNextBandBoxes");
  });

  it("uses only manifest references and ignores stale slide documents", () => {
    const source = song({
      arrangements: [{
        id: "arr-a",
        name: "Arrangement A",
        formattedLyrics: [],
        songOrder: [],
        slides: [songSlide("referenced-slide")],
      }],
    });
    const documents = serializeSongToV2Documents(source);
    const orphan = {
      ...documents.slides[0],
      _id: getSongV2SlideDocId(source._id, "arr-a", "stale-slide"),
      id: "stale-slide",
    };

    const hydrated = hydrateSongFromV2Documents(
      documents.root,
      documents.arrangements,
      [...documents.slides, orphan],
    );

    expect(hydrated.arrangements[0].slides.map(({ id }) => id)).toEqual([
      "referenced-slide",
    ]);
    expect(getSongV2ArrangementDocId(source._id, "arr-a")).toContain("song-v2:arrangement:");
  });

  it("keeps child document identities stable when names change", () => {
    const source = song({
      arrangements: [{
        id: "stable-arrangement-id",
        name: "First name",
        formattedLyrics: [],
        songOrder: [],
        slides: [songSlide("stable-slide-id")],
      }],
    });
    const renamed = {
      ...source,
      name: "Renamed song",
      arrangements: source.arrangements.map((arrangement) => ({
        ...arrangement,
        name: "Renamed arrangement",
        slides: arrangement.slides.map((slide) => ({ ...slide, name: "Renamed slide" })),
      })),
    };

    const initialDocs = serializeSongToV2Documents(source);
    const renamedDocs = serializeSongToV2Documents(renamed);

    expect(renamedDocs.root._id).toBe(initialDocs.root._id);
    expect(renamedDocs.arrangements.map(({ _id }) => _id)).toEqual(
      initialDocs.arrangements.map(({ _id }) => _id),
    );
    expect(renamedDocs.slides.map(({ _id }) => _id)).toEqual(
      initialDocs.slides.map(({ _id }) => _id),
    );
  });

  it("fails explicitly when a referenced arrangement or slide is missing", () => {
    const source = song({
      arrangements: [{
        id: "arr-a",
        name: "Arrangement A",
        formattedLyrics: [],
        songOrder: [],
        slides: [songSlide("slide-a")],
      }],
    });
    const documents = serializeSongToV2Documents(source);

    expect(() => hydrateSongFromV2Documents(
      documents.root,
      [],
      documents.slides,
    )).toThrow("references missing arrangement arr-a");
    expect(() => hydrateSongFromV2Documents(
      documents.root,
      documents.arrangements,
      [],
    )).toThrow("references missing slide slide-a");
  });

  it("loads a v2 root and referenced children through the generic item repository path", async () => {
    const source = song({
      selectedArrangement: 1,
      arrangements: [
        {
          id: "arr-a",
          name: "A",
          formattedLyrics: [],
          songOrder: [],
          slides: [songSlide("a-slide")],
        },
        {
          id: "arr-b",
          name: "B",
          formattedLyrics: [],
          songOrder: [],
          slides: [songSlide("b-slide")],
        },
      ],
    });
    const documents = serializeSongToV2Documents(source);
    const { db } = makeDb(
      documents.root as unknown as DBItem,
      [...documents.arrangements, ...documents.slides],
    );

    const loaded = await loadItemWithSongHydration(db, source._id);

    expect(loaded._id).toBe(source._id);
    expect(loaded.slides).toEqual([]);
    expect(loaded.selectedArrangement).toBe(1);
    expect(loaded.arrangements.map(({ id }) => id)).toEqual(["arr-a", "arr-b"]);
    expect(loaded.arrangements.map(({ slides }) => slides.map(({ id }) => id))).toEqual([
      ["a-slide"],
      ["b-slide"],
    ]);
    expect(db.allDocs).toHaveBeenCalledTimes(2);
    expect(db.allDocs).toHaveBeenNthCalledWith(1, {
      keys: [
        getSongV2ArrangementDocId(source._id, "arr-a"),
        getSongV2ArrangementDocId(source._id, "arr-b"),
      ],
      include_docs: true,
    });
    expect(db.allDocs).toHaveBeenNthCalledWith(2, {
      keys: [
        getSongV2SlideDocId(source._id, "arr-a", "a-slide"),
        getSongV2SlideDocId(source._id, "arr-b", "b-slide"),
      ],
      include_docs: true,
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

  it("canonicalizes legacy root slides when a YouTube link is saved", async () => {
    const source = song({
      slides: [{
        ...songSlide("legacy-youtube-slide"),
        monitorCurrentBandBoxes: [{ id: "current-clone", fontSize: 31 }],
        monitorNextBandBoxes: [{ id: "next-clone", fontSize: 28 }],
      } as unknown as ItemSlideType],
      monitorLayout: { currentFontSizePx: 31, nextFontSizePx: 28 },
      selectedArrangement: 0,
      arrangements: [{
        id: "arr-1",
        name: "Master",
        formattedLyrics: [],
        songOrder: [],
        slides: [],
      }],
    });
    const { db, put } = makeDb(source);
    const existing = await loadSong(db, source._id);

    const saved = await saveSong(db, {
      ...existing,
      songLinks: [{
        id: "youtube-link",
        label: "YouTube",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      }],
    }, existing);

    const persisted = put.mock.calls[0][0];
    expect(persisted.songLinks).toEqual([expect.objectContaining({ id: "youtube-link" })]);
    expect(persisted).not.toHaveProperty("slides");
    expect(persisted).not.toHaveProperty("monitorLayout");
    expect(persisted.arrangements[0].slides.map(({ id }) => id)).toEqual([
      "legacy-youtube-slide",
    ]);
    expect(persisted.arrangements[0].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(persisted.arrangements[0].slides[0]).not.toHaveProperty("monitorNextBandBoxes");
    expect(saved.arrangements[0].monitorLayout).toEqual({
      currentFontSizePx: 31,
      nextFontSizePx: 28,
    });
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
