import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import mediaReducer from "../store/mediaSlice";
import type { MediaType } from "../types";
import * as controllerInfo from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { MEDIA_LIBRARY_META_ID, MEDIA_FOLDERS_ID, mediaItemDocId } from "../utils/mediaDocUtils";
import { updateMediaItemFields } from "../store/mediaSlice";
import type { LocalImageUploadJob } from "../utils/localImageAssets";
import * as uploadQueue from "../utils/localImageUploadQueue";
import { useLocalVideoInputThumbnailPersistence } from "./useLocalVideoInputThumbnailPersistence";

jest.mock("../utils/localImageAssets", () => {
  const actual = jest.requireActual("../utils/localImageAssets") as Record<string, unknown>;
  return {
    ...actual,
    saveLocalImage: jest.fn().mockResolvedValue(undefined),
    deleteLocalImage: jest.fn().mockResolvedValue(undefined),
    deleteLocalImageUploadJob: jest.fn().mockResolvedValue(undefined),
    getLocalImageUploadJob: jest.fn().mockResolvedValue(undefined),
    getRememberedLocalImagePolicy: jest.fn(() => "local-only"),
    putLocalImageUploadJob: jest.fn().mockResolvedValue(undefined),
    stageLocalImageUploadCleanupJobAtomically: jest.fn(async (job) => ({
      job,
      previous: undefined,
    })),
  };
});

jest.mock("../utils/localImageUploadQueue", () => ({
  cancelLocalImageUpload: jest.fn().mockResolvedValue(undefined),
  enqueueLocalImageUpload: jest.fn().mockResolvedValue(undefined),
}));

const mediaId = "local_input_camera-source";
const source = {
  kind: "local-video-input" as const,
  sourceId: "camera-source",
  deviceId: "camera-device",
  label: "Booth camera",
};
const oldLocalImage = {
  id: "old-thumbnail-asset",
  ownerDeviceId: "device-a",
  ownerLabel: "Camera owner",
  fileName: "original.webp",
  contentType: "image/webp",
  storagePolicy: "local-only" as const,
};

const createMediaRow = (): MediaType => ({
  id: mediaId,
  name: "Booth camera",
  path: "",
  createdAt: "created-before-relink",
  updatedAt: "updated-before-relink",
  format: "live",
  height: 1080,
  width: 1920,
  publicId: mediaId,
  type: "video",
  background: "local-video-input://camera-source",
  thumbnail: "https://images.example.com/original.webp",
  placeholderImage: "",
  source: "local",
  folderId: "existing-folder",
  localVideoInput: source,
  localImage: oldLocalImage,
  providerStorage: {
    provider: "mux",
    assetId: "existing-owner-asset",
    churchId: "church-1",
    permanent: true,
  },
} as MediaType);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createPouchDb = (initialRow: MediaType, persistInitialRow = true) => {
  const docs = new Map<string, Record<string, unknown>>([
    [MEDIA_LIBRARY_META_ID, {
      _id: MEDIA_LIBRARY_META_ID,
      docType: "mediaLibraryMeta",
      schemaVersion: 2,
    }],
    [MEDIA_FOLDERS_ID, {
      _id: MEDIA_FOLDERS_ID,
      docType: "mediaFolders",
      folders: [{ id: "existing-folder", name: "Cameras", parentId: null }],
    }],
  ]);
  if (persistInitialRow) {
    docs.set(mediaItemDocId(initialRow.id), {
      ...initialRow,
      _id: mediaItemDocId(initialRow.id),
      _rev: "1-existing",
      docType: "mediaItem",
    });
  }
  const pendingPut = deferred<PouchDB.Core.Response>();
  let deferNextRowPut = false;
  let rejectNextRowPut = false;
  const db = {
    name: "thumbnail-persistence-test",
    get: jest.fn(async (id: string) => {
      const doc = docs.get(id);
      if (!doc) throw Object.assign(new Error("missing"), { status: 404 });
      return { ...doc };
    }),
    allDocs: jest.fn(async () => ({
      rows: [...docs.entries()]
        .filter(([id]) => id.startsWith("media-item:"))
        .map(([id, doc]) => ({ id, doc: { ...doc } })),
    })),
    put: jest.fn((input: Record<string, unknown>) => {
      const id = String(input._id);
      const response = { ok: true, id, rev: "2-updated" } as PouchDB.Core.Response;
      const persist = () => {
        docs.set(id, { ...input, _rev: response.rev });
        return response;
      };
      if (id === mediaItemDocId(mediaId) && rejectNextRowPut) {
        rejectNextRowPut = false;
        return Promise.reject(new Error("write failed"));
      }
      if (id === mediaItemDocId(mediaId) && deferNextRowPut) {
        deferNextRowPut = false;
        return pendingPut.promise.then(persist);
      }
      return Promise.resolve(persist());
    }),
    deferNextRowPut: () => {
      deferNextRowPut = true;
    },
    rejectNextRowPut: () => {
      rejectNextRowPut = true;
    },
    commitDeferredPut: () => pendingPut.resolve({ ok: true, id: mediaItemDocId(mediaId), rev: "2-updated" }),
    readRow: () => docs.get(mediaItemDocId(mediaId)),
    removeRow: () => docs.delete(mediaItemDocId(mediaId)),
    changePersistedSourceId: (sourceId: string) => {
      const row = docs.get(mediaItemDocId(mediaId));
      if (!row) return;
      const localVideoInput = row.localVideoInput as Record<string, unknown>;
      docs.set(mediaItemDocId(mediaId), {
        ...row,
        localVideoInput: { ...localVideoInput, sourceId },
      });
    },
    updatePersistedRow: (patch: Partial<MediaType>) => {
      const row = docs.get(mediaItemDocId(mediaId));
      if (!row) return;
      docs.set(mediaItemDocId(mediaId), { ...row, ...patch });
    },
  };
  return db;
};

const renderPersistenceHook = (
  row = createMediaRow(),
  persistInitialRow = true,
  reduxRow = row,
  scope = { churchId: "", isGuestSession: true },
) => {
  const db = createPouchDb(row, persistInitialRow);
  const store = configureStore({ reducer: { media: mediaReducer } });
  store.dispatch({
    type: "media/initiateMediaList",
    payload: [reduxRow],
  });
  (controllerInfo as unknown as { globalDb: PouchDB.Database }).globalDb =
    db as unknown as PouchDB.Database;
  let scopeDb = db;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>
      <controllerInfo.ControllerInfoContext.Provider
        value={{ db: scopeDb, isGuestSession: scope.isGuestSession } as never}
      >
        <GlobalInfoContext.Provider value={{ churchId: scope.churchId } as never}>
          {children}
        </GlobalInfoContext.Provider>
      </controllerInfo.ControllerInfoContext.Provider>
    </Provider>
  );
  const view = renderHook(
    () => useLocalVideoInputThumbnailPersistence(),
    { wrapper },
  );
  const switchScope = (nextDb: typeof db) => {
    scopeDb = nextDb;
    (controllerInfo as unknown as { globalDb: PouchDB.Database }).globalDb =
      nextDb as unknown as PouchDB.Database;
    view.rerender();
  };
  return { ...view, db, store, switchScope };
};

describe("useLocalVideoInputThumbnailPersistence", () => {
  beforeEach(() => {
    const assets = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
      deleteLocalImageUploadJob: jest.Mock;
      getLocalImageUploadJob: jest.Mock;
      getRememberedLocalImagePolicy: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      saveLocalImage: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    assets.deleteLocalImage.mockReset().mockResolvedValue(undefined);
    assets.deleteLocalImageUploadJob.mockReset().mockResolvedValue(undefined);
    assets.getLocalImageUploadJob.mockReset().mockResolvedValue(undefined);
    assets.getRememberedLocalImagePolicy.mockReset().mockReturnValue("local-only");
    assets.putLocalImageUploadJob.mockReset().mockResolvedValue(undefined);
    assets.saveLocalImage.mockReset().mockResolvedValue(undefined);
    assets.stageLocalImageUploadCleanupJobAtomically
      .mockReset()
      .mockImplementation(async (job) => ({ job, previous: undefined }));
    const queue = jest.requireMock("../utils/localImageUploadQueue") as {
      cancelLocalImageUpload: jest.Mock;
      enqueueLocalImageUpload: jest.Mock;
    };
    queue.cancelLocalImageUpload.mockReset().mockResolvedValue(undefined);
    queue.enqueueLocalImageUpload.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    (controllerInfo as unknown as { globalDb: undefined }).globalDb = undefined;
  });

  it("retains the prior thumbnail until a local-only replacement commits", async () => {
    const { result, db, store } = renderPersistenceHook();
    const frame = {
      blob: new Blob(["replacement"], { type: "image/webp" }),
      width: 640,
      height: 360,
    };
    db.deferNextRowPut();

    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, frame);
    });
    await waitFor(() => expect(db.put).toHaveBeenCalled());

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: "https://images.example.com/original.webp",
        localImage: oldLocalImage,
      }),
    );

    await act(async () => {
      db.commitDeferredPut();
      await saving;
    });

    const persisted = db.readRow() as MediaType;
    expect(persisted).toEqual(
      expect.objectContaining({
        id: mediaId,
        createdAt: "created-before-relink",
        folderId: "existing-folder",
        providerStorage: {
          provider: "mux",
          assetId: "existing-owner-asset",
          churchId: "church-1",
          permanent: true,
        },
        thumbnail: "",
        localImage: expect.objectContaining({
          id: expect.not.stringMatching(oldLocalImage.id),
          storagePolicy: "local-only",
        }),
      }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({ localImage: persisted.localImage }),
    );
    const { deleteLocalImage } = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
    };
    expect(deleteLocalImage).toHaveBeenCalledWith(oldLocalImage.id);
  });

  it("preserves the existing thumbnail, folder, and metadata when only relinking source fields", async () => {
    const { result, db, store } = renderPersistenceHook();
    const nextSource = { ...source, label: "Relinked booth camera" };

    await act(async () => {
      await result.current.persistVideoInputMediaPatch(mediaId, source.sourceId, {
        name: nextSource.label,
        updatedAt: "updated-after-relink",
        localVideoInput: nextSource,
      });
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        id: mediaId,
        name: "Relinked booth camera",
        createdAt: "created-before-relink",
        folderId: "existing-folder",
        thumbnail: "https://images.example.com/original.webp",
        localImage: oldLocalImage,
        providerStorage: {
          provider: "mux",
          assetId: "existing-owner-asset",
          churchId: "church-1",
          permanent: true,
        },
      }),
    );
    expect(store.getState().media.list).toHaveLength(1);
  });

  it("keeps the prior Media reference when the thumbnail write fails", async () => {
    const { result, db, store } = renderPersistenceHook();
    const before = db.readRow();
    db.rejectNextRowPut();

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("The thumbnail could not be saved to Media. Try again.");

    expect(db.readRow()).toEqual(before);
    expect(store.getState().media.list[0]).toEqual(createMediaRow());
    const { deleteLocalImage } = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
    };
    expect(deleteLocalImage).toHaveBeenCalled();
  });

  it("applies a thumbnail to the latest row after a rename and source edit during image storage", async () => {
    const initialRow = {
      ...createMediaRow(),
      thumbnail: "",
      localImage: undefined,
    } as MediaType;
    const { result, db, store } = renderPersistenceHook(initialRow);
    const stored = deferred<void>();
    const assets = jest.requireMock("../utils/localImageAssets") as {
      saveLocalImage: jest.Mock;
    };
    assets.saveLocalImage.mockImplementationOnce(() => stored.promise);
    const latestSource = {
      ...source,
      label: "Updated booth input",
      deviceId: "new-camera-device",
    };
    const latestPatch = {
      name: "Renamed booth input",
      folderId: "new-camera-folder",
      localVideoInput: latestSource,
    };
    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
    });
    await waitFor(() => expect(assets.saveLocalImage).toHaveBeenCalled());

    db.updatePersistedRow(latestPatch);
    act(() => {
      store.dispatch(updateMediaItemFields({ id: mediaId, patch: latestPatch }));
    });

    await act(async () => {
      stored.resolve();
      await saving;
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        name: "Renamed booth input",
        folderId: "new-camera-folder",
        localVideoInput: latestSource,
        thumbnail: "",
        localImage: expect.objectContaining({ storagePolicy: "local-only" }),
        providerStorage: createMediaRow().providerStorage,
      }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({ ...latestPatch, thumbnail: "" }),
    );
  });

  it("keeps an active thumbnail upload checkpoint when a local-only replacement commits", async () => {
    const previousCloudUrl = "https://res.cloudinary.com/example/previous.webp";
    const row = {
      ...createMediaRow(),
      thumbnail: previousCloudUrl,
      localImage: {
        ...oldLocalImage,
        id: "thumbnail-a",
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "previous-cloud-public-id",
        cloudUrl: previousCloudUrl,
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    const activeUpload: LocalImageUploadJob = {
      id: "thumbnail-a",
      assetId: "thumbnail-a",
      itemId: "",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "thumbnail-a-cloud-media",
      status: "uploading",
      phase: "uploading",
      attemptCount: 1,
      nextAttemptAt: 0,
      providerUploadId: "upload-intent-a",
      providerExpectedPublicId: "thumbnail-a-public-id",
      leaseOwnerId: "upload-tab-a",
      leaseExpiresAt: Date.now() + 60_000,
      localVideoInputThumbnail: {
        targetMediaId: mediaId,
        previousAssetId: "previous-thumbnail",
        previousCloudPublicId: "previous-cloud-public-id",
      },
      createdAt: "created-a",
      updatedAt: "updated-a",
    };
    let currentUpload = activeUpload;
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getLocalImageUploadJob: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    assets.getLocalImageUploadJob.mockImplementation(async (assetId: string) =>
      assetId === activeUpload.assetId ? currentUpload : undefined,
    );
    const cancellation = deferred<void>();
    jest.mocked(uploadQueue.cancelLocalImageUpload).mockImplementationOnce(
      () => cancellation.promise,
    );

    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
    });
    await waitFor(() => {
      const persisted = db.readRow() as MediaType | undefined;
      expect(persisted?.localImage?.id).not.toBe(activeUpload.assetId);
    });
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: "",
        localImage: expect.objectContaining({
          id: expect.not.stringMatching(activeUpload.assetId),
          storagePolicy: "local-only",
        }),
      }),
    );
    expect(db.readRow()?.localImage).not.toHaveProperty("cloudPublicId");
    expect(assets.stageLocalImageUploadCleanupJobAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.stringMatching(/^thumbnail-cloud-cleanup-/),
        cleanupCloudPublicId: "previous-cloud-public-id",
        cleanupOnly: true,
        cleanupReady: false,
      }),
      expect.any(Number),
    );
    expect(assets.putLocalImageUploadJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.stringMatching(/^thumbnail-cloud-cleanup-/),
        cleanupCloudPublicId: "previous-cloud-public-id",
        cleanupOnly: true,
        cleanupReady: true,
      }),
    );
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetId: activeUpload.assetId }),
    );

    currentUpload = {
      ...activeUpload,
      status: "failed",
      phase: "failed",
      cancelRequested: true,
      lastError: "Cloud upload failed after the replacement.",
      leaseOwnerId: undefined,
      leaseExpiresAt: undefined,
    };
    await act(async () => {
      cancellation.reject(new Error("The upload could not be reconciled yet."));
      await saving;
    });

    expect(currentUpload).toEqual(
      expect.objectContaining({
        providerUploadId: "upload-intent-a",
        providerExpectedPublicId: "thumbnail-a-public-id",
        status: "failed",
      }),
    );
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetId: activeUpload.assetId }),
    );
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: "",
        localImage: expect.objectContaining({ storagePolicy: "local-only" }),
      }),
    );
  });

  it("does not recreate an existing Media row removed from Pouch by a concurrent change", async () => {
    const { result, db } = renderPersistenceHook();
    db.removeRow();

    await expect(
      result.current.persistVideoInputMediaPatch(mediaId, source.sourceId, {
        name: "Stale relink",
      }),
    ).rejects.toThrow("This video input no longer exists in Media.");

    expect(db.readRow()).toBeUndefined();
    expect(db.put).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer persisted source binding", async () => {
    const { result, db } = renderPersistenceHook();
    db.changePersistedSourceId("newer-source-binding");

    await expect(
      result.current.persistVideoInputMediaPatch(mediaId, source.sourceId, {
        name: "Stale relink",
      }),
    ).rejects.toThrow("This video input changed. Reopen it and try again.");

    expect((db.readRow()?.localVideoInput as { sourceId: string }).sourceId).toBe(
      "newer-source-binding",
    );
    expect(db.put).not.toHaveBeenCalled();
  });

  it("does not publish an old database completion into a newly active scope", async () => {
    const { result, db, store, switchScope } = renderPersistenceHook();
    const nextDb = createPouchDb(createMediaRow());
    db.deferNextRowPut();

    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        { name: "Saved in the original church" },
      );
    });
    await waitFor(() => expect(db.put).toHaveBeenCalled());
    switchScope(nextDb);

    await act(async () => {
      db.commitDeferredPut();
      await saving;
    });

    expect((db.readRow() as MediaType).name).toBe("Saved in the original church");
    expect(store.getState().media.list[0].name).toBe("Booth camera");
  });

  it("creates a newly added input only when the caller explicitly allows it", async () => {
    const row = createMediaRow();
    const { result, db } = renderPersistenceHook(row, false);

    await act(async () => {
      await result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        {
          name: "New camera input",
          localVideoInput: source,
        },
        true,
      );
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        id: mediaId,
        name: "New camera input",
        localVideoInput: source,
      }),
    );
  });

  it("restores existing persisted metadata when Redux only has a new-row placeholder", async () => {
    const persistedRow = createMediaRow();
    const optimisticRow = {
      ...persistedRow,
      createdAt: "placeholder-created-at",
      thumbnail: "",
      localImage: undefined,
      folderId: undefined,
      providerStorage: undefined,
    } as MediaType;
    const { result, store } = renderPersistenceHook(
      persistedRow,
      true,
      optimisticRow,
    );

    await act(async () => {
      await result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        {
          name: "Booth camera relinked",
          localVideoInput: source,
        },
        true,
      );
    });

    expect(store.getState().media.list).toHaveLength(1);
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({
        id: mediaId,
        createdAt: "created-before-relink",
        folderId: "existing-folder",
        thumbnail: "https://images.example.com/original.webp",
        localImage: oldLocalImage,
        providerStorage: persistedRow.providerStorage,
      }),
    );
  });
});
