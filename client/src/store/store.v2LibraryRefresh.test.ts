import type { DBItem } from "../types";

const song = (name = "Song"): DBItem => ({
  _id: "song-1", name, type: "song", docType: "song-v2-root", selectedArrangement: 0,
  arrangements: [{ id: "a", name: "Master", formattedLyrics: [], songOrder: [],
    monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 28 },
    slides: [{ id: "s", name: "Verse", type: "Verse", boxes: [{ id: "box", words: name, width: 1920, height: 1080 }] }],
  }], slides: [],
} as unknown as DBItem);
const legacySong = (name = "Legacy song", revision = "1-legacy"): DBItem => ({
  ...song(name),
  docType: undefined,
  _rev: revision,
} as unknown as DBItem);
const flush = async () => { for (let attempt = 0; attempt < 12; attempt += 1) await Promise.resolve(); };
const setup = () => {
  let storeModule!: typeof import("./store");
  let itemModule!: typeof import("./itemSlice");
  let docsModule!: typeof import("./allDocsSlice");
  let deferredModule!: typeof import("./deferredItemMutations");
  const database: any = { name: "active-song-refresh-test-db", get: jest.fn(), allDocs: jest.fn() };
  let activeDb: any = database;
  const load = jest.fn().mockResolvedValue(song("Remote"));
  const globalFireDbInfo = {
    db: undefined,
    churchId: "",
    database: "",
    isConnected: false,
    writeCapabilities: { presentation: false, timers: false, serviceRuntime: false, serviceManagement: false },
  };
  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({ get globalDb() { return activeDb; }, globalBroadcastRef: undefined }));
    jest.doMock("../context/globalInfo", () => ({ globalFireDbInfo, globalHostId: "host" }));
    jest.doMock("../utils/songPersistence", () => ({
      ...jest.requireActual("../utils/songPersistence"),
      loadItemWithSongHydration: load,
      loadSongV2Snapshot: jest.fn(async (_database: unknown, songId: string) => ({
        hydrated: await load(_database, songId),
      })),
    }));
    jest.doMock("../utils/songV2ReplicationConflicts", () => {
      const actual = jest.requireActual("../utils/songV2ReplicationConflicts");
      return {
        ...actual,
        loadReconciledSongV2Snapshot: async (_database: unknown, songId: string) => ({
          hydrated: await load(_database, songId),
          conflicts: [],
        }),
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    itemModule = require("./itemSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    docsModule = require("./allDocsSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    deferredModule = require("./deferredItemMutations");
  });
  return {
    store: storeModule.default,
    item: itemModule.itemSlice.actions,
    docs: docsModule.allDocsSlice.actions,
    database,
    load,
    songV2DocumentsChanged: storeModule.songV2DocumentsChanged,
    setActiveOwner: (
      owner: import("../types").ItemContentOwner,
      ownerDatabase: unknown = database,
    ) => deferredModule.setActiveContentDatabase(owner, ownerDatabase as never),
    setDatabase: (next: unknown) => { activeDb = next; },
  };
};

describe("active song library refresh", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock("../context/controllerInfo");
    jest.dontMock("../context/globalInfo");
    jest.dontMock("../utils/songPersistence");
    jest.dontMock("../utils/songV2ReplicationConflicts");
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
  it("invalidates only a nonactive song's hydrated content for a slide-only replication event", async () => {
    const env = setup();
    const projection = { ...song(), arrangements: song().arrangements.map((arrangement) => ({ ...arrangement, slides: [] })) };
    const otherSong = { ...song("Other song"), _id: "other-song" };
    env.store.dispatch(env.docs.hydrateItemCache([projection, otherSong]));
    const cachedProjection = env.store.getState().allDocs.allSongDocs[0];
    env.store.dispatch(env.item.setActiveItem({ ...otherSong, listId: "outline-entry" }));

    env.store.dispatch(env.songV2DocumentsChanged([{ songId: "song-1", libraryChanged: false }]));
    await new Promise((resolve) => setTimeout(resolve, 75));
    await flush();

    expect(env.store.getState().allDocs.songContentVersions["song-1"]).toBe(1);
    expect(env.store.getState().allDocs.allSongDocs[0]).toBe(cachedProjection);
    expect(env.store.getState().undoable.present.item._id).toBe("other-song");
    expect(env.load).not.toHaveBeenCalled();
  });
  it("invalidates active outline content for slide-only replication without replacing the editor draft", async () => {
    const env = setup();
    const owner = { scopeId: "user-a-owner", databaseKey: "db-a", churchId: "", accountId: "user-a" };
    env.setActiveOwner(owner);
    const activeSong = { ...song("Local editor draft"), listId: "active-occurrence", contentOwner: owner };
    env.store.dispatch(env.item.setActiveItem(activeSong));
    env.load.mockResolvedValue(song("Remote slide-only update"));

    env.store.dispatch(env.songV2DocumentsChanged([{ songId: "song-1", libraryChanged: false }]));
    await new Promise((resolve) => setTimeout(resolve, 75));
    await flush();

    expect(env.store.getState().allDocs.songContentVersions["song-1"]).toBe(1);
    expect(env.store.getState().undoable.present.item.arrangements[0].slides[0].boxes[0].words).toBe("Local editor draft");
    expect(env.store.getState().undoable.present.item.pendingRemoteItem?.arrangements[0].slides[0].boxes[0].words).toBe("Remote slide-only update");
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
  it("adopts a remote legacy-song revision after its allDocs cache update", async () => {
    const env = setup();
    const owner = { scopeId: "user-a-owner", databaseKey: "db-a", churchId: "church-a", accountId: "user-a" };
    env.setActiveOwner(owner);
    const baseline = legacySong();
    const remote = { ...legacySong("Remote legacy title", "2-remote"), updatedAt: "remote-update" };
    env.database.get.mockResolvedValue(remote);
    env.store.dispatch(env.item.setActiveItem({ ...baseline, listId: "outline-entry", contentOwner: owner }));

    env.store.dispatch(env.docs.applyItemDocumentChanges([{ id: baseline._id, doc: remote }]));
    await flush();

    const active = env.store.getState().undoable.present.item;
    expect(env.database.get).toHaveBeenCalledWith(baseline._id, { conflicts: true });
    expect(active.name).toBe("Remote legacy title");
    expect(active.baseItem?._rev).toBe("2-remote");
    expect(active.hasPendingUpdate).toBe(false);
    expect(active.hasRemoteUpdate).toBe(false);
  });
  it("retains a dirty legacy-song draft and offers an overlapping remote edit for review", async () => {
    jest.useFakeTimers();
    const env = setup();
    const owner = { scopeId: "user-a-owner", databaseKey: "db-a", churchId: "church-a", accountId: "user-a" };
    env.setActiveOwner(owner);
    const baseline = legacySong();
    const remote = legacySong("Remote legacy title", "2-remote");
    env.database.get.mockResolvedValue(remote);
    env.store.dispatch(env.item.setActiveItem({ ...baseline, listId: "outline-entry", contentOwner: owner }));
    env.store.dispatch(env.item._setName("Local legacy draft"));

    env.store.dispatch(env.docs.applyItemDocumentChange({ id: baseline._id, doc: remote }));
    await flush();

    const active = env.store.getState().undoable.present.item;
    expect(active.name).toBe("Local legacy draft");
    expect(active.baseItem?._rev).toBe("1-legacy");
    expect(active.pendingRemoteItem?.name).toBe("Remote legacy title");
    expect(active.pendingRemoteItem?._rev).toBe("2-remote");
    expect(active.hasPendingUpdate).toBe(true);
    expect(active.hasRemoteUpdate).toBe(true);
  });
  it("does not apply a legacy refresh after the same item opens under another church database", async () => {
    const env = setup();
    const ownerA = { scopeId: "user-a-church-a", databaseKey: "db-a", churchId: "church-a", accountId: "user-a" };
    const ownerB = { scopeId: "user-a-church-b", databaseKey: "db-b", churchId: "church-b", accountId: "user-a" };
    const databaseB = {
      name: "church-b-db",
      get: jest.fn().mockResolvedValue(legacySong("Church B remote current", "2-church-b")),
    };
    let resolveChurchA!: (document: DBItem) => void;
    env.database.get.mockReturnValue(new Promise<DBItem>((resolve) => { resolveChurchA = resolve; }));
    env.setActiveOwner(ownerA);
    const baselineA = legacySong("Church A");
    const remoteA = legacySong("Stale Church A update", "2-church-a");
    env.store.dispatch(env.item.setActiveItem({ ...baselineA, listId: "outline-entry", contentOwner: ownerA }));
    env.store.dispatch(env.docs.applyItemDocumentChange({ id: baselineA._id, doc: remoteA }));
    expect(env.database.get).toHaveBeenCalledWith(baselineA._id, { conflicts: true });

    env.setDatabase(databaseB);
    env.setActiveOwner(ownerB, databaseB);
    env.store.dispatch(env.item.setActiveItem({ ...legacySong("Church B", "1-church-b"), listId: "outline-entry", contentOwner: ownerB }));
    env.store.dispatch(env.docs.applyItemDocumentChange({
      id: baselineA._id,
      doc: legacySong("Church B remote current", "2-church-b"),
    }));
    await flush();
    resolveChurchA(remoteA);
    await flush();

    expect(env.store.getState().undoable.present.item.name).toBe("Church B remote current");
    expect(env.store.getState().undoable.present.item.baseItem?._rev).toBe("2-church-b");
    expect(databaseB.get).toHaveBeenCalledWith(baselineA._id, { conflicts: true });
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
