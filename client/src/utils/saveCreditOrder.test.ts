import { saveCreditOrder } from "./saveCreditOrder";

const fixture = (creditIds: string[]) => {
  let revision = 1;
  let doc = { _id: "credits-outline-a", _rev: "1-original", creditIds, updatedAt: "original", extra: true };
  const get = jest.fn(async () => ({ ...doc }));
  const put = jest.fn(async (next: typeof doc) => {
    if (next._rev !== doc._rev) throw Object.assign(new Error("revision conflict"), { status: 409 });
    doc = { ...next, _rev: ++revision + "-saved" };
    return { rev: doc._rev };
  });
  return { db: { get, put } as unknown as PouchDB.Database, get, put, current: () => doc };
};

describe("credits index persistence", () => {
  it("retains the revision and timestamp when another writer already applied the edit", async () => {
    const f = fixture(["b", "a"]);
    expect(await saveCreditOrder(f.db, "a", ["a", "b"], ["b", "a"])).toBeUndefined();
    expect(f.put).not.toHaveBeenCalled();
    expect(f.current().updatedAt).toBe("original");
  });

  it("saves membership and order changes once and returns the committed revision", async () => {
    const f = fixture(["a", "b"]);
    const added = await saveCreditOrder(f.db, "a", ["a", "b"], ["a", "c", "b"]);
    expect(added).toMatchObject({ creditIds: ["a", "c", "b"], _rev: "2-saved", extra: true });
    expect(added?.updatedAt).not.toBe("original");
    const reordered = await saveCreditOrder(f.db, "a", ["a", "c", "b"], ["b", "c", "a"]);
    expect(reordered?.creditIds).toEqual(["b", "c", "a"]);
    await saveCreditOrder(f.db, "a", ["c"], []);
    expect(f.current().creditIds).toEqual(["b", "a"]);
    expect(f.put).toHaveBeenCalledTimes(3);
  });

  it("retries on the latest revision, preserving a concurrent addition and deletion", async () => {
    const f = fixture(["a", "b", "c"]);
    const write = f.put.getMockImplementation()!;
    f.put.mockImplementationOnce(async () => {
      await write({ ...f.current(), creditIds: ["a", "b", "remote"] });
      throw Object.assign(new Error("revision conflict"), { status: 409 });
    });
    const saved = await saveCreditOrder(f.db, "a", ["a", "b", "c"], ["b", "a", "c"]);
    expect(saved?.creditIds).toEqual(["b", "a", "remote"]);
    expect(saved?._rev).toBe("3-saved");
  });

  it("runs overlapping local edits in order even when the first read stalls", async () => {
    const f = fixture(["a"]);
    let resume!: () => void;
    const wait = new Promise<void>(resolve => { resume = resolve; });
    f.get.mockImplementationOnce(async () => { await wait; return f.current(); });
    const add = saveCreditOrder(f.db, "a", ["a"], ["a", "b"]);
    const remove = saveCreditOrder(f.db, "a", ["a", "b"], ["a"]);
    resume();
    await Promise.all([add, remove]);
    expect(f.current().creditIds).toEqual(["a"]);
    expect(f.put).toHaveBeenCalledTimes(2);
  });

  it("does not materialize starter credits when an empty index has no authored order change", async () => {
    const f = fixture([]);
    expect(await saveCreditOrder(f.db, "a", ["starter"], ["starter"])).toBeUndefined();
    expect(f.current().creditIds).toEqual([]);
    await f.put({ ...f.current(), creditIds: [] });
    expect(await saveCreditOrder(f.db, "a", ["starter"], ["starter"])).toBeUndefined();
    expect(f.current().creditIds).toEqual([]);
  });
});
