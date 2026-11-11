import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import type { DBItem, ItemContentOwner, ItemState } from "../types";
import {
  clearSongV2AutosaveRecoveriesForTests,
  deleteSongV2AutosaveRecovery,
  createSongV2AutosaveRecoveryId,
  listSongV2AutosaveRecoveries,
  markSongV2AutosaveRecoveryDiscarded,
  markSongV2AutosaveRecoveryNeedsReview,
  putSongV2AutosaveRecovery,
  withSongV2AutosaveLock,
} from "./songV2AutosaveRecovery";

const ownerA: ItemContentOwner = {
  scopeId: "church-a:user-a:db-a",
  databaseKey: "db-a",
  churchId: "church-a",
  accountId: "user-a",
};

const recovery = (owner: ItemContentOwner) => {
  const itemId = "song-1";
  const baseline = { _id: itemId, type: "song", docType: "song-v2-root" } as DBItem;
  const desired = { ...baseline, contentOwner: owner, name: "Recovered title" } as ItemState;
  return {
    id: createSongV2AutosaveRecoveryId(owner, itemId),
    owner,
    itemId,
    desired,
    baseline,
    mutationVersion: 1,
    status: "pending" as const,
  };
};

describe("Song V2 autosave recovery storage", () => {
  beforeEach(async () => clearSongV2AutosaveRecoveriesForTests());
  afterEach(async () => clearSongV2AutosaveRecoveriesForTests());

  it("keeps records private to the exact account and church owner", async () => {
    const saved = recovery(ownerA);
    await putSongV2AutosaveRecovery(saved);

    expect(await listSongV2AutosaveRecoveries(ownerA)).toEqual([saved]);
    expect(await listSongV2AutosaveRecoveries({
      ...ownerA,
      accountId: "user-b",
      scopeId: "church-a:user-b:db-a",
    })).toEqual([]);
    expect(await listSongV2AutosaveRecoveries({
      ...ownerA,
      churchId: "church-b",
      scopeId: "church-b:user-a:db-a",
    })).toEqual([]);

    await deleteSongV2AutosaveRecovery(saved.id, {
      ...ownerA,
      accountId: "user-b",
      scopeId: "church-a:user-b:db-a",
    });
    expect(await listSongV2AutosaveRecoveries(ownerA)).toHaveLength(1);
  });

  it("retains unresolved review state and deletes only for its matching owner", async () => {
    const saved = recovery(ownerA);
    await putSongV2AutosaveRecovery(saved);
    await markSongV2AutosaveRecoveryNeedsReview(saved.id, ownerA);
    expect((await listSongV2AutosaveRecoveries(ownerA))[0].status).toBe("needs-review");
    await markSongV2AutosaveRecoveryDiscarded(saved.id, ownerA, saved.itemId);
    expect((await listSongV2AutosaveRecoveries(ownerA))[0].status).toBe("discarded");

    await deleteSongV2AutosaveRecovery(saved.id, ownerA);
    expect(await listSongV2AutosaveRecoveries(ownerA)).toEqual([]);
  });

  it("keeps concurrent writer records separate and deletes only the completed writer's record", async () => {
    const firstWriter = recovery(ownerA);
    const secondWriter = recovery(ownerA);
    secondWriter.desired = { ...secondWriter.desired, name: "Second writer title" };

    expect(firstWriter.id).not.toBe(secondWriter.id);
    expect(await putSongV2AutosaveRecovery(firstWriter)).toBe(true);
    expect(await putSongV2AutosaveRecovery(secondWriter)).toBe(true);

    await deleteSongV2AutosaveRecovery(secondWriter.id, ownerA);

    expect(await listSongV2AutosaveRecoveries(ownerA)).toEqual([firstWriter]);
  });

  it("does not let a stale writer replace a durable discard tombstone", async () => {
    const saved = recovery(ownerA);
    await putSongV2AutosaveRecovery(saved);
    await markSongV2AutosaveRecoveryDiscarded(saved.id, ownerA, saved.itemId);

    expect(await putSongV2AutosaveRecovery({
      ...saved,
      desired: { ...saved.desired, name: "Stale retry" },
      status: "pending",
    })).toBe(false);
    expect((await listSongV2AutosaveRecoveries(ownerA))[0].status).toBe("discarded");
  });

  it("keeps an explicit discard durable when a completed writer already removed its checkpoint", async () => {
    const saved = recovery(ownerA);
    await putSongV2AutosaveRecovery(saved);
    await deleteSongV2AutosaveRecovery(saved.id, ownerA);

    await markSongV2AutosaveRecoveryDiscarded(saved.id, ownerA, saved.itemId);

    expect(await listSongV2AutosaveRecoveries(ownerA)).toEqual([{
      id: saved.id,
      owner: ownerA,
      itemId: saved.itemId,
      status: "discarded",
    }]);
    expect(await putSongV2AutosaveRecovery(saved)).toBe(false);
  });

  it("fails closed when cross-window write coordination is unavailable", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });

    try {
      await expect(withSongV2AutosaveLock("song-1", "db-a", async () => "written"))
        .rejects.toThrow("Cross-window Song V2 write coordination is unavailable.");
    } finally {
      if (original) Object.defineProperty(navigator, "locks", original);
      else Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    }
  });
});
