import {
  CREDIT_HISTORY_ID_PREFIX,
  OVERLAY_HISTORY_ID_PREFIX,
  getCreditHistoryDocId,
  getOverlayHistoryDocId,
} from "../types";
import {
  deleteUnusedBibleItems,
  getAllCreditsHistory,
  getAllOverlayDocs,
  getAllOverlayHistory,
  getCreditsByIds,
  getOverlayUsageByList,
  getOverlaysByIds,
  migrateDocTypes,
  migrateFontSizesToDefaults,
  migrateFontSizesToPixels,
  putCreditDoc,
  putCreditHistoryDocs,
  putOverlayHistoryDoc,
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

const createNotFoundError = () => Object.assign(new Error("Not found"), { status: 404 });

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
      if (id === "list-1") return { name: "Sunday Morning", overlays: ["a", "b", "a"] };
      if (id === "list-2") throw new Error("broken list");
      return {};
    });

    const usage = await getOverlayUsageByList(db as unknown as PouchDB.Database);

    expect(Array.from(usage.entries())).toEqual([
      ["a", ["Sunday Morning"]],
      ["b", ["Sunday Morning"]],
    ]);
  });

  it("loads overlays by ids and filters missing docs", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [{ doc: { _id: "overlay-a", id: "a", type: "participant" } }, {}],
    });

    const overlays = await getOverlaysByIds(
      db as unknown as PouchDB.Database,
      ["a", "missing"],
    );

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
    db.get.mockResolvedValue({ _id: getCreditHistoryDocId("ToDelete"), _rev: "1-a" });

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
      removeOverlayHistoryDoc(db as unknown as PouchDB.Database, "participant.name"),
    ).resolves.toBeUndefined();
  });

  it("gets credits by ids preserving requested order", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        { doc: { id: "b", heading: "B", text: "Tb", hidden: false } },
        { doc: { id: "a", heading: "A", text: "Ta", hidden: true } },
      ],
    });

    const credits = await getCreditsByIds(
      db as unknown as PouchDB.Database,
      ["a", "missing", "b"],
    );

    expect(credits).toEqual([
      { id: "a", heading: "A", text: "Ta", hidden: true },
      { id: "b", heading: "B", text: "Tb", hidden: false },
    ]);
  });

  it("updates a credit doc and returns null on error", async () => {
    const db = createDb();
    db.get.mockResolvedValueOnce({
      _id: "credit-c1",
      _rev: "1-a",
      id: "c1",
      heading: "Old",
      text: "Old text",
      hidden: false,
    });
    const updated = await putCreditDoc(db as unknown as PouchDB.Database, {
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
    const failed = await putCreditDoc(db as unknown as PouchDB.Database, {
      id: "c2",
      heading: "x",
      text: "y",
      hidden: false,
    });
    expect(failed).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
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
        items: [{ _id: "bible-1", type: "bible" }, { _id: "song-1", type: "song" }],
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

    const result = await migrateFontSizesToPixels(db as unknown as PouchDB.Database);

    expect(result).toEqual({ migratedCount: 1, errorCount: 0 });
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "song-1",
        slides: [
          expect.objectContaining({
            boxes: [expect.objectContaining({ fontSize: 45 })],
            monitorCurrentBandBoxes: [expect.objectContaining({ fontSize: 36 })],
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
            slides: [{ boxes: [{ fontSize: 1 }] }, { boxes: [{ fontSize: 1 }] }],
            arrangements: [
              { slides: [{ boxes: [{ fontSize: 1 }] }, { boxes: [{ fontSize: 1 }] }] },
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

  it("migrates doc types and skips unchanged or design docs", async () => {
    const db = createDb();
    db.allDocs.mockResolvedValue({
      rows: [
        { doc: { _id: "_design/index" } },
        { doc: { _id: "allItems", docType: "allItems" } },
        { doc: { _id: "overlay-abc", type: "participant" } },
        { doc: { _id: "credit-xyz" } },
        { doc: { _id: "list-1", items: [], overlays: [] } },
        { doc: { _id: "unknown-1" } },
      ],
    });
    db.put.mockImplementation(async (doc: { _id: string }) => {
      if (doc._id === "unknown-1") throw new Error("cannot write");
      return doc;
    });

    const result = await migrateDocTypes(db as unknown as PouchDB.Database);

    expect(result).toEqual({ updatedCount: 3, errorCount: 1, skippedCount: 2 });
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "overlay-abc", docType: "overlay" }),
    );
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "credit-xyz", docType: "credit" }),
    );
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "list-1", docType: "itemListDetails" }),
    );
  });
});
