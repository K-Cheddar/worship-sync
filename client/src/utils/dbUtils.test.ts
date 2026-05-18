import {
  CREDIT_HISTORY_ID_PREFIX,
  CREDITS_OUTLINE_INDEX_PREFIX,
  OVERLAY_HISTORY_ID_PREFIX,
  getCreditDocId,
  getCreditHistoryDocId,
  getCreditsDocId,
  getOverlayHistoryDocId,
} from "../types";
import {
  deleteUnusedBibleItems,
  deleteUnusedHeadings,
  ensureCreditsIndexDoc,
  getAllCreditDocsForOutline,
  getAllCreditsHistory,
  getCreditUsageByList,
  getAllOverlayDocs,
  getAllOverlayHistory,
  getCreditsByIds,
  getOverlayUsageByList,
  getOverlaysByIds,
  isLegacyPreferencesDoc,
  migrateDocTypes,
  migrateFontSizesToDefaults,
  migrateFontSizesToPixels,
  migrateLegacyCreditsToActiveOutlineIfNeeded,
  migrateMediaLibraryFoldersFieldIfNeeded,
  migrateSplitPreferencesDocs,
  loadPreferencesBundle,
  putCreditDoc,
  putCreditHistoryDoc,
  putCreditHistoryDocs,
  putOverlayHistoryDoc,
  putOverlayHistoryDocs,
  removeCreditHistoryDoc,
  removeOverlayHistoryDoc,
} from "./dbUtils";

type MockDb = {
  get: jest.Mock;
  allDocs: jest.Mock;
  put: jest.Mock;
  remove: jest.Mock;
};

const createDb = (): MockDb => ({
  get: jest.fn(),
  allDocs: jest.fn(),
  put: jest.fn(),
  remove: jest.fn(),
});

const createNotFoundError = () =>
  Object.assign(new Error("Not found"), { status: 404 });

describe("dbUtils", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds overlay usage map from item lists and skips unreadable lists", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === "ItemLists") {
        return {
          itemLists: [
            { _id: "list-1", name: "Sunday AM" },
            { _id: "list-2", name: "Sunday PM" },
          ],
        };
      }
      if (id === "list-1")
        return { name: "Sunday Morning", overlays: ["a", "b", "a"] };
      if (id === "list-2") throw new Error("broken list");
      return {};
    });

    const usage = await getOverlayUsageByList(
      db as unknown as PouchDB.Database,
    );

    expect(Array.from(usage.entries())).toEqual([
      ["a", ["Sunday Morning"]],
      ["b", ["Sunday Morning"]],
    ]);
  });

  it("builds credit usage map from each outline credits index", async () => {
    const db = createDb();
    const listA = "list-a";
    const listB = "list-b";
    db.get.mockImplementation(async (id: string) => {
      if (id === "ItemLists") {
        return {
          itemLists: [
            { _id: listA, name: "Outline A" },
            { _id: listB, name: "Outline B" },
          ],
        };
      }
      if (id === listA) {
        return { _id: listA, name: "Sunday AM" };
      }
      if (id === listB) {
        return { _id: listB, name: "Sunday PM" };
      }
      if (id === getCreditsDocId(listA)) {
        return { _id: id, creditIds: ["c1", "c2"] };
      }
      if (id === getCreditsDocId(listB)) {
        return { _id: id, creditIds: ["c1"] };
      }
      return {};
    });

    const usage = await getCreditUsageByList(db as unknown as PouchDB.Database);

    expect(Array.from(usage.entries())).toEqual([
      ["c1", ["Sunday AM", "Sunday PM"]],
      ["c2", ["Sunday AM"]],
    ]);
  });

  it("loads overlays by ids and filters missing docs", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [{ doc: { _id: "overlay-a", id: "a", type: "participant" } }, {}],
    });

    const overlays = await getOverlaysByIds(db as unknown as PouchDB.Database, [
      "a",
      "missing",
    ]);

    expect(db.allDocs).toHaveBeenCalledWith({
      keys: ["overlay-a", "overlay-missing"],
      include_docs: true,
    });
    expect(overlays).toHaveLength(1);
    expect(overlays[0]._id).toBe("overlay-a");
  });

  it("gets all overlay docs excluding templates and history docs", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        { doc: { _id: "overlay-a" } },
        { doc: { _id: "overlay-templates" } },
        { doc: { _id: "overlay-history-participant.name" } },
      ],
    });

    const docs = await getAllOverlayDocs(db as unknown as PouchDB.Database);

    expect(docs).toEqual([{ _id: "overlay-a" }]);
  });

  it("loads credits history and decodes heading when heading field is absent", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        {
          doc: {
            _id: getCreditHistoryDocId("Psalm 23"),
            lines: ["The Lord is my shepherd"],
          },
        },
        { doc: { _id: `${CREDIT_HISTORY_ID_PREFIX}ignored`, lines: "bad" } },
      ],
    });

    const map = await getAllCreditsHistory(db as unknown as PouchDB.Database);

    expect(map).toEqual({
      "Psalm 23": ["The Lord is my shepherd"],
    });
  });

  it("creates and updates credit history docs and skips empty lines", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === getCreditHistoryDocId("Existing")) {
        return { _id: id, _rev: "1-a", heading: "Existing", lines: ["old"] };
      }
      throw createNotFoundError();
    });

    await putCreditHistoryDocs(
      db as unknown as PouchDB.Database,
      {
        Existing: ["new line"],
        NewHeading: ["another line"],
        EmptyHeading: [],
      },
      ["Existing", "NewHeading", "EmptyHeading"],
    );

    expect(db.put).toHaveBeenCalledTimes(2);
    expect(db.put.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        _id: getCreditHistoryDocId("Existing"),
        _rev: "1-a",
        heading: "Existing",
        lines: ["new line"],
      }),
    );
    expect(db.put.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        _id: getCreditHistoryDocId("NewHeading"),
        heading: "NewHeading",
        lines: ["another line"],
        docType: "credit-history",
      }),
    );
  });

  it("removes credit history docs and ignores 404", async () => {
    const db = createDb();
    db.get.mockResolvedValue({
      _id: getCreditHistoryDocId("ToDelete"),
      _rev: "1-a",
    });

    await removeCreditHistoryDoc(db as unknown as PouchDB.Database, "ToDelete");
    expect(db.remove).toHaveBeenCalledWith({
      _id: getCreditHistoryDocId("ToDelete"),
      _rev: "1-a",
    });

    db.get.mockRejectedValueOnce({ status: 404 });
    await expect(
      removeCreditHistoryDoc(db as unknown as PouchDB.Database, "Missing"),
    ).resolves.toBeUndefined();
  });

  it("loads overlay history and decodes key from doc id fallback", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        {
          doc: {
            _id: getOverlayHistoryDocId("participant.name"),
            values: ["Alice"],
          },
        },
      ],
    });

    const map = await getAllOverlayHistory(db as unknown as PouchDB.Database);
    expect(map["participant.name"]).toEqual(["Alice"]);
  });

  it("upserts a single overlay history doc", async () => {
    const db = createDb();
    const key = "qr-code.description";
    const id = getOverlayHistoryDocId(key);
    db.get.mockRejectedValueOnce({ status: 404 });

    await putOverlayHistoryDoc(db as unknown as PouchDB.Database, key, ["v1"]);
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: id,
        key,
        values: ["v1"],
        docType: "overlay-history",
      }),
    );

    db.get.mockResolvedValueOnce({ _id: id, _rev: "1-a", key, values: [] });
    await putOverlayHistoryDoc(db as unknown as PouchDB.Database, key, ["v2"]);
    expect(db.put).toHaveBeenLastCalledWith(
      expect.objectContaining({
        _id: id,
        _rev: "1-a",
        key,
        values: ["v2"],
      }),
    );
  });

  it("removes overlay history and ignores missing docs", async () => {
    const db = createDb();
    const id = `${OVERLAY_HISTORY_ID_PREFIX}participant.name`;
    db.get.mockResolvedValueOnce({ _id: id, _rev: "1-a" });
    await removeOverlayHistoryDoc(
      db as unknown as PouchDB.Database,
      "participant.name",
    );
    expect(db.remove).toHaveBeenCalledWith({ _id: id, _rev: "1-a" });

    db.get.mockRejectedValueOnce({ status: 404 });
    await expect(
      removeOverlayHistoryDoc(
        db as unknown as PouchDB.Database,
        "participant.name",
      ),
    ).resolves.toBeUndefined();
  });

  it("gets credits by ids preserving requested order", async () => {
    const db = createDb();
    const outlineId = "outline-1";
    db.allDocs.mockResolvedValue({
      rows: [
        { doc: { id: "b", heading: "B", text: "Tb", hidden: false } },
        { doc: { id: "a", heading: "A", text: "Ta", hidden: true } },
      ],
    });

    const credits = await getCreditsByIds(
      db as unknown as PouchDB.Database,
      outlineId,
      ["a", "missing", "b"],
    );

    expect(db.allDocs).toHaveBeenCalledWith({
      keys: [
        getCreditDocId(outlineId, "a"),
        getCreditDocId(outlineId, "missing"),
        getCreditDocId(outlineId, "b"),
      ],
      include_docs: true,
    });
    expect(credits).toEqual([
      { id: "a", heading: "A", text: "Ta", hidden: true },
      { id: "b", heading: "B", text: "Tb", hidden: false },
    ]);
  });

  it("lists all outline-scoped credit docs and skips wrong docType", async () => {
    const db = createDb();
    const outlineId = "outline-xyz";
    const prefix = `${CREDITS_OUTLINE_INDEX_PREFIX}${encodeURIComponent(outlineId)}-credit-`;
    db.allDocs.mockResolvedValue({
      rows: [
        {
          doc: {
            _id: `${prefix}a`,
            id: "a",
            heading: "H",
            text: "t",
            docType: "credit",
          },
        },
        {
          doc: {
            _id: `${prefix}bad`,
            id: "bad",
            docType: "credits",
          },
        },
      ],
    });

    const result = await getAllCreditDocsForOutline(
      db as unknown as PouchDB.Database,
      outlineId,
    );

    expect(db.allDocs).toHaveBeenCalledWith({
      include_docs: true,
      startkey: prefix,
      endkey: `${prefix}\uffff`,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("updates a credit doc and returns null on error", async () => {
    const db = createDb();
    const oid = "ol-1";
    db.get.mockResolvedValueOnce({
      _id: getCreditDocId(oid, "c1"),
      _rev: "1-a",
      id: "c1",
      heading: "Old",
      text: "Old text",
      hidden: false,
    });
    const updated = await putCreditDoc(db as unknown as PouchDB.Database, oid, {
      id: "c1",
      heading: "New heading",
      text: "New text",
      hidden: true,
    });
    expect(updated).toEqual(
      expect.objectContaining({
        id: "c1",
        heading: "New heading",
        text: "New text",
        hidden: true,
      }),
    );

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    db.get.mockRejectedValueOnce(new Error("db down"));
    const failed = await putCreditDoc(db as unknown as PouchDB.Database, oid, {
      id: "c2",
      heading: "x",
      text: "y",
      hidden: false,
    });
    expect(failed).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  describe("migrateLegacyCreditsToActiveOutlineIfNeeded", () => {
    it("copies legacy credits into scoped docs when scoped is missing", async () => {
      const db = createDb();
      const outlineId = "o1";
      const scopedId = getCreditsDocId(outlineId);
      db.get.mockImplementation(async (id: string) => {
        if (id === scopedId) {
          const e: { status: number } = { status: 404 };
          throw e;
        }
        if (id === "credits") {
          return { _id: "credits", creditIds: ["x"], docType: "credits" };
        }
        if (id === "credit-x") {
          return {
            _id: "credit-x",
            _rev: "1-a",
            id: "x",
            heading: "H",
            text: "T",
            hidden: false,
          };
        }
        throw new Error(`unexpected ${id}`);
      });
      db.put.mockResolvedValue({ ok: true, id: "x", rev: "1" } as never);

      await migrateLegacyCreditsToActiveOutlineIfNeeded(
        db as unknown as PouchDB.Database,
        outlineId,
      );

      expect(db.put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: scopedId,
          outlineId,
          creditIds: ["x"],
        }),
      );
      expect(db.put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: getCreditDocId(outlineId, "x"),
          outlineId,
          id: "x",
          heading: "H",
        }),
      );
    });

    it("skips when scoped index already exists", async () => {
      const db = createDb();
      const outlineId = "o1";
      db.get.mockResolvedValue({
        _id: getCreditsDocId(outlineId),
        creditIds: [],
      });

      await migrateLegacyCreditsToActiveOutlineIfNeeded(
        db as unknown as PouchDB.Database,
        outlineId,
      );

      expect(db.put).not.toHaveBeenCalled();
    });
  });

  it("deletes unused bible items from all-items and individual docs", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === "ItemLists") {
        return { itemLists: [{ _id: "list-1", name: "Main" }] };
      }
      if (id === "list-1") {
        return { items: [{ _id: "bible-1", type: "bible" }] };
      }
      if (id === "bible-2") return { _id: "bible-2", _rev: "1-a" };
      return {};
    });

    const allItems = {
      _id: "all-items",
      items: [
        { _id: "bible-1", type: "bible" },
        { _id: "bible-2", type: "bible" },
        { _id: "song-1", type: "song" },
      ],
    } as any;

    await deleteUnusedBibleItems({
      db: db as unknown as PouchDB.Database,
      allItems,
    });

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "all-items",
        items: [
          { _id: "bible-1", type: "bible" },
          { _id: "song-1", type: "song" },
        ],
      }),
    );
    expect(db.remove).toHaveBeenCalledWith({ _id: "bible-2", _rev: "1-a" });
  });

  it("migrates font sizes to pixels for slides and arrangement slides", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        {
          doc: {
            _id: "song-1",
            type: "song",
            slides: [
              {
                boxes: [{ fontSize: 10 }],
                monitorCurrentBandBoxes: [{ fontSize: 8 }],
                monitorNextBandBoxes: [{ fontSize: 6 }],
              },
            ],
            arrangements: [
              {
                slides: [
                  {
                    boxes: [{ fontSize: 4 }],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = await migrateFontSizesToPixels(
      db as unknown as PouchDB.Database,
    );

    expect(result).toEqual({ migratedCount: 1, errorCount: 0 });
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "song-1",
        slides: [
          expect.objectContaining({
            boxes: [expect.objectContaining({ fontSize: 45 })],
            monitorCurrentBandBoxes: [
              expect.objectContaining({ fontSize: 36 }),
            ],
            monitorNextBandBoxes: [expect.objectContaining({ fontSize: 27 })],
          }),
        ],
        arrangements: [
          expect.objectContaining({
            slides: [
              expect.objectContaining({
                boxes: [expect.objectContaining({ fontSize: 18 })],
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("migrates font sizes to defaults by item type", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        {
          doc: {
            _id: "song-1",
            name: "Song",
            type: "song",
            slides: [
              { boxes: [{ fontSize: 1 }] },
              { boxes: [{ fontSize: 1 }] },
            ],
            arrangements: [
              {
                slides: [
                  { boxes: [{ fontSize: 1 }] },
                  { boxes: [{ fontSize: 1 }] },
                ],
              },
            ],
          },
        },
        {
          doc: {
            _id: "bible-1",
            name: "Bible",
            type: "bible",
            slides: [{ boxes: [{ fontSize: 1 }] }, { boxes: [{}, {}, {}] }],
            arrangements: [],
          },
        },
      ],
    });

    const result = await migrateFontSizesToDefaults(
      db as unknown as PouchDB.Database,
    );

    expect(result).toEqual({ migratedCount: 2, errorCount: 0 });

    const songPut = db.put.mock.calls[0][0];
    expect(songPut.slides[0].boxes[0].fontSize).toBe(180);
    expect(songPut.slides[1].boxes[0].fontSize).toBe(108);
    expect(songPut.arrangements[0].slides[0].boxes[0].fontSize).toBe(180);
    expect(songPut.arrangements[0].slides[1].boxes[0].fontSize).toBe(108);

    const biblePut = db.put.mock.calls[1][0];
    expect(biblePut.slides[0].boxes[0].fontSize).toBe(180);
    expect(biblePut.slides[1].boxes[1].fontSize).toBe(108);
    expect(biblePut.slides[1].boxes[2].fontSize).toBe(90);
  });

  it("migrateFontSizesToDefaults handles free and timer types", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        {
          doc: {
            _id: "free-1",
            name: "Announcement",
            type: "free",
            slides: [{ boxes: [{ fontSize: 1 }] }],
            arrangements: [],
          },
        },
        {
          doc: {
            _id: "timer-1",
            name: "Timer",
            type: "timer",
            slides: [{ boxes: [{ fontSize: 1 }] }],
            arrangements: [],
          },
        },
      ],
    });

    await migrateFontSizesToDefaults(db as unknown as PouchDB.Database);

    const freePut = db.put.mock.calls[0][0];
    expect(freePut.slides[0].boxes[0].fontSize).toBe(108);

    const timerPut = db.put.mock.calls[1][0];
    expect(timerPut.slides[0].boxes[0].fontSize).toBe(180);
  });

  it("migrateFontSizesToDefaults returns zeroes when db is falsy", async () => {
    const result = await migrateFontSizesToDefaults(null as any);
    expect(result).toEqual({ migratedCount: 0, errorCount: 0 });
  });

  it("migrateFontSizesToPixels returns zeroes when db is falsy", async () => {
    const result = await migrateFontSizesToPixels(null as any);
    expect(result).toEqual({ migratedCount: 0, errorCount: 0 });
  });

  it("migrateDocTypes returns zeroes when db is falsy", async () => {
    const result = await migrateDocTypes(null as any);
    expect(result).toEqual({ updatedCount: 0, errorCount: 0, skippedCount: 0 });
  });

  it("migrates doc types and skips unchanged or design docs", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        { doc: { _id: "_design/index" } },
        { doc: { _id: "allItems", docType: "allItems" } },
        { doc: { _id: "overlay-abc", type: "participant" } },
        { doc: { _id: "credit-xyz" } },
        { doc: { _id: "credits-outline-seed-outline" } },
        { doc: { _id: "list-1", items: [], overlays: [] } },
        { doc: { _id: "unknown-1" } },
      ],
    });
    db.put.mockImplementation(async (doc: { _id: string }) => {
      if (doc._id === "unknown-1") throw new Error("cannot write");
      return doc;
    });

    const result = await migrateDocTypes(db as unknown as PouchDB.Database);

    expect(result).toEqual({ updatedCount: 4, errorCount: 1, skippedCount: 2 });
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "overlay-abc", docType: "overlay" }),
    );
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "credit-xyz", docType: "credit" }),
    );
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "credits-outline-seed-outline",
        docType: "credits",
      }),
    );
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "list-1", docType: "itemListDetails" }),
    );
  });

  it("migrateMediaLibraryFoldersFieldIfNeeded adds folders and normalizes orphan folderId", async () => {
    const db = createDb();
    db.get.mockResolvedValue({
      _id: "media",
      _rev: "1-abc",
      list: [{ id: "m1", folderId: "ghost" }],
    });
    db.put.mockResolvedValue({});
    const changed = await migrateMediaLibraryFoldersFieldIfNeeded(
      db as unknown as PouchDB.Database,
    );
    expect(changed).toBe(true);
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        folders: [],
        list: [expect.objectContaining({ id: "m1", folderId: null })],
      }),
    );
  });

  it("migrateMediaLibraryFoldersFieldIfNeeded is a no-op when shape is already valid", async () => {
    const db = createDb();
    db.get.mockResolvedValue({
      _id: "media",
      _rev: "1-abc",
      list: [],
      folders: [],
    });
    const changed = await migrateMediaLibraryFoldersFieldIfNeeded(
      db as unknown as PouchDB.Database,
    );
    expect(changed).toBe(false);
    expect(db.put).not.toHaveBeenCalled();
  });

  it("loadPreferencesBundle loads only split preference docs", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === "preferences") {
        return {
          _id: "preferences",
          _rev: "1-p",
          preferences: { defaultSlidesPerRow: 4 },
          docType: "preferences",
        };
      }
      if (id === "quickLinks") {
        return {
          _id: "quickLinks",
          _rev: "1-q",
          quickLinks: [{ id: "q1", label: "Quick", canDelete: true }],
          docType: "quickLinks",
        };
      }
      if (id === "monitorSettings") {
        return {
          _id: "monitorSettings",
          _rev: "1-m",
          monitorSettings: {
            showClock: true,
            showTimer: true,
            showNextSlide: false,
            clockFontSize: 75,
            timerFontSize: 75,
            timerId: null,
          },
          docType: "monitorSettings",
        };
      }
      if (id === "mediaRouteFolders") {
        return {
          _id: "mediaRouteFolders",
          _rev: "1-f",
          mediaRouteFolders: { "controller-default": "folder-a" },
          docType: "mediaRouteFolders",
        };
      }
      throw createNotFoundError();
    });

    const bundle = await loadPreferencesBundle(
      db as unknown as PouchDB.Database,
    );

    expect(bundle).toMatchObject({
      preferences: { defaultSlidesPerRow: 4 },
      quickLinks: [{ id: "q1", label: "Quick", canDelete: true }],
      monitorSettings: {
        showClock: true,
        showTimer: true,
        showNextSlide: false,
        clockFontSize: 75,
        timerFontSize: 75,
        timerId: null,
      },
      mediaRouteFolders: { "controller-default": "folder-a" },
    });
  });

  it("loadPreferencesBundle falls back to legacy monolithic preferences docs", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === "preferences") {
        return {
          _id: "preferences",
          _rev: "1-p",
          preferences: { defaultSlidesPerRow: 4 },
          quickLinks: [{ id: "legacy" }],
          monitorSettings: { showClock: true },
          mediaRouteFolders: { "controller-default": "legacy-folder" },
        };
      }
      throw createNotFoundError();
    });

    const bundle = await loadPreferencesBundle(
      db as unknown as PouchDB.Database,
    );
    expect(bundle).toMatchObject({
      preferences: { defaultSlidesPerRow: 4 },
      quickLinks: [{ id: "legacy" }],
      monitorSettings: { showClock: true },
      mediaRouteFolders: { "controller-default": "legacy-folder" },
    });
  });

  it("migrateSplitPreferencesDocs splits legacy monolithic preferences into four docs", async () => {
    const db = createDb();
    const legacyPrefs = {
      _id: "preferences",
      _rev: "1-legacy",
      preferences: {
        defaultSongBackground: { background: "x" },
        defaultTimerBackground: { background: "" },
        defaultBibleBackground: { background: "b" },
        defaultFreeFormBackground: { background: "f" },
        defaultSongBackgroundBrightness: 50,
        defaultTimerBackgroundBrightness: 75,
        defaultBibleBackgroundBrightness: 60,
        defaultFreeFormBackgroundBrightness: 100,
        defaultSlidesPerRow: 4,
        defaultSlidesPerRowMobile: 3,
        defaultSlidesPerRowMusic: 6,
        defaultSlidesPerRowMusicMobile: 3,
        defaultFormattedLyricsPerRow: 4,
        defaultMediaItemsPerRow: 4,
        defaultShouldShowItemEditor: true,
        defaultIsMediaExpanded: false,
        defaultBibleFontMode: "separate" as const,
        defaultFreeFormFontMode: "separate" as const,
      },
      quickLinks: [{ id: "q1", label: "L", canDelete: true }],
      monitorSettings: {
        showClock: true,
        showTimer: true,
        showNextSlide: false,
        clockFontSize: 75,
        timerFontSize: 75,
        timerId: null,
      },
      mediaRouteFolders: { "controller-default": "folder-a" },
    };
    db.get.mockImplementation(async (id: string) => {
      if (id === "preferences") return legacyPrefs;
      throw createNotFoundError();
    });
    let revCounter = 2;
    db.put.mockImplementation(async (doc: { _id: string }) => ({
      ok: true,
      id: doc._id,
      rev: `${revCounter++}-x`,
    }));

    const result = await migrateSplitPreferencesDocs(
      db as unknown as PouchDB.Database,
    );

    expect(result.status).toBe("migrated");
    expect(result.puts).toBe(4);
    const puts = db.put.mock.calls.map((c) => c[0]) as Record<
      string,
      unknown
    >[];
    const byId = new Map(puts.map((p) => [p._id as string, p]));
    expect(byId.get("quickLinks")).toMatchObject({
      quickLinks: legacyPrefs.quickLinks,
      docType: "quickLinks",
    });
    expect(byId.get("monitorSettings")).toMatchObject({
      monitorSettings: legacyPrefs.monitorSettings,
      docType: "monitorSettings",
    });
    expect(byId.get("mediaRouteFolders")).toMatchObject({
      mediaRouteFolders: legacyPrefs.mediaRouteFolders,
      docType: "mediaRouteFolders",
    });
    expect(byId.get("preferences")).toMatchObject({
      preferences: legacyPrefs.preferences,
      docType: "preferences",
    });
    expect(byId.get("preferences")).not.toHaveProperty("quickLinks");
  });

  it("isLegacyPreferencesDoc returns true when doc has quickLinks array", () => {
    expect(isLegacyPreferencesDoc({ quickLinks: [] } as any)).toBe(true);
    expect(isLegacyPreferencesDoc({ quickLinks: [{ id: "q1" }] } as any)).toBe(true);
  });

  it("isLegacyPreferencesDoc returns false when quickLinks is absent or non-array", () => {
    expect(isLegacyPreferencesDoc({} as any)).toBe(false);
    expect(isLegacyPreferencesDoc({ quickLinks: "bad" } as any)).toBe(false);
  });

  it("getOverlaysByIds returns empty array immediately for empty input", async () => {
    const db = createDb();
    const result = await getOverlaysByIds(db as unknown as PouchDB.Database, []);
    expect(result).toEqual([]);
    expect(db.allDocs).not.toHaveBeenCalled();
  });

  it("getCreditsByIds returns empty array immediately for empty input", async () => {
    const db = createDb();
    const result = await getCreditsByIds(db as unknown as PouchDB.Database, "ol-1", []);
    expect(result).toEqual([]);
    expect(db.allDocs).not.toHaveBeenCalled();
  });

  it("deleteUnusedHeadings removes unused headings and keeps used ones", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === "ItemLists") return { itemLists: [{ _id: "l1", name: "L1" }] };
      if (id === "l1")
        return { items: [{ _id: "heading-kept", type: "heading" }] };
      if (id === "heading-removed") return { _id: "heading-removed", _rev: "1-a" };
      return {};
    });
    const allItems = {
      _id: "allItems",
      items: [
        { _id: "heading-kept", type: "heading" },
        { _id: "heading-removed", type: "heading" },
        { _id: "song-1", type: "song" },
      ],
    } as any;
    await deleteUnusedHeadings({ db: db as unknown as PouchDB.Database, allItems });
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ items: expect.arrayContaining([
        expect.objectContaining({ _id: "heading-kept" }),
        expect.objectContaining({ _id: "song-1" }),
      ]) }),
    );
    expect(db.remove).toHaveBeenCalled();
  });

  it("ensureCreditsIndexDoc creates index when absent", async () => {
    const db = createDb();
    db.get.mockRejectedValue({ status: 404 });
    db.put.mockResolvedValue({ ok: true });
    await ensureCreditsIndexDoc(db as unknown as PouchDB.Database, "ol-1");
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ creditIds: [], outlineId: "ol-1" }),
    );
  });

  it("ensureCreditsIndexDoc is a no-op when index already exists", async () => {
    const db = createDb();
    db.get.mockResolvedValue({ _id: getCreditsDocId("ol-1") });
    await ensureCreditsIndexDoc(db as unknown as PouchDB.Database, "ol-1");
    expect(db.put).not.toHaveBeenCalled();
  });

  it("putCreditHistoryDoc creates a new doc when it does not exist", async () => {
    const db = createDb();
    db.get.mockRejectedValue({ status: 404 });
    db.put.mockResolvedValue({ ok: true });
    await putCreditHistoryDoc(db as unknown as PouchDB.Database, "Speakers", ["Alice"]);
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        heading: "Speakers",
        lines: ["Alice"],
        docType: "credit-history",
      }),
    );
  });

  it("putCreditHistoryDoc updates an existing doc", async () => {
    const db = createDb();
    const id = getCreditHistoryDocId("Speakers");
    db.get.mockResolvedValue({ _id: id, _rev: "1-a", heading: "Speakers", lines: ["Old"] });
    db.put.mockResolvedValue({ ok: true });
    await putCreditHistoryDoc(db as unknown as PouchDB.Database, "Speakers", ["New"]);
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ lines: ["New"], _rev: "1-a" }),
    );
  });

  it("putOverlayHistoryDocs skips keys with empty values array", async () => {
    const db = createDb();
    db.get.mockRejectedValue({ status: 404 });
    db.put.mockResolvedValue({ ok: true });
    await putOverlayHistoryDocs(
      db as unknown as PouchDB.Database,
      { "participant.name": [], "qr-code.url": ["https://example.com"] },
      ["participant.name", "qr-code.url"],
    );
    expect(db.put).toHaveBeenCalledTimes(1);
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ values: ["https://example.com"] }),
    );
  });

  it("getAllCreditDocsForOutline includes docs with no docType (legacy)", async () => {
    const db = createDb();
    const outlineId = "ol-2";
    const prefix = `${CREDITS_OUTLINE_INDEX_PREFIX}${encodeURIComponent(outlineId)}-credit-`;
    db.allDocs.mockResolvedValue({
      rows: [
        { doc: { _id: `${prefix}a`, id: "a", heading: "H" } }, // no docType
        { doc: null }, // null row
        { doc: { _id: `${prefix}b`, id: null } }, // null id
      ],
    });
    const result = await getAllCreditDocsForOutline(
      db as unknown as PouchDB.Database,
      outlineId,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("loadPreferencesBundle throws when preferences doc is missing", async () => {
    const db = createDb();
    db.get.mockRejectedValue({ status: 404 });
    await expect(
      loadPreferencesBundle(db as unknown as PouchDB.Database),
    ).rejects.toThrow("Missing or invalid preferences document");
  });

  it("loadPreferencesBundle falls back to defaults when no split docs and no legacy fields", async () => {
    const db = createDb();
    db.get.mockImplementation(async (id: string) => {
      if (id === "preferences") {
        return {
          _id: "preferences",
          preferences: { defaultSlidesPerRow: 5 },
          docType: "preferences",
        };
      }
      throw createNotFoundError();
    });
    const bundle = await loadPreferencesBundle(db as unknown as PouchDB.Database);
    expect(bundle.quickLinks).toEqual([]);
    expect(bundle.monitorSettings.showClock).toBe(true);
    expect(bundle.mediaRouteFolders).toEqual({});
  });

  it("migrateSplitPreferencesDocs returns skipped when no preferences doc exists", async () => {
    const db = createDb();
    db.get.mockRejectedValue({ status: 404 });
    const result = await migrateSplitPreferencesDocs(db as unknown as PouchDB.Database);
    expect(result.status).toBe("skipped");
    expect(result.puts).toBe(0);
  });

  it("migrateSplitPreferencesDocs is idempotent when preferences is already slim", async () => {
    const db = createDb();
    const slimPrefs = {
      _id: "preferences",
      _rev: "1-slim",
      preferences: {
        defaultSongBackground: { background: "x" },
        defaultTimerBackground: { background: "" },
        defaultBibleBackground: { background: "b" },
        defaultFreeFormBackground: { background: "f" },
        defaultSongBackgroundBrightness: 50,
        defaultTimerBackgroundBrightness: 75,
        defaultBibleBackgroundBrightness: 60,
        defaultFreeFormBackgroundBrightness: 100,
        defaultSlidesPerRow: 4,
        defaultSlidesPerRowMobile: 3,
        defaultSlidesPerRowMusic: 6,
        defaultSlidesPerRowMusicMobile: 3,
        defaultFormattedLyricsPerRow: 4,
        defaultMediaItemsPerRow: 4,
        defaultShouldShowItemEditor: true,
        defaultIsMediaExpanded: false,
        defaultBibleFontMode: "separate" as const,
        defaultFreeFormFontMode: "separate" as const,
      },
      docType: "preferences",
    };
    db.get.mockImplementation(async (id: string) => {
      if (id === "preferences") return slimPrefs;
      if (id === "quickLinks")
        return {
          _id: "quickLinks",
          _rev: "1-ql",
          quickLinks: [],
          docType: "quickLinks",
        };
      if (id === "monitorSettings")
        return {
          _id: "monitorSettings",
          _rev: "1-m",
          monitorSettings: {
            showClock: true,
            showTimer: true,
            showNextSlide: false,
            clockFontSize: 75,
            timerFontSize: 75,
            timerId: null,
          },
          docType: "monitorSettings",
        };
      if (id === "mediaRouteFolders")
        return {
          _id: "mediaRouteFolders",
          _rev: "1-f",
          mediaRouteFolders: {},
          docType: "mediaRouteFolders",
        };
      throw createNotFoundError();
    });

    const result = await migrateSplitPreferencesDocs(
      db as unknown as PouchDB.Database,
    );

    expect(result.status).toBe("skipped");
    expect(db.put).not.toHaveBeenCalled();
  });
});
