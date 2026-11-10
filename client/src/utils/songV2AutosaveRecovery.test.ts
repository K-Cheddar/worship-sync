import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import type { DBItem, ItemContentOwner, ItemState } from "../types";
import {
  clearSongV2AutosaveRecoveriesForTests,
  deleteSongV2AutosaveRecovery,
  getSongV2AutosaveRecoveryId,
  listSongV2AutosaveRecoveries,
  markSongV2AutosaveRecoveryDiscarded,
  markSongV2AutosaveRecoveryNeedsReview,
  putSongV2AutosaveRecovery,
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
    id: getSongV2AutosaveRecoveryId(owner, itemId),
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
    await markSongV2AutosaveRecoveryDiscarded(saved.id, ownerA);
    expect((await listSongV2AutosaveRecoveries(ownerA))[0].status).toBe("discarded");

    await deleteSongV2AutosaveRecovery(saved.id, ownerA);
    expect(await listSongV2AutosaveRecoveries(ownerA)).toEqual([]);
  });
});
