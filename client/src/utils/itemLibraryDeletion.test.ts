import type { DBItem, ServiceItem } from "../types";
import {
  createItemLibraryDeletionProgress,
  deleteLibraryItemWithProgress,
  ItemLibraryDeletionError,
} from "./itemLibraryDeletion";

const item = (type: "song" | "free" | "timer", id = `${type}-1`): ServiceItem => ({
  _id: id, name: `Item ${id}`, type, listId: `${id}-row`,
});

const options = (overrides: Record<string, unknown> = {}) => ({
  db: {
    get: jest.fn().mockResolvedValue({ _id: "free-1", name: "Item", type: "free", _rev: "1-a" }),
    remove: jest.fn().mockResolvedValue({ ok: true }),
  } as any,
  progress: createItemLibraryDeletionProgress(item("free")),
  assertSessionCanContinue: jest.fn(),
  isOriginalOutlineOpen: jest.fn(() => true),
  removeItemFromOpenOutline: jest.fn(),
  clearUndoHistory: jest.fn(),
  removeTimerFromStore: jest.fn(),
  removeTimerFromLocalStorage: jest.fn(),
  ...overrides,
});

describe("deleteLibraryItemWithProgress", () => {
  it("does not claim success or alter the outline when the item database is missing", async () => {
    const args = options({ db: undefined });

    await expect(deleteLibraryItemWithProgress(args as any)).rejects.toMatchObject({
      name: "ItemLibraryDeletionError",
      message: "The item database is not available.",
      documentDeleted: false,
    });
    expect(args.removeItemFromOpenOutline).not.toHaveBeenCalled();
    expect(args.clearUndoHistory).not.toHaveBeenCalled();
    expect(args.progress.complete).toBe(false);
  });

  it("deletes a saved document, removes its occurrences from the active outline, and clears history", async () => {
    const args = options();
    await deleteLibraryItemWithProgress(args as any);

    expect(args.db.get).toHaveBeenCalledWith("free-1");
    expect(args.db.remove).toHaveBeenCalledWith(expect.objectContaining({ _id: "free-1" }));
    expect(args.removeItemFromOpenOutline).toHaveBeenCalledTimes(1);
    expect(args.clearUndoHistory).toHaveBeenCalledTimes(1);
    expect(args.progress).toMatchObject({ documentDeleted: true, outlineUpdated: true, complete: true });
  });

  it("resumes after a cleanup failure without repeating the committed deletion or outline update", async () => {
    const song = item("song");
    const audio = { id: "audio-1", key: "audio-key" };
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "song-v2:root:song-1") throw Object.assign(new Error("Not found"), { status: 404 });
        return { _id: "song-1", name: song.name, type: "song", songAudio: audio } as DBItem;
      }),
      remove: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const removeFromOutline = jest.fn();
    const clearHistory = jest.fn();
    const removeAudio = jest.fn()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue(undefined);
    const progress = createItemLibraryDeletionProgress(song);
    const args = {
      ...options(), db, progress,
      removeItemFromOpenOutline: removeFromOutline,
      clearUndoHistory: clearHistory,
      removeSongAudio: removeAudio,
    };

    await expect(deleteLibraryItemWithProgress(args as any)).rejects.toMatchObject({
      name: "ItemLibraryDeletionError",
      step: "song audio",
      documentDeleted: true,
    });
    expect(progress).toMatchObject({ documentDeleted: true, outlineUpdated: true, songAudioUpdated: false });

    await deleteLibraryItemWithProgress(args as any);
    expect(db.remove).toHaveBeenCalledTimes(1);
    expect(removeFromOutline).toHaveBeenCalledTimes(1);
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(removeAudio).toHaveBeenCalledTimes(2);
    expect(progress.complete).toBe(true);
  });

  it("preserves V2 song deletion refusal and does not alter the outline", async () => {
    const v2Root = { _id: "song-v2:root:song-1", docType: "song-v2-root", songId: "song-1" };
    const db = {
      get: jest.fn().mockResolvedValue(v2Root),
      remove: jest.fn(),
    } as any;
    const removeFromOutline = jest.fn();
    const progress = createItemLibraryDeletionProgress(item("song"));

    await expect(deleteLibraryItemWithProgress({
      ...options(), db, progress, removeItemFromOpenOutline: removeFromOutline,
    } as any)).rejects.toEqual(expect.objectContaining({
      name: "ItemLibraryDeletionError",
      message: expect.stringContaining("migrated"),
      documentDeleted: false,
    }));
    expect(db.remove).not.toHaveBeenCalled();
    expect(removeFromOutline).not.toHaveBeenCalled();
  });

  it("keeps a committed document deletion retryable when the active session changes at the await boundary", async () => {
    const args = options();
    let checks = 0;
    args.assertSessionCanContinue = jest.fn(() => {
      checks += 1;
      if (checks === 3) throw new Error("Your session changed.");
    });

    await expect(deleteLibraryItemWithProgress(args as any)).rejects.toBeInstanceOf(ItemLibraryDeletionError);
    expect(args.progress.documentDeleted).toBe(true);
    expect(args.removeItemFromOpenOutline).not.toHaveBeenCalled();

    args.assertSessionCanContinue = jest.fn();
    await deleteLibraryItemWithProgress(args as any);
    expect(args.db.get).toHaveBeenCalledTimes(1);
    expect(args.db.remove).toHaveBeenCalledTimes(1);
    expect(args.removeItemFromOpenOutline).toHaveBeenCalledTimes(1);
    expect(args.progress.complete).toBe(true);
  });
});
