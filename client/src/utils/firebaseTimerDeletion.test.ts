import { ref, runTransaction } from "firebase/database";
import { removeFirebaseTimerWithTransaction } from "./firebaseTimerDeletion";

jest.mock("firebase/database", () => ({
  ref: jest.fn((_db: unknown, path: string) => path),
  runTransaction: jest.fn(),
}));

const runTransactionMock = runTransaction as jest.Mock;

describe("removeFirebaseTimerWithTransaction", () => {
  beforeEach(() => runTransactionMock.mockReset());

  it("retries against the latest shared array and preserves concurrent timer changes", async () => {
    const initial = [
      { id: "delete-me", hostId: "host-a", time: 1 },
      { id: "edit-me", hostId: "host-b", name: "Old name" },
    ];
    const retried = [
      { id: "delete-me", hostId: "host-a", time: 1 },
      { id: "edit-me", hostId: "host-b", name: "Changed elsewhere" },
      { id: "created-elsewhere", hostId: "host-c" },
    ];
    const db = {};
    runTransactionMock.mockImplementation(async (_ref, update) => {
      const firstAttempt = update(initial);
      expect(firstAttempt).toEqual([{ id: "edit-me", hostId: "host-b", name: "Old name" }]);
      const committed = update(retried);
      expect(committed).toEqual([
        { id: "edit-me", hostId: "host-b", name: "Changed elsewhere" },
        { id: "created-elsewhere", hostId: "host-c" },
      ]);
      expect(update(committed)).toEqual(committed);
      return { committed: true, snapshot: { val: () => committed } };
    });

    await removeFirebaseTimerWithTransaction({
      db: db as never,
      churchId: "church-1",
      timerId: "delete-me",
      isAuthorized: () => true,
    });

    expect(ref).toHaveBeenCalledWith(db, "churches/church-1/data/timers");
    expect(runTransactionMock).toHaveBeenCalledWith(
      "churches/church-1/data/timers",
      expect.any(Function),
      { applyLocally: false },
    );
  });

  it("aborts a retried transaction when the captured session is no longer authorized", async () => {
    let authorized = true;
    runTransactionMock.mockImplementation(async (_ref, update) => {
      expect(update([{ id: "delete-me" }])).toEqual([]);
      authorized = false;
      expect(update([{ id: "delete-me" }, { id: "other" }])).toBeUndefined();
      return { committed: false };
    });

    await expect(removeFirebaseTimerWithTransaction({
      db: {} as never,
      churchId: "church-1",
      timerId: "delete-me",
      isAuthorized: () => authorized,
    })).rejects.toThrow(/session or permission changed/i);
  });
});
