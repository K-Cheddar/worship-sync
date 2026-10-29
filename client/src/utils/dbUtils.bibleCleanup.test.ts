import {
  BIBLE_ITEM_CLEANUP_GRACE_PERIOD_MS,
  deleteUnusedBibleItems,
} from "./dbUtils";
import type { DBItem } from "../types";

type TestDoc = Record<string, any>;

const oldDate = new Date(
  Date.now() - BIBLE_ITEM_CLEANUP_GRACE_PERIOD_MS - 60_000,
).toISOString();

const bible = (id: string, date = oldDate): DBItem => ({
  _id: id,
  _rev: "1-bible",
  name: id,
  type: "bible",
  selectedArrangement: 0,
  arrangements: [],
  slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  createdAt: date,
  updatedAt: date,
});

const outline = (id: string, items: Array<{ _id: string; type?: string }>) => ({
  _id: id,
  _rev: "1-outline",
  docType: "itemListDetails",
  items,
});

const createDb = (initialDocs: TestDoc[]) => {
  const docs = new Map(initialDocs.map((doc) => [doc._id, { ...doc }]));
  let sequence = 1;
  const db = {
    get: jest.fn(async (id: string) => {
      const doc = docs.get(id);
      if (!doc) throw Object.assign(new Error("missing"), { status: 404 });
      return { ...doc };
    }),
    allDocs: jest.fn(async ({ keys }: { keys: string[] }) => ({
      rows: keys.map((key) => {
        const doc = docs.get(key);
        return doc ? { id: key, doc: { ...doc } } : { key, error: "not_found" };
      }),
      update_seq: sequence,
      total_rows: docs.size,
    })),
    info: jest.fn(async () => ({ update_seq: sequence })),
    bulkDocs: jest.fn(async (changes: Array<TestDoc & { _deleted: true }>) => {
      const results = changes.map((change) => {
        const current = docs.get(change._id);
        if (!current || current._rev !== change._rev) {
          return { id: change._id, error: "conflict" };
        }
        docs.delete(change._id);
        sequence += 1;
        return { id: change._id, ok: true };
      });
      return results;
    }),
  };
  return { db: db as unknown as PouchDB.Database, docs, rawDb: db };
};

describe("deleteUnusedBibleItems", () => {
  it("deletes old unreferenced Bible docs while preserving references in every saved outline and other item types", async () => {
    const referencedA = bible("bible-a");
    const referencedB = bible("bible-b");
    const orphan = bible("bible-orphan");
    const outlineA = outline("outline-a", [{ _id: referencedA._id, type: "bible" }]);
    const outlineB = outline("outline-b", [{ _id: referencedB._id, type: "bible" }]);
    const song = { _id: "song", _rev: "1-song", type: "song" };
    const custom = { _id: "custom", _rev: "1-custom", type: "free" };
    const heading = { _id: "heading", _rev: "1-heading", type: "heading" };
    const { db, docs, rawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline-a" }, { _id: "outline-b" }] },
      outlineA,
      outlineB,
      referencedA,
      referencedB,
      orphan,
      song,
      custom,
      heading,
    ]);

    await expect(
      deleteUnusedBibleItems({
        db,
        bibleItems: [referencedA, referencedB, orphan],
      }),
    ).resolves.toBe(1);

    expect(docs.has("bible-orphan")).toBe(false);
    expect(docs.has("bible-a")).toBe(true);
    expect(docs.has("bible-b")).toBe(true);
    expect(docs.has("song")).toBe(true);
    expect(docs.has("custom")).toBe(true);
    expect(docs.has("heading")).toBe(true);
    expect(rawDb.allDocs).toHaveBeenCalledTimes(1);
    expect(rawDb.allDocs.mock.calls[0][0].keys).not.toContain("AllItems");
  });

  it("fails closed when the outline registry or any listed outline is incomplete", async () => {
    const item = bible("orphan");
    const missingOutline = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "missing-outline" }] },
      item,
    ]);
    const failedEnumeration = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      item,
    ]);
    failedEnumeration.rawDb.allDocs.mockRejectedValueOnce(new Error("read failed"));

    await expect(
      deleteUnusedBibleItems({ db: missingOutline.db, bibleItems: [item] }),
    ).resolves.toBeNull();
    await expect(
      deleteUnusedBibleItems({ db: failedEnumeration.db, bibleItems: [item] }),
    ).resolves.toBeNull();
    expect(missingOutline.rawDb.bulkDocs).not.toHaveBeenCalled();
    expect(failedEnumeration.rawDb.bulkDocs).not.toHaveBeenCalled();
  });

  it("fails closed when the keyed inventory returns an unexpected or duplicate row", async () => {
    const item = bible("orphan");
    const { db, rawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      item,
    ]);
    rawDb.allDocs.mockResolvedValueOnce({
      rows: [
        { id: "outline", doc: outline("outline", []) },
        { id: "outline", doc: { ...item, _id: "orphan" } },
      ],
      update_seq: 1,
      total_rows: 3,
    });

    await expect(
      deleteUnusedBibleItems({ db, bibleItems: [item] }),
    ).resolves.toBeNull();
    expect(rawDb.bulkDocs).not.toHaveBeenCalled();
  });

  it("does not delete while a sync or pending write is active", async () => {
    const item = bible("orphan");
    const { db, rawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      item,
    ]);

    await expect(
      deleteUnusedBibleItems({ db, bibleItems: [item], canRun: () => false }),
    ).resolves.toBeNull();

    expect(rawDb.allDocs).not.toHaveBeenCalled();
    expect(rawDb.bulkDocs).not.toHaveBeenCalled();
  });

  it("keeps recent or timestamp-uncertain Bible docs until they can be proven old", async () => {
    const item = bible("new-bible", new Date().toISOString());
    const uncertain = { ...bible("uncertain-bible"), createdAt: "not-a-date" };
    const { db, docs, rawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      item,
      uncertain,
    ]);

    await expect(
      deleteUnusedBibleItems({ db, bibleItems: [item, uncertain] }),
    ).resolves.toBeNull();

    expect(docs.has(item._id)).toBe(true);
    expect(docs.has(uncertain._id)).toBe(true);
    expect(rawDb.bulkDocs).not.toHaveBeenCalled();

    const { db: uncertainDb, rawDb: uncertainRawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      uncertain,
    ]);
    await expect(
      deleteUnusedBibleItems({ db: uncertainDb, bibleItems: [uncertain] }),
    ).resolves.toBe(0);
    expect(uncertainRawDb.bulkDocs).not.toHaveBeenCalled();
  });

  it("aborts when a database write changes the outline snapshot during cleanup", async () => {
    const item = bible("orphan");
    const { db, docs, rawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      item,
    ]);
    rawDb.info.mockImplementationOnce(async () => ({ update_seq: 2 }));

    await expect(
      deleteUnusedBibleItems({ db, bibleItems: [item] }),
    ).resolves.toBeNull();

    expect(docs.has(item._id)).toBe(true);
    expect(rawDb.bulkDocs).not.toHaveBeenCalled();
  });

  it("coalesces concurrent cleanup attempts for one database", async () => {
    const item = bible("orphan");
    const { db, rawDb } = createDb([
      { _id: "ItemLists", _rev: "1-lists", itemLists: [{ _id: "outline" }] },
      outline("outline", []),
      item,
    ]);
    let releaseInventory!: () => void;
    const inventoryRead = new Promise<void>((resolve) => {
      releaseInventory = resolve;
    });
    const readInventory = rawDb.allDocs.getMockImplementation()!;
    rawDb.allDocs.mockImplementation(async (options) => {
      await inventoryRead;
      return readInventory(options);
    });

    const first = deleteUnusedBibleItems({ db, bibleItems: [item] });
    const second = deleteUnusedBibleItems({ db, bibleItems: [item] });
    await Promise.resolve();
    releaseInventory();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(rawDb.allDocs).toHaveBeenCalledTimes(1);
    expect(rawDb.bulkDocs).toHaveBeenCalledTimes(1);
  });
});
