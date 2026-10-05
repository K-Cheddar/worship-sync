import type { DBItem } from "../types";

const song = (name = "Song"): DBItem => ({
  _id: "song-1", name, type: "song", docType: "song-v2-root", selectedArrangement: 0,
  arrangements: [{ id: "a", name: "Master", formattedLyrics: [], songOrder: [],
    monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 28 },
    slides: [{ id: "s", name: "Verse", type: "Verse", boxes: [{ id: "box", words: name, width: 1920, height: 1080 }] }],
  }], slides: [],
} as unknown as DBItem);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const setup = () => {
  let storeModule!: typeof import("./store");
  let itemModule!: typeof import("./itemSlice");
  let docsModule!: typeof import("./allDocsSlice");
  const load = jest.fn().mockResolvedValue(song("Remote"));
  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({ globalDb: {}, globalBroadcastRef: undefined }));
    jest.doMock("../context/globalInfo", () => ({ globalFireDbInfo: undefined, globalHostId: "host" }));
    jest.doMock("../utils/songPersistence", () => ({ ...jest.requireActual("../utils/songPersistence"), loadItemWithSongHydration: load }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    itemModule = require("./itemSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    docsModule = require("./allDocsSlice");
  });
  return { store: storeModule.default, item: itemModule.itemSlice.actions, docs: docsModule.allDocsSlice.actions, load };
};

describe("active v2 song library refresh", () => {
  afterEach(() => {
    jest.dontMock("../context/controllerInfo");
    jest.dontMock("../context/globalInfo");
    jest.dontMock("../utils/songPersistence");
  });
  it("exact-loads active slides and refreshes slide-only changes even when the projection is unchanged", async () => {
    const { store, item, docs, load } = setup();
    store.dispatch(item.setActiveItem({ ...song(), listId: "outline-entry" }));
    const projection = { ...song(), arrangements: song().arrangements.map((arrangement) => ({ ...arrangement, slides: [] })) };
    store.dispatch(docs.updateAllSongDocs([projection]));
    await flush();
    expect(store.getState().undoable.present.item.arrangements[0].slides[0].boxes[0].words).toBe("Remote");
    load.mockResolvedValue(song("Slide-only update"));
    store.dispatch(docs.updateAllSongDocs([projection]));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getState().undoable.present.item.arrangements[0].slides[0].boxes[0].words).toBe("Slide-only update");
    expect(store.getState().allDocs.allSongDocs[0].arrangements[0].slides).toEqual([]);
  });
  it("adopts an identical-content v2 representation as the idle v1 editor baseline", async () => {
    const { store, item, docs, load } = setup();
    const v1 = { ...song(), docType: undefined };
    store.dispatch(item.setActiveItem({ ...v1, listId: "outline-entry" }));
    const projection = { ...song(), arrangements: song().arrangements.map((arrangement) => ({ ...arrangement, slides: [] })) };
    load.mockResolvedValue(song());

    store.dispatch(docs.updateAllSongDocs([projection]));
    await flush();

    const active = store.getState().undoable.present.item;
    expect(active.docType).toBe("song-v2-root");
    expect(active.baseItem?.docType).toBe("song-v2-root");
    expect(active.arrangements[0].slides[0].boxes[0].words).toBe("Song");
    expect(load).toHaveBeenCalledWith(expect.anything(), "song-1");
    expect(store.getState().allDocs.allSongDocs[0].arrangements[0].slides).toEqual([]);
  });
  it("buffers an equivalent v2 representation while preserving a dirty v1 draft, then adopts it when applied", async () => {
    const { store, item, docs, load } = setup();
    const v1 = { ...song(), docType: undefined };
    store.dispatch(item.setActiveItem({ ...v1, listId: "outline-entry" }));
    store.dispatch(item._updateSlides([{ ...v1.arrangements[0].slides[0], boxes: [{ id: "box", words: "Local draft", width: 1920, height: 1080 }] }]));
    const projection = { ...song(), arrangements: song().arrangements.map((arrangement) => ({ ...arrangement, slides: [] })) };
    load.mockResolvedValue(song());

    store.dispatch(docs.updateAllSongDocs([projection]));
    await flush();

    let active = store.getState().undoable.present.item;
    expect(active.arrangements[0].slides[0].boxes[0].words).toBe("Local draft");
    expect(active.baseItem?.docType).toBeUndefined();
    expect(active.pendingRemoteItem?.docType).toBe("song-v2-root");
    expect(active.hasRemoteUpdate).toBe(true);

    store.dispatch(item.applyPendingRemoteItem());
    active = store.getState().undoable.present.item;
    expect(active.docType).toBe("song-v2-root");
    expect(active.baseItem?.docType).toBe("song-v2-root");
    expect(active.hasPendingUpdate).toBe(false);
  });
  it("buffers fully loaded remote content when editing begins during hydration", async () => {
    const { store, item, docs, load } = setup();
    let resolve!: (song: DBItem) => void;
    load.mockReturnValue(new Promise<DBItem>((done) => { resolve = done; }));
    store.dispatch(item.setActiveItem({ ...song(), listId: "outline-entry" }));
    store.dispatch(docs.updateAllSongDocs([song("Remote")]));
    store.dispatch(item.setIsLyricsEditorOpen(true));
    resolve(song("Remote"));
    await flush();
    const active = store.getState().undoable.present.item;
    expect(active.name).toBe("Song");
    expect(active.pendingRemoteItem?.arrangements[0].slides[0].boxes[0].words).toBe("Remote");
  });
  it("ignores completion after the active item changes, including a return to the same logical ID", async () => {
    const { store, item, docs, load } = setup();
    let resolve!: (song: DBItem) => void;
    load.mockReturnValue(new Promise<DBItem>((done) => { resolve = done; }));
    store.dispatch(item.setActiveItem({ ...song(), listId: "outline-entry" }));
    store.dispatch(docs.updateAllSongDocs([song("Remote")]));
    store.dispatch(item.setActiveItem({ ...song("Other"), _id: "other", listId: "other-entry" }));
    store.dispatch(item.setActiveItem({ ...song("Reopened"), listId: "outline-entry" }));
    resolve(song("Stale"));
    await flush();
    expect(store.getState().undoable.present.item.name).toBe("Reopened");
  });
});
