import type PouchDB from "pouchdb-browser";
import type { DBItem, ServiceItem } from "../types";
import { deleteSong } from "./songPersistence";

export type ItemLibraryDeletionProgress = {
  item: ServiceItem;
  documentDeleted: boolean;
  deletedDocument?: DBItem;
  outlineUpdated: boolean;
  timerStoreUpdated: boolean;
  timerStorageUpdated: boolean;
  timerFirebaseUpdated: boolean;
  songAudioUpdated: boolean;
  complete: boolean;
  failedStep?: string;
};

export const createItemLibraryDeletionProgress = (
  item: ServiceItem,
): ItemLibraryDeletionProgress => ({
  item,
  documentDeleted: false,
  outlineUpdated: false,
  timerStoreUpdated: false,
  timerStorageUpdated: false,
  timerFirebaseUpdated: false,
  songAudioUpdated: false,
  complete: false,
});

export class ItemLibraryDeletionError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly documentDeleted: boolean,
  ) {
    super(message);
    this.name = "ItemLibraryDeletionError";
  }
}

type DeleteItemOptions = {
  db: PouchDB.Database | undefined;
  progress: ItemLibraryDeletionProgress;
  assertSessionCanContinue: () => void;
  isOriginalOutlineOpen: () => boolean;
  removeItemFromOpenOutline: () => void;
  clearUndoHistory: () => void;
  removeTimerFromStore: () => void;
  removeTimerFromLocalStorage: () => void;
  removeTimerFromFirebase?: () => Promise<void>;
  removeSongAudio?: (document: DBItem) => Promise<void>;
};

const fail = (progress: ItemLibraryDeletionProgress, step: string, error: unknown): never => {
  const message = error instanceof Error && error.message
    ? error.message
    : "Could not complete this deletion. Check the connection and try again.";
  progress.failedStep = step;
  throw new ItemLibraryDeletionError(message, step, progress.documentDeleted);
};

/** Runs only unfinished steps, so a retry never repeats a completed deletion or cleanup. */
export async function deleteLibraryItemWithProgress({
  db,
  progress,
  assertSessionCanContinue,
  isOriginalOutlineOpen,
  removeItemFromOpenOutline,
  clearUndoHistory,
  removeTimerFromStore,
  removeTimerFromLocalStorage,
  removeTimerFromFirebase,
  removeSongAudio,
}: DeleteItemOptions): Promise<ItemLibraryDeletionProgress> {
  const { item } = progress;
  progress.failedStep = undefined;

  if (!progress.documentDeleted) {
    try {
      assertSessionCanContinue();
      if (!db) throw new Error("The item database is not available.");
      if (item.type === "song") {
        progress.deletedDocument = await deleteSong(db, item._id);
      } else {
        const document = await db.get(item._id) as DBItem;
        assertSessionCanContinue();
        if (document.type !== item.type) {
          throw new Error("The saved item has changed. Refresh the library and try again.");
        }
        progress.deletedDocument = document;
        await db.remove(document as PouchDB.Core.RemoveDocument);
      }
      progress.documentDeleted = true;
      assertSessionCanContinue();
    } catch (error) {
      fail(progress, "saved item", error);
    }
  }

  if (!progress.outlineUpdated) {
    try {
      assertSessionCanContinue();
      if (!isOriginalOutlineOpen()) {
        throw new Error("The open outline changed. Return to the original outline and retry cleanup.");
      }
      removeItemFromOpenOutline();
      clearUndoHistory();
      progress.outlineUpdated = true;
    } catch (error) {
      fail(progress, "open outline", error);
    }
  }

  if (item.type === "timer") {
    if (!progress.timerStoreUpdated) {
      try {
        assertSessionCanContinue();
        removeTimerFromStore();
        progress.timerStoreUpdated = true;
      } catch (error) {
        fail(progress, "timer list", error);
      }
    }
    if (!progress.timerStorageUpdated) {
      try {
        assertSessionCanContinue();
        removeTimerFromLocalStorage();
        progress.timerStorageUpdated = true;
      } catch (error) {
        fail(progress, "timer storage", error);
      }
    }
    if (!progress.timerFirebaseUpdated) {
      try {
        assertSessionCanContinue();
        await removeTimerFromFirebase?.();
        progress.timerFirebaseUpdated = true;
        assertSessionCanContinue();
      } catch (error) {
        fail(progress, "shared timer data", error);
      }
    }
  }

  if (item.type === "song" && progress.deletedDocument?.songAudio && !progress.songAudioUpdated) {
    try {
      assertSessionCanContinue();
      await removeSongAudio?.(progress.deletedDocument);
      progress.songAudioUpdated = true;
      assertSessionCanContinue();
    } catch (error) {
      fail(progress, "song audio", error);
    }
  } else if (item.type === "song" && !progress.deletedDocument?.songAudio) {
    progress.songAudioUpdated = true;
  }

  progress.complete = true;
  progress.failedStep = undefined;
  return progress;
}
